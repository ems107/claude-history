import type {
  MessageItem,
  MessageUsage,
  ModelPrices,
  PriceTable,
  SessionSummary,
  Turn,
  UsageTotals,
} from '@claude-history/shared';
import { cacheWrite5mRate, resolvePrices } from '@claude-history/shared';

/**
 * What a whole session would have cost through the API, summed per model
 * because each one bills at its own rates. `null` when it has not been
 * enriched yet or when no model in it has a price — an unknown cost must
 * never render as "$0.000".
 */
export function sessionCost(session: SessionSummary, prices: PriceTable): number | null {
  const byModel = session.enrichment?.usageByModel;
  if (!byModel) return null;
  let total: number | null = null;
  for (const [model, usage] of Object.entries(byModel)) {
    const cost = computeCost(usage, resolvePrices(model, prices));
    if (cost !== null) total = (total ?? 0) + cost;
  }
  return total;
}

/**
 * API-equivalent cost in $ for one usage block (prices are $ per MTok).
 *
 * Cache writes bill at the 1-hour rate here because that is what a session
 * transcript records — every one of them, verified. The aggregates this runs on
 * (`usageByModel`, `daily`) do not keep the TTL split, so a session that ever
 * wrote a 5-minute cache would need the split carried into the enrichment;
 * `computeMessageCost` is the one that knows it.
 */
export function computeCost(usage: UsageTotals, prices: ModelPrices | undefined): number | null {
  if (!prices) return null;
  return (
    (usage.input * prices.input +
      usage.output * prices.output +
      usage.cacheRead * prices.cacheRead +
      usage.cacheCreate * prices.cacheWrite) /
    1_000_000
  );
}

/**
 * Cost of ONE message, pricing each cache write at its own TTL: subagents write
 * 5-minute caches (1.25x input) and sessions 1-hour ones (2x input), so charging
 * everything at the 1h rate overstated every subagent message. Tokens the
 * transcript did not attribute to a TTL fall back to the 1h rate — the
 * conservative direction, and the shape of every line seen so far.
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

export function formatUsd(n: number | null): string {
  if (n === null) return '—';
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
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

export interface CostIndex {
  /** Running total of every priced message up to and INCLUDING that uuid. */
  cumulative: Map<string, number>;
  /** The priced assistant messages of each turn, in order. */
  perTurn: CostEntry[][];
  total: number | null;
}

/**
 * Costs of a whole conversation in one pass: per turn, and the running total at
 * each message. The turn entries cover every assistant message, including the
 * ones the viewer renders no header for (tool-only messages hold over half the
 * spend), so the turn totals always add up to the session total.
 */
export function buildCostIndex(turns: Turn[], prices: PriceTable): CostIndex {
  const cumulative = new Map<string, number>();
  const perTurn: CostEntry[][] = [];
  let running = 0;
  let anyPriced = false;

  for (const turn of turns) {
    const entries = costEntries(turn.items, prices);
    for (const e of entries) {
      if (e.cost !== null) {
        running += e.cost;
        anyPriced = true;
      }
      cumulative.set(e.uuid, running);
    }
    perTurn.push(entries);
  }

  return { cumulative, perTurn, total: anyPriced ? running : null };
}
