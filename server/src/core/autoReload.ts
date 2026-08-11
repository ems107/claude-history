import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { AppSettings, AutoReloadRun, AutoReloadStatus } from '@claude-history/shared';
import { validateAutoReload } from '@claude-history/shared';
import { cleanEnv, findClaudeCli, forgetClaudeCli } from '../util/launcher.ts';
import { createLogger, localStamp } from './logger.ts';
import type { UsageReadEvent, UsageService } from './usage.ts';

const log = createLogger('auto-reload');

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
 * It also does not read alone. Usage lives in one place (UsageService), and
 * this service subscribes to it: whenever anything else reads — the header
 * widget, most of the time — the answer arrives here too and the sleep is
 * re-planned from it, free. Its own reads are what happens when nobody else is
 * looking, which is the case this feature exists for.
 *
 * Guards, in order of importance — the failure mode to fear here is a loop
 * spawning Claude sessions forever:
 *   - a failed/stale usage read is never read as "no window" (see FiveHourProbe)
 *   - one check or reload at a time (`busy`), and never two prompts at once
 *     (`sending`)
 *   - MAX_SENDS_PER_HOUR automatic sends in a rolling hour and it stops itself
 *     — the outright bound on sessions spawned, and the one guard that costs a
 *     legitimate send nothing, since it acts on sends already made
 *   - MAX_FAILURES verified failures in a row and it stops itself
 *   - COOLDOWN_MS between two sends made blind, i.e. without a `resets_at` to
 *     go on (`waitOutCooldown`). A firm expiry outranks it: when a successful
 *     read says the window ends at a given moment, the send belongs at that
 *     moment and nothing may push it later.
 *
 * Every one of those guards exists to tame the schedule, so none of them may
 * stand in the way of the user pressing "Send it now": that button is refused
 * only by the validations and by a prompt genuinely in flight (a few seconds).
 * See `runBlockedReason()`, which is also the text the UI shows.
 *
 * The one failure it answers by acting rather than waiting is a stale stored
 * token: only running Claude Code refreshes it, so waiting guarantees the same
 * failure next time. See `check()`.
 */

const TICK_MS = 30_000;
/** Let the index finish building before the first read. */
const STARTUP_DELAY_MS = 15_000;
/** Grace after the reported expiry before believing the window is really over. */
const RESET_MARGIN_MS = 60_000;
/** Wait after the prompt before reading usage back, so the figures settle. */
const VERIFY_DELAY_MS = 60_000;
/**
 * Backoff after the endpoint answered but refused (429, 5xx) or the credentials
 * are bad. Long on purpose: it is rate limited, and no retry fixes a bad token.
 */
const READ_BACKOFF_MS = [5 * 60_000, 10 * 60_000, 30 * 60_000];
/**
 * Backoff after a read that failed on the wire, which is a different animal:
 * usually a laptop whose adapter has not come up yet, back in seconds. Treating
 * it like a 429 was a real bug — it burnt the whole free-window period waiting
 * 30 minutes while the network had been fine for 29 of them.
 */
const NETWORK_BACKOFF_MS = [45_000, 90_000, 3 * 60_000, 10 * 60_000, 30 * 60_000];
/** A tick this much later than scheduled means the machine was suspended. */
const SUSPEND_GAP_MS = TICK_MS * 3;
/** After a resume, let the network come up before reading anything. */
const RESUME_GRACE_MS = 30_000;
/**
 * Floor between two sends made WITHOUT a firm expiry to go on — in practice the
 * stale-token path, which is error territory: we cannot read the figures, so we
 * are acting on the absence of information and a repeat within half an hour
 * would be repeating a guess.
 *
 * It deliberately does NOT apply once a successful read has given us a real
 * `resets_at`: that date is first-hand evidence of when the window ends, and
 * every minute spent waiting past it is a minute of the next window thrown
 * away. The case is not hypothetical — a stale token discovered five minutes
 * before a window expires used to push the reload out by twenty-five, and the
 * whole point of the feature is to keep those boundaries where they belong. A
 * firm date wins; MAX_SENDS_PER_HOUR is what bounds the damage if the dates
 * themselves ever stop making sense.
 */
