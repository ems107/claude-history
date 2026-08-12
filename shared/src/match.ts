// Where a folded needle sits in a folded haystack. It lives here, beside the
// fold itself, for the same reason the fold does: the server scans with it and
// the viewer now marks the words a search landed on with it, and a second
// implementation of the whole-word rule would disagree with the first the day
// somebody fixed one of them.

import { foldText } from './fold.ts';
import type { SearchMode } from './api.ts';

/** More than this and the query is a paragraph, not a search. */
const MAX_TERMS = 8;
/** A single character matches half the corpus and still costs a full scan. */
export const MIN_TERM_LENGTH = 2;
const WORD_CHAR = /[\p{L}\p{N}]/u;

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

/** Whether a term is in a folded block at all — the whole-word rule makes `indexOf` too generous. */
export function hasTerm(folded: string, term: string, wholeWord: boolean): boolean {
  for (const _ of occurrences(folded, term, wholeWord)) return true;
  return false;
}
