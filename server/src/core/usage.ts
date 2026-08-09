import type { AppSettings, UsageResponse, UsageTrigger, UsageWindow } from '@claude-history/shared';
import { MIN_USAGE_INTERVAL_SECONDS, MIN_USAGE_RATE_LIMIT_SECONDS } from '@claude-history/shared';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describeFetchError } from '../util/fetchError.ts';
import { createLogger, localStamp } from './logger.ts';

const log = createLogger('usage');

// Claude subscription usage (the same numbers `/usage` shows in Claude Code):
// GET api.anthropic.com/api/oauth/usage with the OAuth access token stored in
// <dataRoot>/.credentials.json. Verified against Claude Code 2.1.223.
//
// STRICTLY READ-ONLY. We never refresh the token and never write to the
// credentials file: refreshing rotates it and writes back, which would race
// with Claude Code and could invalidate the user's real session. An expired
// token is reported as such instead.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
const FETCH_TIMEOUT_MS = 15_000;

interface RawWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

interface RawUsage {
  five_hour?: RawWindow;
  seven_day?: RawWindow;
  seven_day_opus?: RawWindow;
  seven_day_sonnet?: RawWindow;
  limits?: Array<{
    kind?: string;
    percent?: number;
    resets_at?: string | null;
    scope?: { model?: { display_name?: string | null } | null } | null;
  }>;
}

function toWindow(key: string, label: string, w: RawWindow | undefined): UsageWindow | null {
  if (!w || typeof w.utilization !== 'number') return null;
  return { key, label, utilization: w.utilization, resetsAt: w.resets_at ?? null };
}

/** The two headline windows plus any per-model weekly limits the plan reports. */
export function normalizeUsage(raw: RawUsage): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const push = (w: UsageWindow | null) => {
    if (w) windows.push(w);
  };
  push(toWindow('five_hour', '5-hour session', raw.five_hour));
  push(toWindow('seven_day', 'Week (all models)', raw.seven_day));
  push(toWindow('seven_day_opus', 'Week (Opus)', raw.seven_day_opus));
  push(toWindow('seven_day_sonnet', 'Week (Sonnet)', raw.seven_day_sonnet));
  for (const limit of raw.limits ?? []) {
    const name = limit.scope?.model?.display_name;
    if (limit.kind !== 'weekly_scoped' || !name || typeof limit.percent !== 'number') continue;
    if (windows.some((w) => w.label === `Week (${name})`)) continue;
    windows.push({
      key: `weekly_scoped_${name}`,
      label: `Week (${name})`,
      utilization: limit.percent,
      resetsAt: limit.resets_at ?? null,
    });
  }
  return windows;
}

/**
 * Why a read failed. Worth distinguishing because the right wait is completely
 * different: `network` means the wire was down (a laptop waking up is back in
 * seconds), while `http` (429, 5xx) and `auth` want to be left alone for
 * minutes.
 */
export type ProbeFailure = 'network' | 'http' | 'auth';

/**
 * Outcome of reading the 5-hour window, with "the read failed" kept strictly
 * apart from "there is no window right now". UsageResponse conflates the two
 * (both end up as `available:false`), and the auto-reload decision hinges on
 * the difference: a failed read must never be taken as "window not started".
 *
 * `at` is when the reading it comes from was taken, so a caller reusing an
 * older one can say how old it was instead of implying it just asked.
 */
export type FiveHourProbe =
  | { ok: true; resetsAt: string | null; at: number }
  | { ok: false; error: string; kind: ProbeFailure; at: number };

/**
 * What caused a read, beyond the trigger's name. The trigger says which
 * mechanism fired; this says what actually happened — which session Claude
 * answered in, or that the browser could not attribute the read at all.
 */
export interface ReadCause {
  /** Goes in the log message, in parentheses after the trigger. */
  text: string;
  /** Goes in `data`, as evidence. */
  data?: Record<string, unknown>;
}

/**
 * Announced on `events` after every read. Anyone who was going to ask for the
 * same thing can take this instead — that is the whole point of it existing.
 */
export interface UsageReadEvent {
  trigger: UsageTrigger;
  probe: FiveHourProbe;
}