const COOLDOWN_MS = 30 * 60_000;
/**
 * The bound on how many sessions this can ever spawn, and the reason no floor
 * is needed between two sends that a real expiry asked for. Four an hour is out
 * of reach for anything legitimate: a real window lasts five hours, so even a
 * stale token followed minutes later by the window's expiry is two. Reaching it
 * means the readings have stopped adding up, which no wait fixes — so it stops
 * instead, and says so. Manual sends are not counted: a person pressing a
 * button is not a loop.
 *
 * Unlike a floor, this never delays anything. It acts on evidence already in
 * hand rather than on suspicion about the next send.
 */
const MAX_SENDS_PER_HOUR = 4;
const SEND_WINDOW_MS = 60 * 60_000;
/**
 * How long a 5-hour window lasts, used for one thing only: telling a window our
 * prompt opened from one that was already running when it ran. If our message
 * started it, the expiry lands about five hours out; four minutes out means it
 * predates us. The slack covers our own seconds plus a window another device
 * may have opened moments earlier, which is not worth splitting hairs over.
 */
const WINDOW_MS = 5 * 60 * 60_000;
const WINDOW_SLACK_MS = 15 * 60_000;
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
/**
 * How old a shared reading may be and still answer "is the window alive?".
 * `resets_at` does not move for five hours, so ten minutes is conservative —
 * and it only ever applies to a reading that says the window IS alive. One
 * reporting no window is always confirmed first-hand, because acting on that
 * spawns a Claude session.
 */
const REUSE_READ_MS = 10 * 60_000;
/**
 * The endpoint returns `resets_at` jittering by a second between reads, so
 * "the plan changed" has to mean more than arithmetic noise: only news that
 * buys us at least this much extra sleep is worth re-planning (and logging).
 */
