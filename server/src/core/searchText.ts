import {
  foldWithMap,
  occurrences,
  type SearchMode,
  type SearchSnippet,
  type SearchWordScope,
} from '@claude-history/shared';
import type { SearchBlock } from './enricher.ts';

// Finding a term is shared with the web (the viewer marks the words a search
// landed on), so it lives in `@claude-history/shared` and is re-exported here —
// the server's search paths were written against this module.
export { hasTerm, occurrences, parseTerms } from '@claude-history/shared';

export const SNIPPET_BEFORE = 60; // folded chars of context before the match
export const SNIPPET_AFTER = 90;

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ');
}

export interface SearchOptions {
  /** Restricts where to look: any subset of 'title' | 'user' | 'assistant'. */
  roles?: Set<string>;
  mode?: SearchMode;
  scope?: SearchWordScope;
  wholeWord?: boolean;
}

/** The role of the block holding a session's own id — see `matchesSessionIds`. */
export const ID_ROLE = 'id';

/**
 * Whether this query may look at session ids at all. The app writes ids as
 * their first eight characters (fork chips, lineage, the log), so pasting one
 * back has to find the session — but a uuid is 32 hex characters, and an
 * ordinary word made of a-f and digits ("cafe", "cada", "added") would drag in
 * whatever session happens to carry those letters somewhere inside its id, in a
 * row nobody was looking for. So: hex only, dashes allowed (they are part of a
 * pasted uuid) and four characters at the least.
 */
export function matchesSessionIds(terms: string[]): boolean {
  return terms.some((t) => /^[0-9a-f-]+$/.test(t) && t.replace(/-/g, '').length >= 4);
}

/**
 * Whether a scan must skip this block: the role restriction the request asked
 * for, plus the id rule above. One predicate for all four scan loops — the
 * search, the deep scan and the two paged match lists — because they have to
 * agree to the unit: a hit counting an id that its own "+N more matches" page
 * cannot find is a count that never reaches zero.
 */
export function skipBlock(role: string, roles: Set<string> | undefined, ids: boolean): boolean {
  if (roles && !roles.has(role)) return true;
  return role === ID_ROLE && !ids;
}

/** One place a query matched, as folded offsets, with the occurrences it accounts for. */
export interface MatchWindow {
  from: number;
  to: number;
  /** Occurrences assigned to this window; every one belongs to exactly one. */
  matches: number;
}

/**
 * EVERY place `terms` matched inside one folded block, in order — what the
 * search itself deliberately does not enumerate (it takes three anchors and
 * counts the rest) and what paging through a hit's matches needs.
 *
 * An occurrence is assigned to the first window that fully covers it, so the
 * windows' figures add up to the block's match count exactly. That is the whole
 * point: without it "showing 20 of 51 matches" could never reach 51, and the
 * fold would keep offering more of something already shown.
 *
 * Only the last window is tested for coverage, not all of them: the anchors
 * arrive sorted, so an earlier window can only reach further right when a long
 * term preceded a short one. Missing that case costs one extra window, never a
 * double count — and it keeps this linear on a block with thousands of matches.
 */
export function matchWindows(folded: string, terms: string[], wholeWord: boolean): MatchWindow[] {
  const found: Array<{ idx: number; len: number }> = [];
  for (const term of terms) {
    for (const idx of occurrences(folded, term, wholeWord)) found.push({ idx, len: term.length });
  }
  found.sort((a, b) => a.idx - b.idx || a.len - b.len);

  const windows: MatchWindow[] = [];
  for (const { idx, len } of found) {
    const last = windows[windows.length - 1];
    // Covered means "buildSnippet would mark it inside that window": the whole
    // occurrence has to fit, or it is a match the reader cannot see.
    if (last && idx >= last.from && idx + len <= last.to) {
      last.matches++;
      continue;
    }
    windows.push({
      from: Math.max(0, idx - SNIPPET_BEFORE),
      to: Math.min(folded.length, idx + len + SNIPPET_AFTER),
      matches: 1,
    });
  }
  return windows;
}

/**
 * One window of a block, cut at folded offsets and mapped back to the original
 * text, with every term that falls inside it marked — the anchor is only what
 * chose the window, not the only thing worth highlighting.
 */
export function buildSnippet(
  block: SearchBlock,
  folded: string,
  map: number[],
  startFold: number,
  endFold: number,
  terms: string[],
  wholeWord: boolean,
): SearchSnippet {
  const text = block.text;
  const at = (foldedIndex: number): number => (foldedIndex < map.length ? map[foldedIndex] : text.length);

  const ranges: [number, number][] = [];
  for (const term of terms) {
    for (const idx of occurrences(folded, term, wholeWord, startFold, endFold)) {
      ranges.push([idx, idx + term.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const parts: SearchSnippet['parts'] = [];
  const push = (chunk: string, hit?: true): void => {
    if (chunk) parts.push(hit ? { text: chunk, hit } : { text: chunk });
  };
  let cursor = startFold;
  let lead = startFold > 0 ? '…' : '';
  for (const [start, end] of ranges) {
    // Overlapping terms ("invalid" inside "is invalid") merge into one mark.
    if (end <= cursor) continue;
    push(lead + oneLine(text.slice(at(cursor), at(Math.max(start, cursor)))));
    lead = '';
    push(oneLine(text.slice(at(Math.max(start, cursor)), at(end))), true);
    cursor = end;
  }
  push(lead + oneLine(text.slice(at(cursor), at(endFold))) + (endFold < map.length ? '…' : ''));

  return {
    uuid: block.uuid,
    role: block.role,
    parts,
    toolUseId: block.toolUseId ?? null,
    agentId: block.agentId ?? null,
  };
}
