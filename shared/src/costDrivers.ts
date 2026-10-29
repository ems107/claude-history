/**
 * What made a session expensive — the reasons, beside the total.
 *
 * Claude Code's `/usage` (2.1.299+) answers the same question across sessions,
 * and its rules are the ones used here, read out of the 2.1.312 bundle: a
 * request belongs to `long_context` when it sent over 150k tokens, to
 * `max_effort` when its line says `"effort":"max"`, and the share of its INPUT
 * (everything but the output) that went on the always-on context and on large
 * tool results is that part's share of the context it sent. Two of those are
 * estimates and are drawn as such: a tool result's size, and the always-on
 * part, are counted in characters at 2.5 per token, the CLI's own ratio.
 *
 * **These overlap — they are not a partition.** One request can be long, at
 * max effort and carrying a large result all at once, so the figures never add
 * up to the total and must never be drawn as if they did.
 *
 * It is a tracker fed one transcript line at a time, in file order, by the
 * parser (for the session's panel) and the enricher (for the Stats page's
 * days), through `feedCostDrivers` in the server — so the two read the same
 * lines the same way and cannot disagree. It holds TOKENS only: the price table
 * is user-editable, and a cost is put on at read time.
 */
import type { MessageUsage } from './types.ts';

/** Characters per token, for the two estimates — the ratio Claude Code's `/usage` uses. */
export const CHARS_PER_TOKEN = 2.5;
/** A tool result over this many (estimated) tokens counts as large — `/usage`'s threshold. */
export const LARGE_RESULT_TOKENS = 10_000;
/** A request that sent more than this many tokens counts as long context — `/usage`'s threshold. */
export const LONG_CONTEXT_TOKENS = 150_000;

/** Usage by model, for one reason. Fractional where a request's input was shared out. */
export type UsageByModel = Record<string, MessageUsage>;

/** The reasons, as tokens to be priced — what a day bucket keeps and a session sums. */
export interface DriverUsage {
  /** Requests that sent over `LONG_CONTEXT_TOKENS`: the whole of each one. */
  longContext: UsageByModel;
  /** Requests at effort `max`: the whole of each one. */
  maxEffort: UsageByModel;
  /** ≈ The part of each request's input that was the context every request re-sends. */
  alwaysOn: UsageByModel;
  /** ≈ The part of each request's input that was large tool results still in the context. */
  largeResults: UsageByModel;
  /** Every request, by the effort its line names ('none' where it names none) — a partition, unlike the rest. */
  byEffort: Record<string, UsageByModel>;
}

/** One large tool result and what carrying it cost. */
export interface LargeResult {
  toolUseId: string;
  /** ≈ Tokens it added to the context. */
  tokens: number;
  /** Requests that carried it, the one it arrived in included. */
  requests: number;
  byModel: UsageByModel;
}

/** A session's reasons, as the parser hands them to the token panel. */
export interface SessionCostDrivers extends DriverUsage {
  /** ≈ The always-on context at the last request: the smallest any request has sent, less the first prompt. */
  alwaysOnTokens: number;
  /** How many requests fell in each reason. */
  counts: { longContext: number; maxEffort: number; alwaysOn: number; largeResults: number };
  /** Every large tool result, in the order they came back — the reader, who has the prices, sorts them. */
  largeResultList: LargeResult[];
}

/** What one request contributed to each reason — added to a session, or to a day. */
export interface RequestDrivers {
  model: string;
  effort: string;
  usage: MessageUsage;
  longContext: boolean;
  maxEffort: boolean;
  alwaysOn: MessageUsage | null;
  largeResults: MessageUsage | null;
  /** How `largeResults` divides among the results it is made of, and the tokens each holds. */
  results: Array<{ toolUseId: string; tokens: number; usage: MessageUsage }>;
}

export interface CostDriverTracker {
  /** Text sent before the first request (the first prompt, files attached to it): not always-on. */
  preamble(chars: number): void;
  /** A tool result came back; only a large one is remembered. */
  toolResult(toolUseId: string, chars: number): void;
  /**
   * A request was answered — call once per `message.id`, with the usage of its
   * first line. A carried-over request moves the context along but is not
   * counted: its parent paid for it. Null when it counts for nothing.
   */
  request(r: { model: string; usage: MessageUsage; effort: string | null; carried: boolean }): RequestDrivers | null;
  /** ≈ The always-on context as it stands. */
  alwaysOnTokens(): number;
}

export function emptyDriverUsage(): DriverUsage {
  return { longContext: {}, maxEffort: {}, alwaysOn: {}, largeResults: {}, byEffort: {} };
}

const zero = (): MessageUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cacheCreate1h: 0, cacheCreate5m: 0 });

function addUsage(into: MessageUsage, u: MessageUsage): void {
  into.input += u.input;
  into.output += u.output;
  into.cacheRead += u.cacheRead;
  into.cacheCreate += u.cacheCreate;
  into.cacheCreate1h += u.cacheCreate1h;
  into.cacheCreate5m += u.cacheCreate5m;
}

export function addToModel(into: UsageByModel, model: string, u: MessageUsage): void {
  addUsage((into[model] ??= zero()), u);
}

