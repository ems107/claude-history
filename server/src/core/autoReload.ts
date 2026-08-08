import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { AppSettings, AutoReloadRun, AutoReloadStatus } from '@claude-history/shared';
import { validateAutoReload } from '@claude-history/shared';
import { cleanEnv, findClaudeCli } from '../util/launcher.ts';
import type { UsageService } from './usage.ts';

/**
 * Keeps the Claude subscription's 5-hour window rolling.
 *
 * The window starts with the first message sent inside it and lasts 5 hours;
 * once it resets, nothing starts a new one until something is actually sent, so
 * an idle night leaves the windows misaligned with the working day. This
 * service watches for that gap and closes it with one throwaway prompt.
 *
 * It does NOT poll Anthropic. After every read it knows exactly when the
 * current window expires, so it sleeps on a local clock tick until that moment
 * (plus a minute of margin) and only then asks again. A day therefore costs
 * about five reads plus one per reload.
 *
 * Guards, in order of importance — the failure mode to fear here is a loop
 * spawning Claude sessions forever:
 *   - a failed/stale usage read is never read as "no window" (see FiveHourProbe)
 *   - one check or reload at a time (`busy`)
 *   - COOLDOWN_MS between two reloads, whatever else happens
 *   - MAX_FAILURES verified failures in a row and it stops itself
 */

const TICK_MS = 30_000;
/** Let the index finish building before the first read. */
const STARTUP_DELAY_MS = 15_000;
/** Grace after the reported expiry before believing the window is really over. */
const RESET_MARGIN_MS = 60_000;
/** Wait after the prompt before reading usage back, so the figures settle. */
const VERIFY_DELAY_MS = 60_000;
/** Backoff between failed usage reads (offline, 429, expired token). */
const READ_BACKOFF_MS = [5 * 60_000, 10 * 60_000, 30 * 60_000];
/** Floor between two reloads. A real window lasts 5 h, so this is generous. */
const COOLDOWN_MS = 30 * 60_000;
/** Retry delay after a reload that ran but did not start a window. */
const RETRY_MS = 15 * 60_000;
/** Verified failures in a row before the service pauses itself. */
const MAX_FAILURES = 3;
/** A one-line prompt answers in seconds; past this the process is hung. */
const RUN_TIMEOUT_MS = 120_000;
/**
 * Minimum spacing between checks triggered by settings saves. The usage
 * endpoint rate-limits harder than its own numbers suggest (observed: HTTP 429
 * after a dozen reads in a quarter of an hour), so saves must not become a way
 * to hammer it.
 */
