/**
 * Context that was already cached and had to be paid for again.
 *
 * Claude Code caches the prompt prefix with a 1-hour TTL, refreshed on every
 * hit. Come back later and the whole conversation is re-sent as a cache WRITE
 * (2x input) instead of a cache READ (0.1x) — on this corpus, 11.4% of the
 * API-equivalent spend, $155 of $1,366, in 55 events across 19 of 59 sessions.
 * A single one of them cost $16.38: 818,840 tokens after an 82-minute pause.
 *
 * It is measured, not guessed. `read[i] == read[i-1] + write[i-1]` holds in
 * 96.4% of the 5,873 consecutive request pairs here, and what breaks it has no
 * grey zone: of the 60 pairs that lost anything, NONE lost less than 1,000
 * tokens and 57 lost more than 20,000. The cache either survives to the token
 * or collapses, so the threshold below is a formality rather than a tuning knob.
 *
 * This lives in `shared/` for the same reason `fold.ts` does: the enricher and
 * the viewer both answer this question, and a hand-kept second copy drifts.
 */

/** The two cache figures of one request — all the arithmetic needs. */
export interface CacheState {
  read: number;
  write: number;
}

/**
 * Tokens that the previous request had cached and this one had to write again.
 *
 * Capped at what was actually written: the shortfall alone would over-report
 * wherever the context legitimately restarts, and nothing can be re-written
 * that was not written.
 */
export function recachedTokens(prev: CacheState, current: CacheState): number {
  return Math.min(Math.max(0, prev.read + prev.write - current.read), current.write);
}

/** Below this it is not a cache loss. Measured: zero events between 1 and 1,000 tokens. */
export const RECACHE_MIN_TOKENS = 1000;

/** The TTL Claude Code writes in session transcripts (`ephemeral_1h`). */
export const CACHE_TTL_MS = 60 * 60 * 1000;

export type RecacheCause = 'ttl-expired' | 'new-run' | 'model-changed' | 'unknown';

export interface RecacheSignals {
  /** A `compact_boundary` sits between the two requests. */
  compactedBetween: boolean;
  modelChanged: boolean;
  /** `session_id` differs: a fresh CLI resumed the session and re-sent everything. */
  runChanged: boolean;
  /** Time from the end of the previous request to the start of this one. */
  gapMs: number | null;
}

export interface RecacheEvent {
  tokens: number;
  cause: RecacheCause;
}

/**
 * The cause, most sufficient explanation first.
 *
 * The TTL outranks the others because past an hour the cache was gone whatever
 * else happened — naming a model switch there would blame the wrong thing and
 * hide the one the user can act on. Below the hour those become the answer, and
 * a fresh CLI having re-sent everything two minutes after the last reply is
 * genuinely the interesting case.
 *
 * `unknown` is not a placeholder for "probably the TTL". 11 events here have no
 * local explanation at all — in `797db462` a cache written 17 seconds earlier is
 * simply not reused — and Anthropic's cache is best-effort. A plausible wrong
 * cause is worse than an admitted unknown.
 */
function causeOf(signals: RecacheSignals): RecacheCause {
  if (signals.gapMs !== null && signals.gapMs >= CACHE_TTL_MS) return 'ttl-expired';
  if (signals.runChanged) return 'new-run';
  if (signals.modelChanged) return 'model-changed';
  return 'unknown';
}

/**
 * The re-cache between two consecutive requests, or null when there is none.
 *
 * A compaction is null rather than an event: `postTokens` is a NEW, smaller
 * context written for the first time, not the old one written twice, and
 * counting it would bill the user for a saving.
 */
export function recacheOf(prev: CacheState, current: CacheState, signals: RecacheSignals): RecacheEvent | null {
  if (signals.compactedBetween) return null;
  const tokens = recachedTokens(prev, current);
  if (tokens < RECACHE_MIN_TOKENS) return null;
  return { tokens, cause: causeOf(signals) };
}