/** The input side of a request (everything but its output), times `share`. */
function inputShare(u: MessageUsage, share: number): MessageUsage {
  return {
    input: u.input * share,
    output: 0,
    cacheRead: u.cacheRead * share,
    cacheCreate: u.cacheCreate * share,
    cacheCreate1h: u.cacheCreate1h * share,
    cacheCreate5m: u.cacheCreate5m * share,
  };
}

/** One request's part, added to a session's or a day's reasons. */
export function addDrivers(into: DriverUsage, r: RequestDrivers): void {
  if (r.longContext) addToModel(into.longContext, r.model, r.usage);
  if (r.maxEffort) addToModel(into.maxEffort, r.model, r.usage);
  if (r.alwaysOn) addToModel(into.alwaysOn, r.model, r.alwaysOn);
  if (r.largeResults) addToModel(into.largeResults, r.model, r.largeResults);
  addToModel((into.byEffort[r.effort] ??= {}), r.model, r.usage);
}

export function costDriverTracker(): CostDriverTracker {
  let requests = 0;
  let preambleChars = 0;
  /** ≈ The always-on context: the smallest context sent so far, the first less its preamble. */
  let startTokens = 0;
  let lastContext = 0;
  /** What the previous request left in the context: what it sent and what it answered. */
  let carriedTokens = 0;
  /** Large results back since the previous request. */
  let pending: Array<{ toolUseId: string; chars: number }> = [];
  /** Large results still in the context, with the tokens each one holds. */
  const live: Array<{ toolUseId: string; tokens: number }> = [];

  return {
    preamble(chars) {
      if (requests === 0) preambleChars += chars;
    },
    toolResult(toolUseId, chars) {
      if (chars / CHARS_PER_TOKEN > LARGE_RESULT_TOKENS) pending.push({ toolUseId, chars });
    },
    request({ model, usage, effort, carried }) {
      const context = usage.input + usage.cacheRead + usage.cacheCreate;
      if (requests === 0) {
        startTokens = Math.max(0, context - preambleChars / CHARS_PER_TOKEN);
      } else if (context < lastContext) {
        // The context shrank — a compaction, stale results dropped, a rewind —
        // and what was dropped comes off the large results first, the way
        // `/usage` takes it; each keeps its share of what is left.
        const held = live.reduce((n, r) => n + r.tokens, 0);
        const left = Math.max(0, held - (lastContext - context));
        for (const r of live) r.tokens = held > 0 ? (r.tokens * left) / held : 0;
        for (let i = live.length - 1; i >= 0; i--) if (live[i].tokens <= 0) live.splice(i, 1);
      } else {
        // What the results that came back can account for of the growth: the
        // part of this context the previous request did not already hold.
        const pendingChars = pending.reduce((n, r) => n + r.chars, 0);
        const added = Math.min(context - carriedTokens, pendingChars / CHARS_PER_TOKEN);
        if (added > LARGE_RESULT_TOKENS) {
          for (const r of pending) live.push({ toolUseId: r.toolUseId, tokens: (added * r.chars) / pendingChars });
        }
      }
      startTokens = Math.min(startTokens, context);
      lastContext = context;
      carriedTokens = context + usage.output;
      pending = [];
      requests++;
      if (carried) return null;

      const share = (tokens: number): number => (context > 0 ? Math.min(1, tokens / context) : 0);
      const held = live.reduce((n, r) => n + r.tokens, 0);
      const largeResults = held > 0 ? inputShare(usage, share(held)) : null;
      return {
        model,
        effort: effort ?? 'none',
        usage,
        longContext: context > LONG_CONTEXT_TOKENS,
        maxEffort: effort === 'max',
        alwaysOn: startTokens > 0 ? inputShare(usage, share(startTokens)) : null,
        largeResults,
        results: largeResults
          ? live.map((r) => ({ toolUseId: r.toolUseId, tokens: r.tokens, usage: inputShare(largeResults, r.tokens / held) }))
          : [],
      };
    },
    alwaysOnTokens: () => startTokens,
  };
}

/** A session's reasons, summed from its requests in order. */
export function sessionDriverCollector(): {
  add(r: RequestDrivers | null): void;
  /** `alwaysOnTokens` is the tracker's, as it stood at the last request. */
  result(alwaysOnTokens: number): SessionCostDrivers;
} {
  const usage = emptyDriverUsage();
  const counts = { longContext: 0, maxEffort: 0, alwaysOn: 0, largeResults: 0 };
  const results = new Map<string, LargeResult>();
  return {
    add(r) {
      if (!r) return;
      addDrivers(usage, r);
      if (r.longContext) counts.longContext++;
      if (r.maxEffort) counts.maxEffort++;
      if (r.alwaysOn) counts.alwaysOn++;
      if (r.largeResults) counts.largeResults++;
      for (const part of r.results) {
        let one = results.get(part.toolUseId);
        if (!one) {
          one = { toolUseId: part.toolUseId, tokens: 0, requests: 0, byModel: {} };
          results.set(part.toolUseId, one);
        }
        // Its size where it was largest: the request it arrived in.
        one.tokens = Math.max(one.tokens, part.tokens);
        one.requests++;
        addToModel(one.byModel, r.model, part.usage);
      }
    },
    result(alwaysOnTokens) {
      return { ...usage, alwaysOnTokens, counts, largeResultList: [...results.values()] };
    },
  };
}