const MIN_CHECK_GAP_MS = 60_000;
const REPLY_MAX = 200;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class AutoReloadService {
  /** Known expiry of the current 5-hour window (epoch ms), null when none. */
  private resetsAt: number | null = null;
  private nextCheckAt = 0;
  private lastCheckAt: number | null = null;
  private lastError: string | null = null;
  private lastRun: AutoReloadRun | null = null;
  private lastRunAt = 0;
  private failures = 0;
  private pausedReason: string | null = null;
  private busy = false;
  private readBackoffStep = 0;
  /** Resolved once; undefined until then, null when the CLI is missing. */
  private cliPath: string | null | undefined;
  /** Last seen configSignature(), to spot saves that change nothing here. */
  private signature = '';

  constructor(
    private readonly usage: UsageService,
    private readonly getSettings: () => AppSettings,
  ) {}

  start(events: EventEmitter): void {
    this.nextCheckAt = Date.now() + STARTUP_DELAY_MS;
    this.signature = this.configSignature();
    void this.resolveCli();
    setInterval(() => void this.tick(), TICK_MS).unref();
    // Saving a setting is the user's way of saying "try again": it clears the
    // pause and the backoff. Only re-check straight away when it can change the
    // answer, though — every other save would spend a usage read for nothing.
    events.on('settings-changed', () => {
      const wasBlocked = this.pausedReason !== null;
      this.pausedReason = null;
      this.failures = 0;
      this.readBackoffStep = 0;
      const signature = this.configSignature();
      if (signature === this.signature && !wasBlocked) return;
      this.signature = signature;
      // The CLI may have been installed since we last looked.
      this.cliPath = undefined;
      void this.resolveCli();
      this.nextCheckAt = Math.max(Date.now(), (this.lastCheckAt ?? 0) + MIN_CHECK_GAP_MS);
      void this.tick();
    });
  }

  /** Only the fields that change what a check would do. */
  private configSignature(): string {
    const s = this.getSettings();
    return JSON.stringify([s.autoReloadEnabled, s.autoReloadModel, s.autoReloadMessage, s.autoReloadCwd]);
  }

  private async resolveCli(): Promise<string | null> {
    if (this.cliPath !== undefined) return this.cliPath;
    this.cliPath = await findClaudeCli();
    if (!this.cliPath) console.warn('[auto-reload] the claude CLI could not be found');
    return this.cliPath;
  }

  /**
   * Everything that stops it from running, as one message for the UI: the
   * shared checks (message, model, absolute path) plus the ones only the server
   * can make (the folder is really there, the CLI resolves).
   */
  configError(s: AppSettings = this.getSettings()): string | null {
    const basic = validateAutoReload(s);
    if (basic) return basic;
    const cwd = s.autoReloadCwd.trim();
    try {
      if (!fs.statSync(cwd).isDirectory()) return `"${cwd}" is not a folder.`;
      fs.accessSync(cwd, fs.constants.R_OK);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return `The folder "${cwd}" does not exist.`;
      return `The folder "${cwd}" is not accessible (${code ?? 'unknown error'}).`;
    }
    if (this.cliPath === null) {
      return 'The claude CLI was not found on PATH or in ~\\.local\\bin — install Claude Code, then save again.';
    }
    return null;
  }

  status(): AutoReloadStatus {
    const s = this.getSettings();
    const configError = this.configError(s);
    const active = s.autoReloadEnabled && !configError && !this.pausedReason;
    const iso = (ms: number | null): string | null => (ms ? new Date(ms).toISOString() : null);
    return {
      enabled: s.autoReloadEnabled,
      active,
      configError,
      pausedReason: this.pausedReason,
      running: this.busy,
      resetsAt: iso(this.resetsAt),
      nextCheckAt: active ? iso(this.nextCheckAt) : null,
      lastCheckAt: iso(this.lastCheckAt),
      lastError: this.lastError,
      lastRun: this.lastRun,
      cliPath: this.cliPath ?? null,
    };
  }

  /**
   * Run the whole cycle once, on demand, ignoring only the schedule and the
   * cooldown. Everything that stops the scheduler stops this too: sending a
   * prompt the feature itself would refuse to send proves nothing. A pause is
   * not one of those — clearing it is exactly what a successful run does.
   */
  async runNow(): Promise<AutoReloadRun> {
    if (this.busy) throw new Error('A check or reload is already running — try again in a moment.');
    const s = this.getSettings();
    if (!s.autoReloadEnabled) throw new Error('Switch the feature on first.');
    const configError = this.configError(s);
    if (configError) throw new Error(configError);
    this.busy = true;
    try {
      return await this.reload(s, true);
    } finally {
      this.busy = false;
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    const s = this.getSettings();
    if (!s.autoReloadEnabled || this.pausedReason) return;
    if (this.configError(s)) return;
    if (Date.now() < this.nextCheckAt) return;
    this.busy = true;
    try {
      await this.check(s);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.nextCheckAt = Date.now() + RETRY_MS;
      console.warn('[auto-reload] check failed:', err);
    } finally {
      this.busy = false;
    }
  }

  /** Read usage, then either sleep until the window expires or reload now. */
  private async check(s: AppSettings): Promise<void> {
    const probe = await this.usage.probeFiveHour();
    this.lastCheckAt = Date.now();

    if (!probe.ok) {
      this.lastError = probe.error;
      const wait = READ_BACKOFF_MS[Math.min(this.readBackoffStep++, READ_BACKOFF_MS.length - 1)];
      this.nextCheckAt = Date.now() + wait;
      console.warn(`[auto-reload] usage read failed (${probe.error}) — retrying in ${Math.round(wait / 60_000)} min`);
      return;
    }
    this.lastError = null;
    this.readBackoffStep = 0;

    const resetsAt = probe.resetsAt ? Date.parse(probe.resetsAt) : NaN;
    if (Number.isFinite(resetsAt) && resetsAt > Date.now()) {
      this.sleepUntilReset(resetsAt);
      return;
    }

    this.resetsAt = null;
    const sinceLastRun = Date.now() - this.lastRunAt;
    if (this.lastRunAt > 0 && sinceLastRun < COOLDOWN_MS) {
      this.nextCheckAt = this.lastRunAt + COOLDOWN_MS;
      console.log(
        `[auto-reload] no 5-hour window, but the last reload was ${Math.round(sinceLastRun / 60_000)} min ago — ` +
          'waiting out the cooldown',
      );
      return;
    }
    await this.reload(s, false);
  }

  private sleepUntilReset(resetsAt: number): void {
    this.resetsAt = resetsAt;
    this.nextCheckAt = resetsAt + RESET_MARGIN_MS;
    const hours = ((resetsAt - Date.now()) / 3_600_000).toFixed(1);
    console.log(`[auto-reload] 5-hour window runs until ${new Date(resetsAt).toISOString()} (${hours} h) — sleeping`);
  }

  /**
   * Send the prompt, then read usage back to learn the new expiry. The caller
   * owns the `busy` mutex.
   */
  private async reload(s: AppSettings, manual: boolean): Promise<AutoReloadRun> {
    const startedAt = Date.now();
    this.lastRunAt = startedAt;
    const cwd = s.autoReloadCwd.trim();
    const message = s.autoReloadMessage.trim();
    const run: AutoReloadRun = {
      at: new Date(startedAt).toISOString(),
      ok: false,
      model: s.autoReloadModel,
      cwd,
      durationMs: 0,
      exitCode: null,
      reply: null,
      error: null,
      windowStarted: false,
      manual,
    };
    this.lastRun = run;

    console.log(`[auto-reload] ${manual ? 'manual run' : 'no 5-hour window'} — sending "${message}" (${s.autoReloadModel}) in ${cwd}`);
    try {
      const cli = await this.resolveCli();
      if (!cli) throw new Error('the claude CLI could not be found');
      const result = await this.spawnPrompt(cli, s, cwd, message);
      run.durationMs = Date.now() - startedAt;
      run.exitCode = result.exitCode;
      run.reply = result.stdout.replace(/\s+/g, ' ').trim().slice(0, REPLY_MAX) || null;
      if (result.timedOut) throw new Error(`no answer after ${RUN_TIMEOUT_MS / 1000} s — the process was killed`);
      if (result.exitCode !== 0) {
        throw new Error(`claude exited with code ${result.exitCode}: ${result.stderr.trim().slice(0, 300) || 'no output'}`);
      }
      run.ok = true;
      console.log(`[auto-reload] answered in ${run.durationMs} ms: ${run.reply ?? '(empty)'}`);
    } catch (err) {
      run.durationMs = Date.now() - startedAt;
      run.error = err instanceof Error ? err.message : String(err);
      console.warn(`[auto-reload] the prompt failed: ${run.error}`);
      this.countFailure(`the prompt failed (${run.error})`);
      return run;
    }

    // The reply proves Claude answered, not that a window opened. Read it back.
    await delay(VERIFY_DELAY_MS);
    const probe = await this.usage.probeFiveHour();
    this.lastCheckAt = Date.now();
    if (!probe.ok) {
      // Blame the read, not the reload: the window may well have started. The
      // cooldown keeps this from turning into a stream of prompts.
      this.lastError = probe.error;
      run.error = `sent, but the usage read-back failed (${probe.error})`;
      this.nextCheckAt = Date.now() + 2 * 60_000;
      console.warn(`[auto-reload] ${run.error}`);
      return run;
    }
    this.lastError = null;
    const resetsAt = probe.resetsAt ? Date.parse(probe.resetsAt) : NaN;
    if (Number.isFinite(resetsAt) && resetsAt > Date.now()) {
      run.windowStarted = true;
      this.failures = 0;
      this.pausedReason = null;
      this.sleepUntilReset(resetsAt);
      return run;
    }
    run.error = 'the prompt ran but Anthropic still reports no 5-hour window';
    this.countFailure(run.error);
    return run;
  }

  private countFailure(reason: string): void {
    this.failures++;
    if (this.failures >= MAX_FAILURES) {
      this.pausedReason = `Stopped after ${this.failures} failed attempts: ${reason}`;
      console.warn(`[auto-reload] ${this.pausedReason}`);
      return;
    }
    this.nextCheckAt = Date.now() + RETRY_MS;
    console.warn(`[auto-reload] attempt ${this.failures}/${MAX_FAILURES} failed — retrying in ${RETRY_MS / 60_000} min`);
  }

  /**
   * One headless turn: `claude -p <message> --model <alias>`. Print mode exits
   * by itself once the answer is out, so there is no session to close; the
   * timeout only covers a hung process. MCP servers are skipped — the prompt
   * needs no tools and loading them would just cost seconds and side effects.
   */
  private spawnPrompt(
    cli: string,
    s: AppSettings,
    cwd: string,
    message: string,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      // `--mcp-config {}` is rejected ("mcpServers: expected record") — the key
      // has to be there, empty. With --strict-mcp-config that skips every
      // configured MCP server, which a one-line prompt has no use for.
      const args = [
        '-p',
        message,
        '--model',
        s.autoReloadModel,
        '--mcp-config',
        '{"mcpServers":{}}',
        '--strict-mcp-config',
      ];
      const child = spawn(cli, args, {
        cwd,
        // Strip our own CLAUDE_CODE_* markers, or the child would treat itself
        // as a nested session and stop persisting its transcript.
        env: cleanEnv(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.on('data', (d: Buffer) => {
        if (stdout.length < 4_000) stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        if (stderr.length < 4_000) stderr += d.toString();
      });
      const timer = setTimeout(() => {
        timedOut = true;
        // claude spawns children of its own, so kill the tree, not just the pid.
        if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      }, RUN_TIMEOUT_MS);
      child.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, timedOut });
      });
    });
  }
}