const REPLAN_MARGIN_MS = 60_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class AutoReloadService {
  /** Known expiry of the current 5-hour window (epoch ms), null when none. */
  private resetsAt: number | null = null;
  private nextCheckAt = 0;
  private lastCheckAt: number | null = null;
  /**
   * Only for the scheduler throwing where it should not. Usage-read failures
   * are NOT kept here: they belong to the shared UsageService, and a private
   * copy of them is exactly how this panel ended up reporting an expired token
   * for minutes after the widget had read the figures perfectly well.
   */
  private lastCrash: string | null = null;
  private lastRun: AutoReloadRun | null = null;
  private lastRunAt = 0;
  /** When each automatic send happened, pruned to the last hour. See `tooManySends`. */
  private autoSends: number[] = [];
  private failures = 0;
  private pausedReason: string | null = null;
  private busy = false;
  /**
   * A `claude -p` process is in flight. Deliberately separate from `busy`: that
   * one is the scheduler's mutex, while this covers only the send itself — a
   * few seconds. Two prompts at once is the single thing that must never
   * happen, so this is the only state that can refuse a manual send.
   */
  private sending = false;
  /**
   * How many read-backs are pending (each happens VERIFY_DELAY_MS after its
   * send). A count rather than a flag because two can overlap — a manual send
   * right after a scheduled one — and the first to finish must not report the
   * second as done.
   */
  private verifyPending = 0;
  private readBackoffStep = 0;
  /** Resolved once; undefined until then, null when the CLI is missing. */
  private cliPath: string | null | undefined;
  /** Last seen configSignature(), to spot saves that change nothing here. */
  private signature = '';
  /** When the previous tick ran, to notice the machine having been asleep. */
  private lastTickAt = 0;

  constructor(
    private readonly usage: UsageService,
    private readonly getSettings: () => AppSettings,
  ) {}

  start(events: EventEmitter): void {
    this.nextCheckAt = Date.now() + STARTUP_DELAY_MS;
    this.lastTickAt = Date.now();
    this.signature = this.configSignature();
    void this.resolveCli();
    setInterval(() => void this.tick(), TICK_MS).unref();
    this.usage.events.on('read', (e: UsageReadEvent) => this.onUsageRead(e));
    // Saving a setting is the user's way of saying "try again": it clears the
    // pause and the backoff. Only re-check straight away when it can change the
    // answer, though — every other save would spend a usage read for nothing.
    events.on('settings-changed', () => {
      const wasBlocked = this.pausedReason !== null;
      this.pausedReason = null;
      this.failures = 0;
      this.readBackoffStep = 0;
      // Forget the sends the breaker counted, or clearing its pause would be
      // theatre: the next send would trip it again on the same four.
      this.autoSends = [];
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

  /**
   * Somebody else read usage. If it says the window is alive well past the
   * moment we were going to wake up for, we have just been told the answer to
   * the question we were going to ask — so take it and sleep longer.
   *
   * Deliberately one-directional: this can only postpone the next check, never
   * bring it forward and never trigger anything. A failed read is ignored
   * outright (a failure is not news about the window), and a reading that
   * reports no window is left to `check()`, which will confirm it first-hand
   * before anything gets spawned.
   */
  private onUsageRead(e: UsageReadEvent): void {
    if (!e.probe.ok || !e.probe.resetsAt || this.busy) return;
    const s = this.getSettings();
    if (!s.autoReloadEnabled || this.pausedReason || this.configError(s)) return;
    const resetsAt = Date.parse(e.probe.resetsAt);
    if (!Number.isFinite(resetsAt) || resetsAt <= Date.now()) return;
    // Keep the displayed expiry current whatever happens; only re-plan (and
    // say so) when the news is worth more than the endpoint's own jitter.
    this.resetsAt = resetsAt;
    this.lastCheckAt = Date.now();
    this.readBackoffStep = 0;
    const planned = resetsAt + RESET_MARGIN_MS;
    if (planned <= this.nextCheckAt + REPLAN_MARGIN_MS) return;
    this.sleepUntilReset(resetsAt, `the ${e.trigger} read`);
  }

  /** Only the fields that change what a check would do. */
  private configSignature(): string {
    const s = this.getSettings();
    return JSON.stringify([s.autoReloadEnabled, s.autoReloadModel, s.autoReloadMessage, s.autoReloadCwd]);
  }

  /**
   * Both outcomes are logged with the path, because from a log alone "found"
   * and "found, and unusable" looked identical for as long as this feature has
   * existed — a resolved path that could not be spawned only ever surfaced as
   * an ENOENT much later, next to a prompt that never went out.
   */
  private async resolveCli(): Promise<string | null> {
    if (this.cliPath !== undefined) return this.cliPath;
    this.cliPath = findClaudeCli();
    if (this.cliPath) log.info(`the claude CLI is ${this.cliPath}`);
    else log.warn('the claude CLI could not be found');
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

  /**
   * Why "Send it now" would be refused, or null when it would go through.
   *
   * One method, two consumers: `runNow()` refuses with exactly this string, and
   * the UI both disables the button and shows it. They cannot drift apart, and
   * that is the whole point — the button used to be disabled by `running` while
   * the only text it could show came from `configError`, so a scheduled check
   * left it dead and silent for a minute at a time.
   *
   * What is NOT in here matters as much: no cooldown, no backoff, no schedule,
   * no pause. Those exist to keep the automatic side from looping, and a person
   * asking for one message is not a loop. The only transient entry is a prompt
   * already in flight, which clears itself in seconds.
   */
  runBlockedReason(s: AppSettings = this.getSettings()): string | null {
    if (!s.autoReloadEnabled) return 'Switch the feature on first.';
    const configError = this.configError(s);
    if (configError) return configError;
    if (this.sending) return 'A message is being sent right now — it takes a few seconds.';
    return null;
  }

  status(): AutoReloadStatus {
    const s = this.getSettings();
    const configError = this.configError(s);
    const active = s.autoReloadEnabled && !configError && !this.pausedReason;
    const iso = (ms: number | null): string | null => (ms ? new Date(ms).toISOString() : null);
    // Straight from the shared read state, so this panel says exactly what the
    // header widget says. A read of ours that failed and was then followed by a
    // successful one from anywhere else is not a problem worth reporting here.
    const read = this.usage.readState();
    return {
      enabled: s.autoReloadEnabled,
      active,
      configError,
      pausedReason: this.pausedReason,
      running: this.busy,
      sending: this.sending,
      verifying: this.verifyPending > 0,
      runBlockedReason: this.runBlockedReason(s),
      resetsAt: iso(this.resetsAt),
      nextCheckAt: active ? iso(this.nextCheckAt) : null,
      lastCheckAt: iso(this.lastCheckAt),
      lastError: read.lastError ?? this.lastCrash,
      lastReadAt: read.lastGoodAt,
      lastReadTrigger: read.lastTrigger,
      lastRun: this.lastRun,
      cliPath: this.cliPath ?? null,
    };
  }

  /**
   * Send the message now, because the user asked. Refused only by
   * `runBlockedReason()` — a configuration that could not work, or a prompt
   * already on its way out. Nothing about the schedule applies: not the
   * cooldown, not a backoff, not a check sleeping until the window expires, and
   * not a pause (a successful run is what clears one).
   *
   * It does NOT take the scheduler's `busy` mutex either, so a check running at
   * that moment cannot make the button dead. Overlapping is safe: the send
   * stamps `lastRunAt` before spawning, which puts the scheduler's own send
   * behind the cooldown, and `sending` stops the two ever overlapping anyway.
   *
   * Answers as soon as Claude has answered — a few seconds. The read-back that
   * confirms the window is a minute later and finishes in the background, on
   * `lastRun`, where the panel picks it up.
   */
  async runNow(): Promise<AutoReloadRun> {
    const s = this.getSettings();
    const blocked = this.runBlockedReason(s);
    if (blocked) {
      // Nothing else records a refusal, and "I pressed it and nothing
      // happened" has to be answerable from the log alone.
      log.warn(`"Send it now" refused: ${blocked}`);
      throw new Error(blocked);
    }
    return await this.reload(s, true, 'manual run');
  }

  private async tick(): Promise<void> {
    // Timers freeze while the machine sleeps, so a tick arriving far too late is
    // how we learn it woke up. Measure before anything can return early.
    const now = Date.now();
    const gap = this.lastTickAt > 0 ? now - this.lastTickAt : 0;
    this.lastTickAt = now;

    if (this.busy) return;
    const s = this.getSettings();
    if (!s.autoReloadEnabled || this.pausedReason) return;
    if (this.configError(s)) return;

    if (gap > SUSPEND_GAP_MS) {
      // The clock jumped while the network did not: the adapter is still coming
      // up and reading now just fails on the wire. Whatever went wrong before
      // the nap is history, so start the ladder over.
      this.readBackoffStep = 0;
      this.nextCheckAt = Math.max(now, this.nextCheckAt, now + RESUME_GRACE_MS);
      log.info(`back from ${Math.round(gap / 60_000)} min suspended — first check in ${RESUME_GRACE_MS / 1000} s`);
      return;
    }
    if (now < this.nextCheckAt) return;
    this.busy = true;
    try {
      await this.check(s);
      this.lastCrash = null;
    } catch (err) {
      this.lastCrash = err instanceof Error ? err.message : String(err);
      this.nextCheckAt = Date.now() + RETRY_MS;
      log.warn('check failed', err);
    } finally {
      this.busy = false;
    }
  }

  /** Read usage, then either sleep until the window expires or reload now. */
  private async check(s: AppSettings): Promise<void> {
    // A reading somebody else already paid for answers this just as well, as
    // long as it says the window is alive: `resets_at` does not move.
    const probe = await this.usage.probeFiveHour('auto-reload-check', { reuseWindowMs: REUSE_READ_MS });
    const age = Date.now() - probe.at;
    const source = age > 2_000 ? `the shared reading from ${Math.round(age / 1000)} s ago` : 'its own read';
    this.lastCheckAt = Date.now();

    if (!probe.ok) {
      /**
       * A stale token is the one failure that waiting cannot fix, and the one
       * this feature is uniquely able to fix: the token is refreshed by
       * running Claude Code, which is precisely the thing it exists to do.
       * Backing off here was absurd — five minutes later the token is just as
       * expired, and the fix was sitting behind the wait the whole time.
       *
       * Only `auth-stale` (a token that exists and has gone bad). With no
       * credentials at all there is nothing to refresh: `claude -p` would only
       * fail, so that one really does wait for a person.
       */
      if (probe.kind === 'auth-stale') {
        if (this.sendInFlight('the stored token is stale')) return;
        // Blind: with no reading there is no expiry to go on, so this is the one
        // send the cooldown still governs. Checked before the breaker, which
        // must only ever fire on a send we were really about to make.
        if (this.waitOutCooldown('the stored token is stale')) return;
        if (this.tooManySends('the stored token is stale')) return;
        // The error itself is on the `usage` line just above, verbatim.
        await this.reload(s, false, 'the stored token is stale, and running Claude Code is what refreshes it');
        return;
      }
      const ladder = probe.kind === 'network' ? NETWORK_BACKOFF_MS : READ_BACKOFF_MS;
      const wait = ladder[Math.min(this.readBackoffStep++, ladder.length - 1)];
      this.nextCheckAt = Date.now() + wait;
      // Nothing may have been asked at all: a 429 cooldown answers everyone
      // from the shared state. Saying "read failed" then would invent a
      // request that never left the machine.
      const what =
        age > 2_000
          ? `no read was made (the shared state still holds a failure from ${Math.round(age / 1000)} s ago: ${probe.kind}: ${probe.error})`
          : `usage read failed (${probe.kind}: ${probe.error})`;
      log.warn(`${what} — retrying in ${Math.round(wait / 1000)} s`);
      return;
    }
    this.readBackoffStep = 0;

    const resetsAt = probe.resetsAt ? Date.parse(probe.resetsAt) : NaN;
    if (Number.isFinite(resetsAt) && resetsAt > Date.now()) {
      this.sleepUntilReset(resetsAt, source);
      return;
    }

    /**
     * A successful read that reports no window is the clearest signal this
     * feature gets, and it is exactly what it exists to answer — so it sends,
     * with no cooldown in the way. That wait used to sit here too, and it cost
     * whole slices of window: sending five minutes before an expiry we could
     * not see (a stale token) left the real reload waiting out the remaining
     * twenty-five, and everything after it shifted by as much. The date the
     * endpoint gave us is what scheduled this check; second-guessing it now
     * would throw away the one piece of firm evidence we have.
     *
     * What still bounds this: nothing sends on a failed or stale reading, a run
     * that leaves the window unstarted is counted as a failure (three and it
     * pauses), and `tooManySends` caps the sessions outright.
     */
    this.resetsAt = null;
    if (this.sendInFlight('no 5-hour window')) return;
    if (this.tooManySends('no 5-hour window')) return;
    await this.reload(s, false, 'no 5-hour window');
  }

  /**
   * Stop for good when the automatic sends have become absurd. This is what
   * replaces a floor between sends: a floor delays on suspicion, before there is
   * anything to go on, while this looks at what has actually been sent and only
   * intervenes once the answer is beyond argument. Legitimate operation cannot
   * approach it — a window lasts five hours.
   *
   * The case it exists for is the one nothing else sees: sends that look fine
   * (a live window is read back each time) and yet achieve nothing, so
   * `MAX_FAILURES` never counts a thing. Pausing is right there, because if the
   * readings have stopped making sense, no amount of waiting will fix them and a
   * person should look.
   */
  private tooManySends(why: string): boolean {
    const now = Date.now();
    this.autoSends = this.autoSends.filter((at) => now - at < SEND_WINDOW_MS);
    if (this.autoSends.length < MAX_SENDS_PER_HOUR) return false;
    const first = Math.round((now - Math.min(...this.autoSends)) / 60_000);
    this.pausedReason =
      `Stopped: ${this.autoSends.length} messages sent in the last ${first} min and the 5-hour window still is not settling ` +
      `(${why} again). Save any auto-reload setting to try again.`;
    log.warn(this.pausedReason);
    return true;
  }

  /**
   * Stand down when a prompt is already on its way out. Only reachable when the
   * user pressed "Send it now" a fraction of a second before this check reached
   * its decision — that message does the same job, so wait for its read-back
   * rather than sending a second one.
   */
  private sendInFlight(why: string): boolean {
    if (!this.sending) return false;
    this.nextCheckAt = Date.now() + VERIFY_DELAY_MS + RESET_MARGIN_MS;
    log.info(`${why}, but a message is already being sent — leaving it to that one`);
    return true;
  }

  /**
   * The floor between two prompts sent BLIND — with no `resets_at` to act on,
   * which today means the stale-token path. There, half an hour is the right
   * answer: we are working from the absence of information, and repeating that
   * guess sooner learns nothing.
   *
   * It no longer governs the "no window" path. A successful read hands us the
   * expiry, the expiry is what schedules the check, and a wait that overrides it
   * spends real window time to protect against nothing (see the note in
   * `check()`). Nor does it bind a manual send — see `runNow()`.
   */
  private waitOutCooldown(why: string): boolean {
    const since = Date.now() - this.lastRunAt;
    if (this.lastRunAt === 0 || since >= COOLDOWN_MS) return false;
    this.nextCheckAt = this.lastRunAt + COOLDOWN_MS;
    log.info(`${why}, but the last reload was ${Math.round(since / 60_000)} min ago — waiting out the cooldown`);
    return true;
  }

  /** `source` says where the expiry came from — our own read, or someone else's. */
  private sleepUntilReset(resetsAt: number, source: string): void {
    this.resetsAt = resetsAt;
    this.nextCheckAt = resetsAt + RESET_MARGIN_MS;
    const hours = ((resetsAt - Date.now()) / 3_600_000).toFixed(1);
    log.info(`5-hour window runs until ${localStamp(resetsAt)} (${hours} h) — sleeping, per ${source}`);
  }

  /**
   * Send the prompt and hand the run back the moment Claude has answered. The
   * caller passes the `reason` it decided to send — there are three now, and a
   * line that always said "no 5-hour window" would be wrong two thirds of the
   * time.
   *
   * The read-back that confirms a window opened is a minute away and nobody
   * needs to be held up by it, so it runs detached in `verify()` and finishes
   * on the same `AutoReloadRun` object. Awaiting it here is what made "Send it
   * now" sit at "Sending…" for over a minute and kept the button dead for as
   * long: a response nobody waits for reads as a hang, and the useful part
   * (Claude answered, in 5 s, with this) was already known.
   */
  private async reload(s: AppSettings, manual: boolean, reason: string): Promise<AutoReloadRun> {
    // Belt and braces: every caller checks first, and this is the invariant.
    if (this.sending) throw new Error('A message is being sent right now — it takes a few seconds.');
    this.sending = true;
    const startedAt = Date.now();
    this.lastRunAt = startedAt;
    // Only the automatic ones: the breaker is about the schedule losing its
    // grip, and a person pressing the button is not that.
    if (!manual) this.autoSends.push(startedAt);
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
      windowAlreadyRunning: false,
      verifiedAt: null,
      manual,
    };
    this.lastRun = run;

    log.info(`${reason} — sending "${message}" (${s.autoReloadModel}) in ${cwd}`);
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
      log.info(`answered in ${run.durationMs} ms: ${run.reply ?? '(empty)'}`);
    } catch (err) {
      run.durationMs = Date.now() - startedAt;
      run.error = err instanceof Error ? err.message : String(err);
      run.verifiedAt = new Date().toISOString();
      // A path that resolved and then would not spawn is not a path: throw it
      // away so the next attempt resolves again, rather than re-launching the
      // one thing already known not to launch until a settings save says so.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        forgetClaudeCli();
        this.cliPath = undefined;
      }
      log.warn(`the prompt failed: ${run.error}`);
      this.countFailure(`the prompt failed (${run.error})`);
      return run;
    } finally {
      this.sending = false;
    }

    // Sleep past the read-back, so a tick cannot spend a read on figures we are
    // about to ask for anyway. The verify itself moves this to where it belongs.
    this.verifyPending++;
    this.nextCheckAt = Date.now() + VERIFY_DELAY_MS + RESET_MARGIN_MS;
    void this.verify(run);
    return run;
  }

  /**
   * The reply proves Claude answered, not that a window opened — so read the
   * figures back and finish the run's story on the object the UI is already
   * holding (`lastRun`). Detached on purpose: nothing is waiting for this, and
   * the wait before it is a full minute.
   *
   * A run superseded by a later one is still updated here; it simply is no
   * longer `lastRun`, so nobody looks at it.
   */
  private async verify(run: AutoReloadRun): Promise<void> {
    try {
      // A minute for the figures to settle. Forced: this is the one read whose
      // whole job is to see a change, so a reading taken before the prompt is
      // worse than useless here.
      await delay(VERIFY_DELAY_MS);
      const probe = await this.usage.probeFiveHour('auto-reload-verify', { force: true });
      this.lastCheckAt = Date.now();
      run.verifiedAt = new Date().toISOString();
      if (!probe.ok) {
        // A token still stale after Claude Code has just run is not a blip: the
        // one thing that refreshes it has happened and it did not take, so
        // sending again would be repeating something that demonstrably does not
        // work. Count it, and let MAX_FAILURES stop this by itself.
        if (probe.kind === 'auth-stale') {
          run.error = `sent, but the stored token is still stale afterwards (${probe.error})`;
          this.countFailure(run.error);
          log.warn(`${run.error}`);
          return;
        }
        // Otherwise blame the read, not the reload: the window may well have
        // started. The cooldown keeps this from turning into a stream of prompts.
        run.error = `sent, but the usage read-back failed (${probe.error})`;
        this.nextCheckAt = Date.now() + 2 * 60_000;
        log.warn(`${run.error}`);
        return;
      }
      const resetsAt = probe.resetsAt ? Date.parse(probe.resetsAt) : NaN;
      if (Number.isFinite(resetsAt) && resetsAt > Date.now()) {
        run.windowStarted = true;
        // Five hours out means our prompt opened it; four minutes out means it
        // was already running and this run refreshed a token, nothing more. Both
        // count as success, but only one of them started anything — and the
        // second leaves a reload owed at that expiry, which is why no wait may
        // come between here and it.
        run.windowAlreadyRunning = resetsAt < Date.parse(run.at) + WINDOW_MS - WINDOW_SLACK_MS;
        this.failures = 0;
        this.pausedReason = null;
        this.sleepUntilReset(
          resetsAt,
          run.windowAlreadyRunning
            ? 'the read-back after the prompt — the window was already running, so a reload is still due at its expiry'
            : 'the read-back after the prompt',
        );
        return;
      }
      run.error = 'the prompt ran but Anthropic still reports no 5-hour window';
      this.countFailure(run.error);
    } catch (err) {
      // Nothing is awaiting this, so an exception here would otherwise vanish
      // and leave the run frozen at "waiting to read the window back" forever.
      run.verifiedAt = new Date().toISOString();
      run.error = `sent, but the read-back threw: ${err instanceof Error ? err.message : String(err)}`;
      this.nextCheckAt = Date.now() + 2 * 60_000;
      log.warn('the read-back after the prompt failed', err);
    } finally {
      this.verifyPending--;
    }
  }

  private countFailure(reason: string): void {
    this.failures++;
    if (this.failures >= MAX_FAILURES) {
      this.pausedReason = `Stopped after ${this.failures} failed attempts: ${reason}`;
      log.warn(`${this.pausedReason}`);
      return;
    }
    this.nextCheckAt = Date.now() + RETRY_MS;
    log.warn(`attempt ${this.failures}/${MAX_FAILURES} failed — retrying in ${RETRY_MS / 60_000} min`);
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
