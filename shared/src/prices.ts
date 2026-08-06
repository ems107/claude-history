// Default model pricing in $ per million tokens, taken from Anthropic's
// official API price list (first-party rates). Cache read = 0.1x input;
// cache write defaults to the 1-hour-TTL rate (2x input) because Claude Code
// uses 1h prompt caching. Claude Sonnet 5 has an introductory price
// ($2/$10 through 2026-08-31) — the sticker rate is used here; edit in the
// UI if you want the intro rate. All values are user-editable and stored in
// userdata.json.

export interface ModelPrices {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type PriceTable = Record<string, ModelPrices>;

export const DEFAULT_PRICES: PriceTable = {
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 20 },
  'claude-mythos-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 20 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 },
};
