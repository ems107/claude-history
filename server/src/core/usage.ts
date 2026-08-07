import type { UsageResponse, UsageWindow } from '@claude-history/shared';
import fs from 'node:fs/promises';
import path from 'node:path';

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
/** Floor on how often we call the (rate-limited) endpoint, whatever the UI asks for. */
const MIN_REFETCH_MS = 15_000;

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

export class UsageService {
  private cached: UsageResponse | null = null;
  /** Last response that actually carried figures, kept to survive a blip. */
  private lastGood: UsageResponse | null = null;
  private lastFetchMs = 0;
  private inFlight: Promise<UsageResponse> | null = null;

  constructor(private readonly dataRoot: string) {}

  /**
   * Cached result. The floor is MIN_REFETCH_MS and nothing else: callers drive
   * the cadence (session activity in the UI, plus a slow idle poll), and this
   * only stops a burst of triggers from becoming a burst of requests.
   */
  async get(force = false): Promise<UsageResponse> {
    if (!force && this.cached && Date.now() - this.lastFetchMs < MIN_REFETCH_MS) return this.cached;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchUsage().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchUsage(): Promise<UsageResponse> {
    const empty = (error: string, subscriptionType: string | null = null): UsageResponse => {
      const result: UsageResponse = { available: false, error, windows: [], fetchedAt: null, subscriptionType, stale: false };
      this.cached = result;
      this.lastFetchMs = Date.now();
      return result;
    };

    // A blip (offline, timeout, 5xx) must not blank the widget: keep the last
    // figures and say they are old. Credential problems are NOT transient —
    // those blank it, because the user has to act on them.
    const transient = (error: string, subscriptionType: string | null = null): UsageResponse => {
      if (!this.lastGood) return empty(error, subscriptionType);
      const result: UsageResponse = {
        ...this.lastGood,
        error,
        stale: true,
        subscriptionType: subscriptionType ?? this.lastGood.subscriptionType,
      };
      this.cached = result;
      this.lastFetchMs = Date.now();
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
      if (!res.ok) return transient(`Usage endpoint answered HTTP ${res.status}`, oauth.subscriptionType ?? null);
      const windows = normalizeUsage((await res.json()) as RawUsage);
      const result: UsageResponse = {
        available: windows.length > 0,
        error: windows.length > 0 ? null : 'The usage response had no known limit windows.',
        windows,
        fetchedAt: new Date().toISOString(),
        subscriptionType: oauth.subscriptionType ?? null,
        stale: false,
      };
      this.cached = result;
      if (windows.length > 0) this.lastGood = result;
      this.lastFetchMs = Date.now();
      return result;
    } catch (err) {
      return transient(err instanceof Error ? err.message : String(err), oauth.subscriptionType ?? null);
    }
  }
}
