import type {
  MessageItem,
  MessageUsage,
  ModelPrices,
  PriceTable,
  RecacheCause,
  SessionSummary,
  Turn,
} from '@claude-history/shared';
import { cacheWrite5mRate, resolvePrices } from '@claude-history/shared';

/**
 * What a session cost, in the two halves it is really made of. `null` where
 * nothing can be priced — not enriched yet, or no model with a price — because
 * an unknown cost must never render as "$0.000".
 *
 * **A figure can also be PART of the cost**: a session that ran on two models,
 * one of them missing from the price table, has a price for one half of its
 * usage and none for the other. The figures then hold the priced half and
 * `unpriced` names what they leave out, so every reader can say so
 * (`formatUsd(cost, partial)`) instead of passing the half off as the whole.
 */
export interface SessionCostParts {
  /** The requests in this transcript: what the per-message pills add up to. */
  own: number | null;
  /** The agents it sent out, in their own conversations. Null when it sent none. */
  subagents: number | null;
  /** What the session cost, which is the two together — the figure to lead with. */
  total: number | null;
  /** Models with usage in each half and no price: in none of the figures above. */
  unpriced: { own: string[]; subagents: string[] };
}

const add = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : a + b);

export function sessionCostParts(session: SessionSummary, prices: PriceTable): SessionCostParts {
  const unpriced = { own: [] as string[], subagents: [] as string[] };
  const e = session.enrichment;
  if (!e) return { own: null, subagents: null, total: null, unpriced };
  // Both halves keep the TTL split and are priced with it: an agent's writes are
  // mostly 5-minute ones, and some sessions' are too, so a flat 1-hour rate
  // overcharges them by 60% of the write — and stops adding up to the pills.
  let own: number | null = null;
  for (const [model, usage] of Object.entries(e.usageByModel)) {
    const cost = computeMessageCost(usage, resolvePrices(model, prices));
    if (cost === null) unpriced.own.push(model);
    own = add(own, cost);
  }
  let subagents: number | null = null;
  for (const [model, usage] of Object.entries(e.subagentUsageByModel ?? {})) {
    const cost = computeMessageCost(usage, resolvePrices(model, prices));
    if (cost === null) unpriced.subagents.push(model);
    subagents = add(subagents, cost);
  }
  return { own, subagents, total: add(own, subagents), unpriced };
}

/** Every model a session's cost leaves out, both halves, each once. */
export function unpricedOf(parts: SessionCostParts): string[] {
  return [...new Set([...parts.unpriced.own, ...parts.unpriced.subagents])];
}

/** The hover on a session's cost, wherever it is drawn: the split, and what it leaves out. */
export function describeSessionCost(parts: SessionCostParts, subagentCount: number): string {
  const missing = unpricedOf(parts);
  const split =
    parts.subagents !== null
      ? `${formatUsd(parts.own, parts.unpriced.own.length > 0)} in this conversation + ${formatUsd(
          parts.subagents,
          parts.unpriced.subagents.length > 0,
        )} in ${subagentCount} subagent${subagentCount === 1 ? '' : 's'} — API-equivalent value at the configured prices`
      : 'API-equivalent value at the configured prices — not actual subscription spend (see Stats)';
  return missing.length > 0 ? `${split}. Plus the usage of ${missing.join(', ')}, which has no price` : split;
}

/**
 * What the session cost, agents included. This is the number the list, the sort
 * and the stats use: a session that delegates its work to eleven agents spent
 * that money as surely as one that did the work itself, and reading only the
 * parent's own requests understated it by 8x in the worst case here.
 */
export function sessionCost(session: SessionSummary, prices: PriceTable): number | null {
  return sessionCostParts(session, prices).total;
}

/**
 * API-equivalent cost in $ of a usage block — one message or any sum of them
 * (prices are $ per MTok) — pricing each cache write at its own TTL: subagents
 * write 5-minute caches (1.25x input) and sessions mostly 1-hour ones (2x
 * input), so charging everything at the 1h rate overstated every subagent
 * message, and every session that wrote 5-minute ones too. Tokens the
 * transcript did not attribute to a TTL fall back to the 1h rate — the
 * conservative direction.
 */
