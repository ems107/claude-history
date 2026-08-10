// Default model pricing in $ per million tokens, taken from Anthropic's
// official API price list (first-party rates). Cache read = 0.1x input; cache
// writes come in two TTLs and Claude Code uses BOTH — 1h (2x input) in a
// session transcript, 5m (1.25x input) in a subagent's, without exception in
// this corpus, so a single write rate overcharged every subagent message by
// 60% of its write cost. Claude Sonnet 5 has an introductory price
// ($2/$10 through 2026-08-31) — the sticker rate is used here; edit in the
// UI if you want the intro rate. All values are user-editable and stored in
// userdata.json.

export interface ModelPrices {
  input: number;
  output: number;
  cacheRead: number;
  /** 1-hour-TTL cache write (2x input) — what every SESSION transcript uses. */
  cacheWrite: number;
  /**
   * 5-minute-TTL cache write (1.25x input) — what every SUBAGENT transcript
   * uses. Optional so a price table saved before this existed keeps working:
   * `cacheWrite5mRate` derives it from the input rate when absent.
   */
  cacheWrite5m?: number;
}

export type PriceTable = Record<string, ModelPrices>;

/**
 * The table key that prices a model id, or null when nothing does.
 *
 * Claude Code records dated ids for some models (`claude-haiku-4-5-20251001`)
 * while the table is keyed by family (`claude-haiku-4-5`), and an exact-key
 * lookup silently priced those messages at $0 in every total — the session
 * cost, the stats dashboard and the price editor, which did not even show a row
 * for them. A trailing -YYYYMMDD is a snapshot of the same model at the same
 * rates, so it falls back to the family key.
 */
export function priceKey(model: string, table: PriceTable): string | null {
  if (table[model]) return model;
  const family = model.replace(/-\d{8}$/, '');
  return family !== model && table[family] ? family : null;
}

/** Prices for a model id, `undefined` when it has none — an unknown cost must never render as $0. */
export function resolvePrices(model: string | null, table: PriceTable): ModelPrices | undefined {
  if (!model) return undefined;
  const key = priceKey(model, table);
  return key ? table[key] : undefined;
}

/**
 * The rate a 5-minute cache write bills at. The table may not carry one (it
 * predates the field, or the docs stopped listing the column), and the official
 * ratio is 1.25x the input rate.
 */
export function cacheWrite5mRate(prices: ModelPrices): number {
  return prices.cacheWrite5m ?? prices.input * 1.25;
}

export const DEFAULT_PRICES: PriceTable = {
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 20, cacheWrite5m: 12.5 },
  'claude-mythos-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 20, cacheWrite5m: 12.5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10, cacheWrite5m: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10, cacheWrite5m: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10, cacheWrite5m: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10, cacheWrite5m: 6.25 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6, cacheWrite5m: 3.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6, cacheWrite5m: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2, cacheWrite5m: 1.25 },
};
