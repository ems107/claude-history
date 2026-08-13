import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { AppSettings, ChatState, ChatStatus } from '@claude-history/shared';
import { CHAT_MESSAGE_MAX } from '@claude-history/shared';
import { cleanEnv, findClaudeCli, forgetClaudeCli } from '../util/launcher.ts';
import type { SessionIndex } from './index.ts';
import { pidAlive } from './live.ts';
import { createLogger } from './logger.ts';

const log = createLogger('chat');

/** How often the idle sweep runs. Same cadence as the auto-reload's tick. */
const TICK_MS = 30_000;

/**
 * A turn with no output at all for this long is treated as wedged and the
 * process is killed. It is not a cap on how long Claude may work — every line
 * it writes, thinking included, resets the clock — but a turn that has gone
 * completely silent for ten minutes is not coming back, and without this it
 * would hold its session's slot forever. This is also the backstop for an
 * `AskUserQuestion` nobody can answer in a `--print` run.
 */
const TURN_SILENCE_MS = 10 * 60_000;

/**
 * Processes alive at once. Each one holds a CLI with its MCP servers loaded,
 * so this is about the machine, not about correctness — three conversations in
 * flight from one browser is already generous.
 */
const MAX_CHAT_SESSIONS = 3;

interface ChatProcess {
  sessionId: string;
  child: ChildProcess;
  cwd: string;
  model: string;
  effort: string;
  /** Prompts accepted while a turn was in flight, sent in order after it. */
  queued: string[];
  /** A prompt has been written and its `result` has not come back. */
  working: boolean;
  /** True until the first line of output: the CLI is still starting up. */
  starting: boolean;
  turnStartedAt: number | null;
  lastActivityAt: number;
  lastError: string | null;
  /** Framing remainder. Never an accumulator — stdout is read, not kept. */
  tail: string;
}

/**
 * Talks to one `claude` process per session, so a prompt typed in the app
 * reaches the conversation it belongs to.
 *
 * The shape of this is set by one decision: **the answer is not rendered from
 * this stream.** Claude Code writes its own transcript, the watcher sees the
 * file grow and the viewer re-reads it — the path that already draws every
 * live session. So all this service does with stdout is follow the state
 * machine (`init` … `result`) and say when a turn starts and ends. Nothing is
 * accumulated, and a line it does not recognise costs nothing.
 *
 * Verified against CC 2.1.229 before it was written: one process takes several
 * turns on the same stdin (1.45 s to the first `system/init`, 38 ms to the
 * second), and `--resume` appends to the SAME transcript file. Note that
 * `system/init` is emitted at the start of EVERY turn, not once at startup, so
 * it cannot be used as "the process is ready".
 */
