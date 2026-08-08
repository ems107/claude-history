import type { ModelPrices, PriceTable, SessionSummary, UsageTotals } from '@claude-history/shared';

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
    const cost = computeCost(usage, prices[model]);
    if (cost !== null) total = (total ?? 0) + cost;
  }
  return total;
}

/** API-equivalent cost in $ for one usage block (prices are $ per MTok). */
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