/** The shared read state: what the last attempt did, whoever made it. */
export interface UsageReadState {
  /** When the last successful read happened, null if there has never been one. */
  lastGoodAt: string | null;
  /** When the last attempt happened, successful or not. */
  lastAttemptAt: string | null;
  /** Which trigger made that attempt. */
  lastTrigger: UsageTrigger | null;
  /** Why the last attempt failed; null when it succeeded. */
  lastError: string | null;
  lastErrorKind: ProbeFailure | null;
}

/**
 * The single source of truth for subscription usage.
 *
 * Every reader in the app goes through this one object — the header widget and
 * the auto-reload scheduler alike — so they can never disagree about the
 * figures or about whether the stored token works. Two rules make that real:
 *
 *   - a failed read NEVER discards the last good figures; the failure is
 *     recorded beside them (`readState`), so a blip does not erase what we know
 *   - every successful read is announced (`events.on('read')`), so a reader
 *     that was about to ask can just use it instead. That is what stops the
 *     scheduler from spending a network call on a `resets_at` the widget read
 *     twenty seconds earlier.
 */
export class UsageService {
  /** What /api/usage answers with right now. */
  private cached: UsageResponse | null = null;
  /** Last response that actually carried figures, kept to survive a blip. */
  private lastGood: UsageResponse | null = null;
  private lastGoodAt = 0;
  private lastFetchMs = 0;
  private lastTrigger: UsageTrigger | null = null;
  private lastError: string | null = null;
  private lastErrorKind: ProbeFailure | null = null;
  private inFlight: Promise<UsageResponse> | null = null;
  /** Set by a 429: nothing but a manual refresh asks again until then. */
  private rateLimitedUntil = 0;
  /** Derived from the same read as `cached` — see FiveHourProbe. */
  private probe: FiveHourProbe = { ok: false, error: 'Usage has not been read yet.', kind: 'network', at: 0 };

  /** 'read' — a read finished. Successful ones carry the 5-hour expiry. */
  readonly events = new EventEmitter();

  constructor(
    private readonly dataRoot: string,
    private readonly getSettings: () => AppSettings,
  ) {}

  /** The configured floor between real reads, never below the hard one. */
  private floorMs(): number {
    const configured = this.getSettings().usageMinIntervalSeconds;
    const seconds = Number.isFinite(configured) ? configured : MIN_USAGE_INTERVAL_SECONDS;
    return Math.max(MIN_USAGE_INTERVAL_SECONDS, Math.round(seconds)) * 1000;
  }

  /** The configured 429 cooldown, never below the hard one. */
  private rateLimitBackoffMs(): number {
    const configured = this.getSettings().usageRateLimitBackoffSeconds;
    const seconds = Number.isFinite(configured) ? configured : MIN_USAGE_RATE_LIMIT_SECONDS;
    return Math.max(MIN_USAGE_RATE_LIMIT_SECONDS, Math.round(seconds)) * 1000;
  }

  readState(): UsageReadState {
    const iso = (ms: number): string | null => (ms > 0 ? new Date(ms).toISOString() : null);
    return {
      lastGoodAt: iso(this.lastGoodAt),
      lastAttemptAt: iso(this.lastFetchMs),
      lastTrigger: this.lastTrigger,
      lastError: this.lastError,
      lastErrorKind: this.lastErrorKind,
    };
  }