export class SessionChatService {
  readonly events = new EventEmitter();
  private readonly procs = new Map<string, ChatProcess>();
  /**
   * Last failure per session, kept AFTER the process is gone. Without this the
   * one thing worth reporting — why it died — would be dropped along with the
   * process that knew it, and the composer would go quiet with no explanation.
   */
  private readonly errors = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly index: SessionIndex,
    private readonly settings: () => AppSettings,
  ) {
    // One listener per SSE client, same as the index's emitter.
    this.events.setMaxListeners(100);
  }

  start(): void {
    this.timer = setInterval(() => this.sweep(), TICK_MS);
    this.timer.unref();
  }

  /**
   * Why a prompt cannot be sent, in the words the composer shows. One string
   * for the endpoint and the UI both: a control that is disabled and silent
   * about it is the bug this shape exists to prevent.
   *
   * A turn already in flight is NOT a reason — that queues.
   */
  sendBlockedReason(sessionId: string): string | null {
    const s = this.settings();
    if (!s.chatEnabled) return 'Sending from the app is turned off in Settings.';
    const summary = this.index.get(sessionId);
    if (!summary) return 'This session is not in the index.';
    if (!findClaudeCli()) return 'The Claude Code CLI could not be found.';
    if (!fs.existsSync(summary.projectPath)) {
      return `The project folder no longer exists: ${summary.projectPath}`;
    }
    // The one that matters. Claude Code appends to the transcript from whatever
    // process holds the session, and two writers is exactly what produces the
    // duplicated uuids and replayed segments the parser has to undo.
    //
    // Our own process has to be excluded by pid, because it registers itself
    // there too: a `--print` run writes the same `~/.claude/sessions/<pid>.json`
    // an interactive one does (verified — `entrypoint: "sdk-cli"`, and the pid
    // is the `claude.exe` we spawned). Without this the feature blocks itself
    // the moment it starts working.
    //
    // `pidAlive` is re-checked here rather than trusted from the list, which is
    // only rebuilt when something writes to that directory. A CLI killed
    // outright writes nothing on the way out, so its file stays and no event
    // ever arrives to drop it — measured: the block survived the terminal it
    // named by minutes, with nothing left running.
    if (
      this.index.liveSessions.some(
        (l) => l.sessionId === sessionId && !this.ownsPid(l.pid) && pidAlive(l.pid),
      )
    ) {
      return 'This session is open in a terminal — two writers would corrupt its transcript.';
    }
    if (!this.procs.has(sessionId) && this.procs.size >= MAX_CHAT_SESSIONS) {
      return `Too many sessions are already running (${MAX_CHAT_SESSIONS}).`;
    }
    return null;
  }

  status(sessionId: string): ChatStatus {
    const s = this.settings();
    const p = this.procs.get(sessionId);
    const lastError = p?.lastError ?? this.errors.get(sessionId) ?? null;
    let state: ChatState = 'idle';
    if (p?.working) state = p.starting ? 'starting' : 'working';
    else if (lastError) state = 'error';
    return {
      sessionId,
      state,
      running: p !== undefined,
      turnStartedAt: p?.turnStartedAt ? new Date(p.turnStartedAt).toISOString() : null,
      queued: p?.queued.length ?? 0,
      model: p?.model ?? s.chatModel,
      effort: p?.effort ?? s.chatEffort,
      lastError,
      blockedReason: this.sendBlockedReason(sessionId),
    };
  }

  /**
   * Send one prompt. Starts a process if there is none, queues if a turn is in
   * flight, and restarts the process when the model or effort changed — those
   * are startup flags, so the only way to honour a new one is a new process.
   */
  send(sessionId: string, text: string, model?: string, effort?: string): void {
    const blocked = this.sendBlockedReason(sessionId);
    if (blocked) {
      log.warn(`prompt refused for ${sessionId} — ${blocked}`);
      throw new Error(blocked);
    }
    const prompt = text.trim();
    if (!prompt) throw new Error('The prompt is empty.');
    if (prompt.length > CHAT_MESSAGE_MAX) {
      throw new Error(`The prompt is too long (${prompt.length} > ${CHAT_MESSAGE_MAX} characters).`);
    }

    const s = this.settings();
    const wantModel = model ?? s.chatModel;
    const wantEffort = effort ?? s.chatEffort;

    let p = this.procs.get(sessionId);
    if (p && (p.model !== wantModel || p.effort !== wantEffort)) {
      if (p.working) throw new Error('Finish the current turn before changing model or effort.');
      log.info(`restarting ${sessionId} for ${wantModel}/${wantEffort} (was ${p.model}/${p.effort})`);
      this.kill(p, 'model or effort changed');
      p = undefined;
    }
    if (!p) p = this.spawnFor(sessionId, wantModel, wantEffort);

    if (p.working) {
      p.queued.push(prompt);
      log.info(`queued a prompt for ${sessionId} (${p.queued.length} waiting)`);
      this.changed(sessionId);
      return;
    }
    this.write(p, prompt);
  }

  /** Kill the process for a session, dropping whatever was queued. */
  stop(sessionId: string): void {
    const p = this.procs.get(sessionId);
    if (!p) return;
    this.kill(p, 'stopped from the app');
    this.changed(sessionId);
  }

  /**
   * Kill every process. Called from the signal handlers and from every route
   * that ends the server, because nothing else would: `claude` is not in this
   * process's tree in any way Windows cleans up for us, and the scheduled task
   * only ever kills the wscript wrapper.
   */
  shutdown(): void {
    if (this.timer) clearInterval(this.timer);
    for (const p of [...this.procs.values()]) this.kill(p, 'the server is shutting down');
  }

  /** True while any session has a turn in flight — the stop/uninstall guard. */
  get busy(): boolean {
    return [...this.procs.values()].some((p) => p.working);
  }

  /** Is this one of the processes we started? See sendBlockedReason. */
  private ownsPid(pid: number): boolean {
    for (const p of this.procs.values()) if (p.child.pid === pid) return true;
    return false;
  }

  // ---- internals ----

  private spawnFor(sessionId: string, model: string, effort: string): ChatProcess {
    const cli = findClaudeCli();
    const summary = this.index.get(sessionId);
    // Both were checked by sendBlockedReason; this is the type-level echo.
    if (!cli || !summary) throw new Error('The Claude Code CLI could not be found.');
    const cwd = summary.projectPath;

    // MCP servers are deliberately NOT skipped (no --strict-mcp-config): a
    // prompt that needs Jira or SQL has to work the same here as in a terminal.
    // The startup cost is paid once, because the process outlives the turn.
    const args = [
      '--print',
      '--verbose',
      '--resume',
      sessionId,
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--permission-mode',
      'auto',
      '--model',
      model,
      '--effort',
      effort,
    ];
    const child = spawn(cli, args, {
      cwd,
      // Strip our own CLAUDE_CODE_* markers, or the child treats itself as a
      // nested session and stops persisting the transcript — which is the one
      // thing this whole feature depends on.
      env: cleanEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const p: ChatProcess = {
      sessionId,
      child,
      cwd,
      model,
      effort,
      queued: [],
      working: false,
      starting: true,
      turnStartedAt: null,
      lastActivityAt: Date.now(),
      lastError: null,
      tail: '',
    };
    this.procs.set(sessionId, p);
    log.info(`started a process for ${sessionId} (${model}, effort ${effort}) in ${cwd}`, { cli, args });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(p, chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) log.warn(`${sessionId} wrote to stderr: ${text.slice(0, 300)}`);
    });
    child.once('error', (err) => {
      // A path that resolved and then failed to spawn cannot stay cached.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') forgetClaudeCli();
      p.lastError = String(err);
      log.error(`could not run the CLI for ${sessionId}`, err);
      this.forget(p);
    });
    child.once('close', (code) => {
      if (p.working) p.lastError = `The process exited (code ${code}) before the turn finished.`;
      log.info(`process for ${sessionId} exited with code ${code}`);
      this.forget(p);
    });
    return p;
  }

  private write(p: ChatProcess, prompt: string): void {
    if (!p.child.stdin?.writable) {
      p.lastError = 'The process is no longer accepting input.';
      this.changed(p.sessionId);
      return;
    }
    p.working = true;
    p.turnStartedAt = Date.now();
    p.lastActivityAt = Date.now();
    p.lastError = null;
    this.errors.delete(p.sessionId);
    // One NDJSON line per prompt. JSON.stringify escapes the newlines of a
    // multi-line prompt, so a pasted stack trace is still exactly one line.
    p.child.stdin.write(
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null })}\n`,
    );
    log.info(`sent a prompt to ${p.sessionId} (${prompt.length} chars)`);
    this.changed(p.sessionId);
  }

  /**
   * Frame stdout into lines and follow the state machine. Only `type` is read:
   * the content is already on its way to the viewer through the transcript.
   */
  private onStdout(p: ChatProcess, chunk: string): void {
    p.lastActivityAt = Date.now();
    p.starting = false;
    p.tail += chunk;
    const lines = p.tail.split('\n');
    // The last piece is whatever came after the final newline: a partial line
    // most of the time, and the empty string when the chunk ended cleanly.
    p.tail = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let o: { type?: unknown; subtype?: unknown; is_error?: unknown };
      try {
        o = JSON.parse(line) as typeof o;
      } catch {
        log.warn(`unparseable line from ${p.sessionId}: ${line.slice(0, 200)}`);
        continue;
      }
      if (o.type !== 'result') continue;
      p.working = false;
      p.turnStartedAt = null;
      if (o.is_error === true) {
        p.lastError = `Claude Code reported an error (${String(o.subtype ?? 'unknown')}).`;
        log.warn(`turn for ${p.sessionId} ended in an error: ${String(o.subtype ?? 'unknown')}`);
      } else {
        log.info(`turn finished for ${p.sessionId}`);
      }
      const next = p.queued.shift();
      if (next) this.write(p, next);
      else this.changed(p.sessionId);
    }
  }

  private sweep(): void {
    const idleMs = Math.max(1, this.settings().chatIdleTimeoutMinutes) * 60_000;
    const now = Date.now();
    for (const p of [...this.procs.values()]) {
      const quiet = now - p.lastActivityAt;
      if (p.working) {
        if (quiet > TURN_SILENCE_MS) {
          p.lastError = `The turn produced no output for ${Math.round(TURN_SILENCE_MS / 60_000)} minutes and was stopped.`;
          log.warn(`turn for ${p.sessionId} went silent — killing the process`);
          this.kill(p, 'the turn went silent');
          this.changed(p.sessionId);
        }
        continue;
      }
      if (quiet > idleMs) {
        log.info(`closing the idle process for ${p.sessionId}`);
        this.kill(p, 'idle');
        this.changed(p.sessionId);
      }
    }
  }

  /**
   * `claude` spawns children of its own, so the tree goes — `child.kill()`
   * leaves them behind. Synchronous on purpose: this also runs from the
   * process-exit handler, where nothing asynchronous gets a chance to finish.
   */
  private kill(p: ChatProcess, why: string): void {
    this.procs.delete(p.sessionId);
    if (p.lastError) this.errors.set(p.sessionId, p.lastError);
    if (p.child.pid === undefined) return;
    log.info(`killing the process for ${p.sessionId} — ${why}`);
    try {
      spawnSync('taskkill', ['/pid', String(p.child.pid), '/T', '/F'], { windowsHide: true });
    } catch (err) {
      log.warn(`taskkill failed for ${p.sessionId}`, err);
    }
  }

  /** The process is gone on its own; keep the error for the panel to show. */
  private forget(p: ChatProcess): void {
    const current = this.procs.get(p.sessionId);
    if (current === p) this.procs.delete(p.sessionId);
    if (p.lastError) this.errors.set(p.sessionId, p.lastError);
    p.working = false;
    p.turnStartedAt = null;
    this.changed(p.sessionId);
  }

  private changed(sessionId: string): void {
    this.events.emit('chat-changed', sessionId);
  }
}
