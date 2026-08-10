import type { SearchMode, SearchSnippet, SearchWordScope } from '@claude-history/shared';
import type { SearchBlock } from './enricher.ts';

export const SNIPPET_BEFORE = 60; // folded chars of context before the match
export const SNIPPET_AFTER = 90;
/** More than this and the query is a paragraph, not a search. */
const MAX_TERMS = 8;
/** A single character matches half the corpus and still costs a full scan. */
const MIN_TERM_LENGTH = 2;
const WORD_CHAR = /[\p{L}\p{N}]/u;

const WHITESPACE = /\s/;
/** Nonspacing marks: the diacritics themselves, once NFD has split them off. */
const DIACRITIC = /\p{Mn}/u;

/**
 * How one UTF-16 unit folds: the lowercased base letter of its NFD decomposition
 * ("ó" → "o"), a single space for anything blank, and nothing at all for a
 * diacritic — so text already decomposed ("o" + U+0301, which is what a paste
 * from macOS carries) folds exactly like its composed form.
 *
 * Half of a surrogate pair falls through untouched (normalize leaves unpaired
 * surrogates alone, and neither property matches one), so the two halves are
 * emitted in turn and the pair survives whole.
 */
function foldUnit(unit: string): string {
  if (WHITESPACE.test(unit)) return ' ';
  if (DIACRITIC.test(unit)) return '';
  return unit.normalize('NFD').charAt(0).toLowerCase();
}

/**
 * Latin-1 holds every accent this corpus uses, so those 256 units are folded
 * once at startup and looked up afterwards. It is the same function that fills
 * the table and handles everything above it, so the fast path cannot disagree
 * with the slow one — and calling normalize() per character instead costs 13
 * MB/s against 100, which is the difference between reading the transcripts on
 * demand and not being able to.
 */
const LATIN1_FOLD = Array.from({ length: 256 }, (_, code) => foldUnit(String.fromCharCode(code)));

/**
 * The single folding loop, shared so the mapped and unmapped variants cannot
 * drift. Every run of whitespace collapses to one space, and `map` (when given)
 * receives the original index of each folded unit — for a run, that of its first
 * character — which is how snippet offsets map back.
 */
function foldInto(text: string, map: number[] | null): string {
  let out = '';
  let inRun = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const folded = code < 256 ? LATIN1_FOLD[code] : foldUnit(text[i]);
    if (folded === '') continue;
    if (folded === ' ') {
      if (inRun) continue;
      inRun = true;
    } else {
      inRun = false;
    }
    out += folded;
    map?.push(i);
  }
  return out;
}

/**
 * Folds haystack and needle alike, which is why collapsing whitespace matters:
 * pasted logs, XML and stack traces wrap, so a searched phrase must not depend
 * on where the line happened to break ("is invalid according" sat across a
 * newline and could not be found). Snippets are rendered through oneLine()
 * regardless — without this, the text shown and the text searched differ.
 */
export function foldText(text: string): string {
  return foldInto(text, null);
}

export function foldWithMap(text: string): { folded: string; map: number[] } {
  const map: number[] = [];
  return { folded: foldInto(text, map), map };
}

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
