import type { CompactBoundary, MessageItem, MessageUsage, RecacheCause, Turn } from '@claude-history/shared';
import { recacheOf } from '@claude-history/shared';

/**
 * The context window, per request, from what the transcript already records.
 *
 * `input + cache_read + cache_creation` IS the prompt size Claude Code reports
 * in `/context` — checked against the four snapshots on this machine and off by
 * 12 to 35 tokens, which is exactly /context's rounding to 0.1k. So every
 * message can state its own context exactly, with no snapshot and no guessing.
 *
 * What canNOT be derived, and must never be shown as if it could:
 * - The per-category split (system prompt / tools / memory / skills / messages).
 *   The fixed overhead is not fixed: in the one session with snapshots it went
 *   from ~41.5k at the first request to 60.3-60.7k later, as deferred tool
 *   schemas, skills and memory files loaded. Only a `/context` snapshot knows it.
 * - The share of the window. The limit is nowhere in the transcript
 *   (`message.model` never carries the `[1m]` marker; only /context's own text
 *   does), and ~/.claude/settings.json holds today's choice, not the one in force
 *   months ago. So this file deals in tokens only — never percentages.
 */

/** A shrink smaller than this is noise, not a truncation worth marking. */
const SHRINK_MIN = 2000;

export interface ContextPoint {
  uuid: string;
  /** Ordinal of the request within the conversation. */
  index: number;
  timestamp: string | null;
  /** Last streamed chunk of the answer — where the gap to the next request starts. */
  endTimestamp: string | null;
  model: string | null;
  /** The run that wrote it: a change means a fresh CLI re-sent the conversation. */
  runId: string | null;
  /** Kept whole because pricing a re-cache needs the 1h/5m write split. */
  usage: MessageUsage;
  input: number;
  read: number;
  write: number;
  output: number;
  /** input + read + write — the number /context reports. */
  total: number;
  /** Change against the previous request; null on the first. */
  delta: number | null;
  /** From the end of the previous answer to the start of this request. */
  gapMs: number | null;
  /**
   * Context that was already cached and had to be written again here, billed at
   * the write rate instead of a tenth of it. Zero on a carried-over message: a
   * fork's copies were paid for in the parent.
   */
  recached: number;
  recacheCause: RecacheCause | null;
  /** Set when the context shrank into this request. */
  shrink: { from: number; to: number; compacted: CompactBoundary | null } | null;
}

export interface ContextTurn {
  first: ContextPoint;
  last: ContextPoint;
  requests: number;
  /** Every request inside the turn where the context shrank. */
  shrinks: ContextPoint[];
  /** Every request inside the turn that had to re-write cached context. */
  recaches: ContextPoint[];
  recached: number;
}

export interface ContextIndex {
  points: ContextPoint[];
  byUuid: Map<string, ContextPoint>;
  perTurn: Array<ContextTurn | null>;
  max: number;
  shrinks: ContextPoint[];
  recaches: ContextPoint[];
  recachedTotal: number;
}

function pointOf(item: MessageItem, index: number): ContextPoint | null {
  const u = item.usage;
  if (item.role !== 'assistant' || !u) return null;
  return {
    uuid: item.uuid,
    index,
    timestamp: item.timestamp,
    endTimestamp: item.endTimestamp,
    model: item.model,
    runId: item.runId,
    usage: u,
    input: u.input,
    read: u.cacheRead,
    write: u.cacheCreate,
    output: u.output,
    total: u.input + u.cacheRead + u.cacheCreate,
    delta: null,
    gapMs: null,
    recached: 0,
    recacheCause: null,
    shrink: null,
  };
}

/** Idle time between two requests: from the end of one answer to the start of the next. */
function gapBetween(previous: ContextPoint, point: ContextPoint): number | null {
  const from = Date.parse(previous.endTimestamp ?? previous.timestamp ?? '');
  const to = Date.parse(point.timestamp ?? '');
  return Number.isNaN(from) || Number.isNaN(to) ? null : Math.max(0, to - from);
}