export function computeMessageCost(usage: MessageUsage, prices: ModelPrices | undefined): number | null {
  if (!prices) return null;
  const unattributed = Math.max(0, usage.cacheCreate - usage.cacheCreate1h - usage.cacheCreate5m);
  return (
    (usage.input * prices.input +
      usage.output * prices.output +
      usage.cacheRead * prices.cacheRead +
      (usage.cacheCreate1h + unattributed) * prices.cacheWrite +
      usage.cacheCreate5m * cacheWrite5mRate(prices)) /
    1_000_000
  );
}

// ---- re-cached context ----

/**
 * What re-writing already-cached context cost, in the two forms that have to be
 * shown together.
 *
 * `billed` alone suggests the tokens would otherwise have been free; `extra`
 * alone hides how big the event was. The money fields are null when the model
 * has no price — an unknown cost never renders as $0.
 */
export interface RecacheCost {
  tokens: number;
  /** What those tokens cost as a cache write. */
  billed: number | null;
  /** What they would have cost had the cache held. */
  ifRead: number | null;
  /** `billed - ifRead`: the part the re-write alone is responsible for. */
  extra: number | null;
  /** Some of `tokens` belong to a model with no price, so the money leaves them out. */
  partial: boolean;
}

/**
 * The rate a message's cache writes actually billed at, blending the TTLs it
 * used. A subagent writes 5-minute caches (1.25x input) and a session 1-hour
 * ones (2x), so a fixed rate would overcharge one of them by 60% of the write.
 * Tokens with no TTL recorded fall back to 1h, the way `computeMessageCost` does.
 */
function blendedWriteRate(usage: MessageUsage, prices: ModelPrices): number {
  if (usage.cacheCreate <= 0) return prices.cacheWrite;
  const unattributed = Math.max(0, usage.cacheCreate - usage.cacheCreate1h - usage.cacheCreate5m);
  const total =
    (usage.cacheCreate1h + unattributed) * prices.cacheWrite + usage.cacheCreate5m * cacheWrite5mRate(prices);
  return total / usage.cacheCreate;
}

export function recacheCost(usage: MessageUsage, recached: number, prices: ModelPrices | undefined): RecacheCost {
  if (!prices) return { tokens: recached, billed: null, ifRead: null, extra: null, partial: false };
  const billed = (recached * blendedWriteRate(usage, prices)) / 1_000_000;
  const ifRead = (recached * prices.cacheRead) / 1_000_000;
  return { tokens: recached, billed, ifRead, extra: billed - ifRead, partial: false };
}

/** One re-cached request, structurally — so this file and `context.ts` need not know each other. */
export interface RecachedRequest {
  model: string | null;
  usage: MessageUsage;
  recached: number;
  recacheCause: RecacheCause | null;
  gapMs: number | null;
}

/** What a pill shows about a re-cache: the money, and the reason for it. */
export interface RecacheSummary {
  cost: RecacheCost;
  /**
   * The cause of the LARGEST event in the group. A run of tool calls can lose
   * its cache twice for different reasons, and naming the small one would
   * explain the wrong thing.
   */
  cause: RecacheCause | null;
  gapMs: number | null;
}

/** Null when nothing in `requests` was re-cached, which is the usual case. */
export function summariseRecache(requests: RecachedRequest[], prices: PriceTable): RecacheSummary | null {
  const cost = sumRecacheCost(requests, prices);
  if (!cost) return null;
  const worst = requests.reduce<RecachedRequest | null>(
    (best, r) => (r.recached > 0 && (!best || r.recached > best.recached) ? r : best),
    null,
  );
  return { cost, cause: worst?.recacheCause ?? null, gapMs: worst?.gapMs ?? null };
}

/** The re-cache across several requests, each priced at its own model's rates. */
export function sumRecacheCost(requests: RecachedRequest[], prices: PriceTable): RecacheCost | null {
  let tokens = 0;
  let billed: number | null = null;
  let ifRead: number | null = null;
  let partial = false;
  for (const r of requests) {
    if (r.recached <= 0) continue;
    tokens += r.recached;
    const one = recacheCost(r.usage, r.recached, resolvePrices(r.model, prices));
    if (one.billed !== null && one.ifRead !== null) {
      billed = (billed ?? 0) + one.billed;
      ifRead = (ifRead ?? 0) + one.ifRead;
    } else {
      partial = true;
    }
  }
  if (tokens === 0) return null;
  return { tokens, billed, ifRead, extra: billed === null || ifRead === null ? null : billed - ifRead, partial };
}

/**
 * A cost for display. Null is "—", never "$0.000": nothing in it had a price.
 * `partial` is the other half of the same rule — a sum that left out the usage
 * of a model with no price is the priced part and a `+`, never the priced part
 * passed off as the whole.
 */