  /**
   * The figures, read if they are older than the floor and reused if not.
   *
   * Every call is logged with the `trigger` that caused it, because several
   * unrelated things hit this endpoint and "who asked, and when" is otherwise
   * impossible to reconstruct. A real read is `info`; being served what we
   * already had, or joining a read in flight, is `debug` — neither asked
   * Anthropic anything, and at `info` they would drown the reads that did.
   */
  async get(trigger: UsageTrigger, opts: { force?: boolean; cause?: ReadCause } = {}): Promise<UsageResponse> {
    const label = opts.cause ? `${trigger} (${opts.cause.text})` : trigger;
    const age = Date.now() - this.lastFetchMs;
    const floor = this.floorMs();
    // A 429 takes over from the floor: the endpoint has just said we ask too
    // much, and answering that by asking again a minute later is not an answer.
    if (!opts.force && this.cached && Date.now() < this.rateLimitedUntil) {
      const left = Math.round((this.rateLimitedUntil - Date.now()) / 1000);
      log.debug(`${label}: rate limited, ${left} s of the cooldown left — nothing was asked`, {
        trigger,
        cached: true,
        rateLimited: true,
        cooldownLeftMs: this.rateLimitedUntil - Date.now(),
        ...opts.cause?.data,
      });
      return this.cached;
    }
    if (!opts.force && this.cached && age < floor) {
      log.debug(`${label}: reused the figures read ${Math.round(age / 1000)} s ago (${floor / 1000} s floor) — nothing was asked`, {
        trigger,
        cached: true,
        ageMs: age,
        ...opts.cause?.data,
      });
      return this.cached;
    }
    if (this.inFlight) {
      log.debug(`${label}: joined the read already in flight — nothing extra was asked`, {
        trigger,
        joined: true,
        ...opts.cause?.data,
      });
      return this.inFlight;
    }
    this.inFlight = this.fetchUsage(trigger, opts.cause).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * The 5-hour window's expiry, from the shared cache when that is good enough
   * and from the network when it is not. Used by the auto-reload scheduler,
   * which needs to tell a missing window from a failed read.
   *
   * `reuseWindowMs` is deliberately narrow: an existing reading is reused only
   * when it says the window is ALIVE past that moment. A reading that reports
   * no window is the one thing worth confirming first-hand, because acting on
   * it spawns a Claude session.
   */
  async probeFiveHour(
    trigger: UsageTrigger,
    opts: { force?: boolean; reuseWindowMs?: number } = {},
  ): Promise<FiveHourProbe> {
    const reuse = opts.reuseWindowMs ?? 0;
    if (!opts.force && reuse > 0 && this.probe.ok && this.probe.resetsAt) {
      const resetsAt = Date.parse(this.probe.resetsAt);
      const age = Date.now() - this.probe.at;
      if (age <= reuse && Number.isFinite(resetsAt) && resetsAt > Date.now()) return this.probe;
    }
    await this.get(trigger, { force: opts.force });
    return this.probe;
  }

  private async fetchUsage(trigger: UsageTrigger, cause?: ReadCause): Promise<UsageResponse> {
    const startedAt = Date.now();
    const label = cause ? `${trigger} (${cause.text})` : trigger;
    /**
     * Whatever the outcome, it is now the shared answer to "what happened
     * last". Called AFTER the log line: subscribers react synchronously and
     * write lines of their own, and the reaction reading before the read it
     * reacted to would make the timeline a puzzle.
     */
    const record = (error: string | null, kind: ProbeFailure | null): void => {
      this.lastFetchMs = Date.now();
      this.lastTrigger = trigger;
      this.lastError = error;
      this.lastErrorKind = kind;
      this.events.emit('read', { trigger, probe: this.probe });
    };

    // Only ever used for credential problems, which no amount of retrying fixes.
    const empty = (error: string, subscriptionType: string | null = null): UsageResponse => {
      const result: UsageResponse = { available: false, error, windows: [], fetchedAt: null, subscriptionType, stale: false };
      this.cached = result;
      this.probe = { ok: false, error, kind: 'auth', at: Date.now() };
      // Credentials, not a blip: the user has to do something about it.
      log.error(`${label}: cannot read Claude usage — ${error}`, { trigger, kind: 'auth', ...cause?.data });
      record(error, 'auth');
      return result;
    };

    // A blip (offline, timeout, 5xx) must not blank the widget: keep the last
    // figures and say they are old. Credential problems are NOT transient —
    // those blank it, because the user has to act on them.
    const transient = (error: string, kind: ProbeFailure, subscriptionType: string | null = null): UsageResponse => {
      if (!this.lastGood) {
        const result: UsageResponse = { available: false, error, windows: [], fetchedAt: null, subscriptionType, stale: false };
        this.cached = result;
        this.probe = { ok: false, error, kind, at: Date.now() };
        log.warn(`${label}: read failed (${kind}: ${error}) — and there are no earlier figures to fall back on`, {
          trigger,
          kind,
          ms: Date.now() - startedAt,
          ...cause?.data,
        });
        record(error, kind);
        return result;
      }
      const result: UsageResponse = {
        ...this.lastGood,
        error,
        stale: true,
        subscriptionType: subscriptionType ?? this.lastGood.subscriptionType,
      };
      this.cached = result;
      // The figures are worth showing while old; they are NOT worth deciding on.
      this.probe = { ok: false, error, kind, at: Date.now() };
      const age = Math.round((Date.now() - this.lastGoodAt) / 1000);
      log.warn(`${label}: read failed (${kind}: ${error}) — keeping the figures from ${age} s ago, marked stale`, {
        trigger,
        kind,
        stale: true,
        ms: Date.now() - startedAt,
        ...cause?.data,
      });
      record(error, kind);
      return result;
    };

    // Re-read every time: Claude Code rotates the access token in place.
    let oauth: { accessToken?: string; expiresAt?: number; subscriptionType?: string };
    try {
      const text = await fs.readFile(path.join(this.dataRoot, '.credentials.json'), 'utf8');
      oauth = (JSON.parse(text) as { claudeAiOauth?: typeof oauth }).claudeAiOauth ?? {};
    } catch {
      return empty('No Claude credentials found — sign in with Claude Code first.');
    }
    if (!oauth.accessToken) return empty('The credentials file has no OAuth access token.');
    if (typeof oauth.expiresAt === 'number' && Date.now() >= oauth.expiresAt) {
      return empty('The stored Claude token has expired — run Claude Code once to refresh it.', oauth.subscriptionType ?? null);
    }

    try {
      const res = await fetch(USAGE_URL, {
        headers: {
          authorization: `Bearer ${oauth.accessToken}`,
          'anthropic-beta': OAUTH_BETA,
          'content-type': 'application/json',
          'user-agent': 'claude-history (local personal tool)',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 401) {
        return empty('Claude rejected the stored token — run Claude Code once to refresh it.', oauth.subscriptionType ?? null);
      }
      if (res.status === 429) {
        // Stop asking, for everyone. Recorded before `transient` logs, so the
        // failure line and this one read in the order they happened.
        const backoff = this.rateLimitBackoffMs();
        this.rateLimitedUntil = Date.now() + backoff;
        log.warn(`${label}: rate limited by Anthropic — no read until ${localStamp(this.rateLimitedUntil)} (${backoff / 1000} s)`, {
          trigger,
          rateLimited: true,
          backoffMs: backoff,
        });
        return transient('Usage endpoint answered HTTP 429 (rate limited)', 'http', oauth.subscriptionType ?? null);
      }
      if (!res.ok) return transient(`Usage endpoint answered HTTP ${res.status}`, 'http', oauth.subscriptionType ?? null);
      const raw = (await res.json()) as RawUsage;
      // Read off the raw payload, not the normalized windows: a window that has
      // not started comes back as `five_hour: null` or without `resets_at`, and
      // normalizeUsage drops it — indistinguishable from an error downstream.
      this.probe = { ok: true, resetsAt: raw.five_hour?.resets_at ?? null, at: Date.now() };
      const windows = normalizeUsage(raw);
      const result: UsageResponse = {
        available: windows.length > 0,
        error: windows.length > 0 ? null : 'The usage response had no known limit windows.',
        windows,
        fetchedAt: new Date().toISOString(),
        subscriptionType: oauth.subscriptionType ?? null,
        stale: false,
      };
      this.cached = result;
      // It answered, so whatever it was annoyed about is over — a manual
      // Refresh getting through is exactly how a user finds that out.
      this.rateLimitedUntil = 0;
      if (windows.length > 0) {
        this.lastGood = result;
        this.lastGoodAt = Date.now();
      }
      // The 5-hour figures go in the message itself: they are what every caller
      // is really after, and what a later "was the window free at 03:00?" needs.
      const five = raw.five_hour;
      const resetsAt = five?.resets_at ?? null;
      const fiveText = five
        ? `5-hour ${five.utilization ?? 0}% ${resetsAt ? `resets ${localStamp(resetsAt)}` : '(not started)'}`
        : '5-hour (not started)';
      // The division of labour between the two: `msg` is for reading, in the
      // app's local convention; `data` is the evidence, kept exactly as
      // Anthropic sent it — UTC timestamps, unused dollar fields and all. An
      // undocumented endpoint can change shape without telling us, and a log
      // that quietly normalised it away would hide that.
      log.info(`${label}: read Claude usage — ${fiveText}`, {
        trigger,
        ms: Date.now() - startedAt,
        fiveHour: five ?? null,
        windows: windows.length,
        ...cause?.data,
      });
      record(null, null);
      return result;
    } catch (err) {
      return transient(describeFetchError(err), 'network', oauth.subscriptionType ?? null);
    }
  }
}
