import type { CompactBoundary, MessageItem, Turn } from '@claude-history/shared';

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
  input: number;
  read: number;
  write: number;
  output: number;
  /** input + read + write — the number /context reports. */
  total: number;
  /** Change against the previous request; null on the first. */
  delta: number | null;
  /**
   * Nothing was read from cache although this is not the first request: the
   * whole prompt was re-written, which bills at the write rate instead of a
   * tenth of it.
   */
  cacheMiss: boolean;
  /** Set when the context shrank into this request. */
  shrink: { from: number; to: number; compacted: CompactBoundary | null } | null;
}

export interface ContextTurn {
  first: ContextPoint;
  last: ContextPoint;
  requests: number;
  /** Every request inside the turn where the context shrank. */
  shrinks: ContextPoint[];
}

export interface ContextIndex {
  points: ContextPoint[];
  byUuid: Map<string, ContextPoint>;
  perTurn: Array<ContextTurn | null>;
  max: number;
  shrinks: ContextPoint[];
}

function pointOf(item: MessageItem, index: number): ContextPoint | null {
  const u = item.usage;
  if (item.role !== 'assistant' || !u) return null;
  return {
    uuid: item.uuid,
    index,
    timestamp: item.timestamp,
    input: u.input,
    read: u.cacheRead,
    write: u.cacheCreate,
    output: u.output,
    total: u.input + u.cacheRead + u.cacheCreate,
    delta: null,
    cacheMiss: false,
    shrink: null,
  };
}

export function buildContextIndex(turns: Turn[]): ContextIndex {
  const points: ContextPoint[] = [];
  const byUuid = new Map<string, ContextPoint>();
  const perTurn: ContextIndex['perTurn'] = [];
  const shrinks: ContextPoint[] = [];
  // A compaction line sits between two requests: it belongs to the next one.
  let pendingCompaction: CompactBoundary | null = null;
  let previous: ContextPoint | null = null;

  for (const turn of turns) {
    let first: ContextPoint | null = null;
    let last: ContextPoint | null = null;
    let requests = 0;
    const turnShrinks: ContextPoint[] = [];

    for (const item of turn.items) {
      const boundary = item.blocks.find((b) => b.kind === 'compact');
      if (boundary?.kind === 'compact') pendingCompaction = boundary.boundary;

      if (byUuid.has(item.uuid)) continue;
      const point = pointOf(item, points.length);
      if (!point) continue;

      if (previous) {
        point.delta = point.total - previous.total;
        point.cacheMiss = point.read === 0;
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

    perTurn.push(first && last ? { first, last, requests, shrinks: turnShrinks } : null);
  }

  return { points, byUuid, perTurn, max: points.reduce((m, p) => Math.max(m, p.total), 0), shrinks };
}

export function formatContextTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** "+21.7k" / "-785k" — a context delta always carries its sign. */
export function formatContextDelta(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}${formatContextTokens(Math.abs(n))}`;
}