export function formatUsd(n: number | null, partial = false): string {
  if (n === null) return '—';
  const more = partial ? '+' : '';
  if (n >= 100) return `$${n.toFixed(0)}${more}`;
  if (n >= 1) return `$${n.toFixed(2)}${more}`;
  return `$${n.toFixed(3)}${more}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ---- per-message cost (viewer) ----

/** One priced assistant message. `cost` is null when its model has no price. */
export interface CostEntry {
  uuid: string;
  model: string | null;
  effort: string | null;
  usage: MessageUsage;
  cost: number | null;
  /** Wall time from the first streamed chunk to the last, when both are known. */
  elapsedMs: number | null;
}

export function costEntry(item: MessageItem, prices: PriceTable): CostEntry | null {
  if (item.role !== 'assistant' || !item.usage) return null;
  const start = item.timestamp ? Date.parse(item.timestamp) : Number.NaN;
  const end = item.endTimestamp ? Date.parse(item.endTimestamp) : Number.NaN;
  return {
    uuid: item.uuid,
    model: item.model,
    effort: item.effort,
    usage: item.usage,
    cost: computeMessageCost(item.usage, resolvePrices(item.model, prices)),
    elapsedMs: Number.isNaN(start) || Number.isNaN(end) ? null : Math.max(0, end - start),
  };
}

/** The priced messages among `items`, in order and each one only once. */
export function costEntries(items: MessageItem[], prices: PriceTable): CostEntry[] {
  const seen = new Set<string>();
  const entries: CostEntry[] = [];
  for (const item of items) {
    if (seen.has(item.uuid)) continue;
    const entry = costEntry(item, prices);
    if (entry) {
      seen.add(item.uuid);
      entries.push(entry);
    }
  }
  return entries;
}

export function sumUsage(entries: CostEntry[]): MessageUsage {
  const total: MessageUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cacheCreate1h: 0, cacheCreate5m: 0 };
  for (const e of entries) {
    total.input += e.usage.input;
    total.output += e.usage.output;
    total.cacheRead += e.usage.cacheRead;
    total.cacheCreate += e.usage.cacheCreate;
    total.cacheCreate1h += e.usage.cacheCreate1h;
    total.cacheCreate5m += e.usage.cacheCreate5m;
  }
  return total;
}

/** Total of the priced entries, or null when none of them has a price. */
export function sumCost(entries: CostEntry[]): number | null {
  let total: number | null = null;
  for (const e of entries) {
    if (e.cost !== null) total = (total ?? 0) + e.cost;
  }
  return total;
}

/** The models of the entries `sumCost` had to leave out, each once. */
export function unpricedModels(entries: CostEntry[]): string[] {
  return [...new Set(entries.filter((e) => e.cost === null).map((e) => e.model ?? 'unknown model'))];
}

export interface CostIndex {
  /** Running total of every priced message up to and INCLUDING that uuid. */
  cumulative: Map<string, number>;
  /** The uuids whose running total leaves out an unpriced message before them. */
  cumulativePartial: Set<string>;
  /** The priced assistant messages of each turn, in order. */
  perTurn: CostEntry[][];
  total: number | null;
  /** Some message of the session has no price, so `total` leaves it out. */
  partial: boolean;
}

/**
 * Costs of a whole conversation in one pass: per turn, and the running total at
 * each message. The turn entries cover every assistant message, including the
 * ones the viewer renders no header for (tool-only messages hold over half the
 * spend), so the turn totals always add up to the session total.
 */
export function buildCostIndex(turns: Turn[], prices: PriceTable): CostIndex {
  const cumulative = new Map<string, number>();
  const cumulativePartial = new Set<string>();
  const perTurn: CostEntry[][] = [];
  let running = 0;
  let anyPriced = false;
  let anyUnpriced = false;

  for (const turn of turns) {
    const entries = costEntries(turn.items, prices);
    for (const e of entries) {
      if (e.cost !== null) {
        running += e.cost;
        anyPriced = true;
      } else {
        anyUnpriced = true;
      }
      cumulative.set(e.uuid, running);
      if (anyUnpriced) cumulativePartial.add(e.uuid);
    }
    perTurn.push(entries);
  }

  return { cumulative, cumulativePartial, perTurn, total: anyPriced ? running : null, partial: anyUnpriced };
}
