import {
  foldText,
  foldWithMap,
  type SearchMode,
  type SearchSnippet,
  type SearchWordScope,
} from '@claude-history/shared';
import type { SearchBlock } from './enricher.ts';

export const SNIPPET_BEFORE = 60; // folded chars of context before the match
export const SNIPPET_AFTER = 90;
/** More than this and the query is a paragraph, not a search. */
const MAX_TERMS = 8;
/** A single character matches half the corpus and still costs a full scan. */
const MIN_TERM_LENGTH = 2;
const WORD_CHAR = /[\p{L}\p{N}]/u;

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

/**
 * Folds the query and splits it into the terms to look for: in 'words' mode on
 * the single spaces the fold left behind, keeping anything double-quoted
 * together; in 'phrase' mode not at all. A phrase is just the one-term case,
 * which is why a single scan serves both modes.
 *
 * Nothing shorter than MIN_TERM_LENGTH survives, and an empty query yields no
 * terms at all — which is what keeps indexOf away from the empty string, found
 * at every position and never advancing the scan.
 */
export function parseTerms(query: string, mode: SearchMode): string[] {
  const folded = foldText(query.trim());
  if (!folded) return [];
  if (mode === 'phrase') return [folded];
  const terms: string[] = [];
  for (const m of folded.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim();
    if (term.length >= MIN_TERM_LENGTH && !terms.includes(term)) terms.push(term);
  }
  return terms.slice(0, MAX_TERMS);
}

/** A match is a whole word when neither side of it is a letter or a digit. */
function isWholeWord(folded: string, idx: number, len: number): boolean {
  const before = idx > 0 ? folded[idx - 1] : '';
  const after = folded[idx + len] ?? '';
  return !WORD_CHAR.test(before) && !WORD_CHAR.test(after);
}

/**
 * Folded positions of `term` at or after `from`, stopping past `until`.
 * A rejected boundary advances by one, not by the term's length: the match it
 * turned down can still overlap a later one that qualifies.
 */
export function* occurrences(
  folded: string,
  term: string,
  wholeWord: boolean,
  from = 0,
  until = Number.MAX_SAFE_INTEGER,
): Generator<number> {
  let at = from;
  let idx: number;
  while ((idx = folded.indexOf(term, at)) !== -1 && idx + term.length <= until) {
    if (wholeWord && !isWholeWord(folded, idx, term.length)) {
      at = idx + 1;
      continue;
    }
    yield idx;
    at = idx + term.length;
  }
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

  return { uuid: block.uuid, role: block.role, parts };
}