export function buildContextIndex(turns: Turn[]): ContextIndex {
  const points: ContextPoint[] = [];
  const byUuid = new Map<string, ContextPoint>();
  const perTurn: ContextIndex['perTurn'] = [];
  const shrinks: ContextPoint[] = [];
  const recaches: ContextPoint[] = [];
  // A compaction line sits between two requests: it belongs to the next one.
  let pendingCompaction: CompactBoundary | null = null;
  let previous: ContextPoint | null = null;

  for (const turn of turns) {
    let first: ContextPoint | null = null;
    let last: ContextPoint | null = null;
    let requests = 0;
    const turnShrinks: ContextPoint[] = [];
    const turnRecaches: ContextPoint[] = [];

    for (const item of turn.items) {
      const boundary = item.blocks.find((b) => b.kind === 'compact');
      if (boundary?.kind === 'compact') pendingCompaction = boundary.boundary;

      if (byUuid.has(item.uuid)) continue;
      const point = pointOf(item, points.length);
      if (!point) continue;

      if (previous) {
        point.delta = point.total - previous.total;
        point.gapMs = gapBetween(previous, point);
        // A fork's copies were billed in the parent, so whatever they re-wrote
        // is the parent's story, not this session's.
        const event = item.carriedOver
          ? null
          : recacheOf(previous, point, {
              compactedBetween: pendingCompaction !== null,
              modelChanged: previous.model !== point.model,
              // Only a change between two KNOWN ids is a change: older
              // transcripts carry no `session_id` at all.
              runChanged: previous.runId !== null && point.runId !== null && previous.runId !== point.runId,
              gapMs: point.gapMs,
            });
        if (event) {
          point.recached = event.tokens;
          point.recacheCause = event.cause;
          recaches.push(point);
          turnRecaches.push(point);
        }
        if (point.delta <= -SHRINK_MIN) {
          point.shrink = { from: previous.total, to: point.total, compacted: pendingCompaction };
          shrinks.push(point);
          turnShrinks.push(point);
        }
      }
      pendingCompaction = null;
      points.push(point);
      byUuid.set(point.uuid, point);
      first ??= point;
      last = point;
      requests++;
      previous = point;
    }

    perTurn.push(
      first && last
        ? {
            first,
            last,
            requests,
            shrinks: turnShrinks,
            recaches: turnRecaches,
            recached: turnRecaches.reduce((n, p) => n + p.recached, 0),
          }
        : null,
    );
  }

  return {
    points,
    byUuid,
    perTurn,
    max: points.reduce((m, p) => Math.max(m, p.total), 0),
    shrinks,
    recaches,
    recachedTotal: recaches.reduce((n, p) => n + p.recached, 0),
  };
}

export function formatContextTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** A gap between two requests, read at a glance: "17 s", "82 min", "3 h 26 min". */
export function formatGap(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * Why the cached context had to be written again.
 *
 * `unknown` says so outright instead of reaching for the likeliest-sounding
 * cause: 11 events in this corpus have no local explanation at all, and
 * Anthropic's cache is best-effort. A plausible wrong reason would be worse
 * than an admitted unknown, and this is the line the user reads to decide
 * whether their own habits caused it.
 */
export function recacheCauseText(cause: RecacheCause | null, gapMs: number | null): string | null {
  const gap = gapMs === null ? null : formatGap(gapMs);
  switch (cause) {
    case 'ttl-expired':
      return `The 1-hour cache had expired${gap ? ` — ${gap} since the previous request` : ''}.`;
    case 'new-run':
      return 'The session was resumed from a fresh CLI, which re-sent the whole conversation.';
    case 'model-changed':
      return 'The model changed, and a cache entry belongs to one model.';
    case 'unknown':
      return gap
        ? `The cached prefix was invalidated — only ${gap} had passed, so the 1-hour cache had not expired.`
        : 'The cached prefix was invalidated, with the 1-hour cache still in date.';
    default:
      return null;
  }
}

/** "+21.7k" / "-785k" — a context delta always carries its sign. */
export function formatContextDelta(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}${formatContextTokens(Math.abs(n))}`;
}
