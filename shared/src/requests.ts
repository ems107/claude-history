/**
 * What changed between two consecutive API requests, read off their
 * `api-request` lines (CLI 2.1.300+).
 *
 * These are FACTS, not causes: of the 101 times the system prompt or the tools
 * changed between two requests in this corpus, 4 came with a re-cached prefix —
 * most are deferred tools loading, which the API absorbs without a miss. So a
 * change is something to show beside a re-cache, never a verdict on it; the
 * verdict is `recacheOf`'s, and it puts the TTL first.
 *
 * In `shared/` because the enricher and the viewer both ask it, for the same
 * reason `recache.ts` is.
 */
import type { RequestFacts, RequestTables } from './types.ts';

export type RequestChange =
  /** No `base`: the CLI started over and sent the whole conversation afresh. */
  | { kind: 'new-chain' }
  /** It kept fewer of the previous request's messages than that one sent. */
  | { kind: 'history-rewritten' }
  /** `chars` is the system prompt's growth, negative when it shrank. */
  | { kind: 'system-prompt'; chars: number }
  /** Empty `added` and `removed`: the same tools, with a definition changed. */
  | { kind: 'tools'; added: string[]; removed: string[] }
  /** The shape changed and the transcript does not hold one of the two shapes. */
  | { kind: 'shape' }
  | { kind: 'effort'; from: string | null; to: string | null }
  | { kind: 'thinking'; from: string | null; to: string | null }
  | { kind: 'thinking-display'; from: string | null; to: string | null }
  | { kind: 'betas'; added: string[]; removed: string[] }
  | { kind: 'cache-control'; from: string; to: string }
  | { kind: 'context-management' };

const minus = (a: string[], b: string[]): string[] => a.filter((x) => !b.includes(x));

/** Every difference between two requests, in the order Claude Code's own `/cost` lists them. */
export function requestChanges(prev: RequestFacts, cur: RequestFacts, tables: RequestTables): RequestChange[] {
  const changes: RequestChange[] = [];
  if (cur.newChain) changes.push({ kind: 'new-chain' });
  else if (cur.rewritten) changes.push({ kind: 'history-rewritten' });

  if (prev.shapeHash !== cur.shapeHash) {
    const before = prev.shapeHash ? tables.shapes[prev.shapeHash] : undefined;
    const after = cur.shapeHash ? tables.shapes[cur.shapeHash] : undefined;
    if (before && after) {
      if (before.systemHash !== after.systemHash) {
        changes.push({ kind: 'system-prompt', chars: after.systemChars - before.systemChars });
      }
      if (before.toolsHash !== after.toolsHash) {
        changes.push({ kind: 'tools', added: minus(after.tools, before.tools), removed: minus(before.tools, after.tools) });
      }
    } else {
      changes.push({ kind: 'shape' });
    }
  }
  if (prev.effort !== cur.effort) changes.push({ kind: 'effort', from: prev.effort, to: cur.effort });
  if (prev.thinking !== cur.thinking) changes.push({ kind: 'thinking', from: prev.thinking, to: cur.thinking });
  if (prev.thinkingDisplay !== cur.thinkingDisplay) {
    changes.push({ kind: 'thinking-display', from: prev.thinkingDisplay, to: cur.thinkingDisplay });
  }
  if (prev.betasKey !== cur.betasKey) {
    const before = prev.betasKey ? (tables.betas[prev.betasKey] ?? []) : [];
    const after = cur.betasKey ? (tables.betas[cur.betasKey] ?? []) : [];
    changes.push({ kind: 'betas', added: minus(after, before), removed: minus(before, after) });
  }
  if (prev.cacheControl !== cur.cacheControl) {
    changes.push({ kind: 'cache-control', from: prev.cacheControl, to: cur.cacheControl });
  }
  if (prev.contextManagement !== cur.contextManagement) changes.push({ kind: 'context-management' });
  return changes;
}
