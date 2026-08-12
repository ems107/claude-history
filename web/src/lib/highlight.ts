import { foldWithMap, occurrences, type SearchQueryEcho } from '@claude-history/shared';

/**
 * What a search-result link asks the viewer to mark. The terms travel already
 * FOLDED — they are the ones the server echoed back, so what gets marked is
 * exactly what was matched, accents, case and collapsed whitespace included, and
 * the viewer never has to re-parse a query it did not run.
 */
export interface MatchHighlight {
  terms: string[];
  wholeWord: boolean;
}

/** One `hl` per term: a phrase term holds spaces, so a joined list could not be split back. */
const TERM_PARAM = 'hl';
const WHOLE_WORD_PARAM = 'hlw';
/** The registered name of the CSS highlight; `::highlight()` in styles.css must match. */
const HIGHLIGHT_NAME = 'search-match';
/** A term can match hundreds of times in one long answer; marks past this add nothing. */
const MAX_MARKS = 400;

/** The querystring a link into a session carries so the hit can be marked there. */
export function highlightSearchParams(query: SearchQueryEcho): URLSearchParams {
  const params = new URLSearchParams();
  for (const term of query.terms) params.append(TERM_PARAM, term);
  if (query.wholeWord) params.set(WHOLE_WORD_PARAM, '1');
  return params;
}

/** Null when the link carries no terms — an ordinary deep link, nothing to mark. */
export function parseHighlight(params: URLSearchParams): MatchHighlight | null {
  const terms = params.getAll(TERM_PARAM).filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  return { terms, wholeWord: params.get(WHOLE_WORD_PARAM) === '1' };
}

/** A cut in the concatenated text: which piece, and where inside it. */
export interface TextPoint {
  piece: number;
  offset: number;
}

export interface MatchSpan {
  start: TextPoint;
  end: TextPoint;
}

/**
 * Where the terms match across a run of text pieces — the DOM's text nodes, but
 * expressed as plain strings so this, the part that has to get its arithmetic
 * right, can be checked without a browser.
 *
 * The pieces are concatenated and folded ONCE rather than folded one by one:
 * markdown breaks a sentence into a text node per emphasis, link and code span,
 * and a phrase crossing one of those is exactly the kind a search finds and a
 * reader cannot. Folding per piece would also see a word's halves as two words,
 * which the whole-word rule would then judge on the wrong boundaries.
 */
export function matchSpans(texts: string[], hl: MatchHighlight, max = MAX_MARKS): MatchSpan[] {
  /** Where each piece starts in the concatenation. */
  const starts: number[] = [];
  let raw = '';
  for (const text of texts) {
    starts.push(raw.length);
    raw += text;
  }
  if (raw.length === 0) return [];

  const { folded, map } = foldWithMap(raw);
  const pointAt = (foldedIndex: number): TextPoint => {
    const rawIndex = foldedIndex < map.length ? map[foldedIndex] : raw.length;
    // The pieces are in order, so the last one starting at or before this index
    // holds it. An empty piece cannot win: it starts where the next one does and
    // the search takes the highest index, which lands on a piece with room.
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= rawIndex) low = mid;
      else high = mid - 1;
    }
    return { piece: low, offset: rawIndex - starts[low] };
  };

  const spans: MatchSpan[] = [];
  const seen = new Set<number>();
  for (const term of hl.terms) {
    for (const idx of occurrences(folded, term, hl.wholeWord)) {
      if (spans.length >= max) break;
      // Two terms can match the same run ("invalid" inside "is invalid"); one
      // mark is enough, and a duplicate would only cost work.
      if (seen.has(idx)) continue;
      seen.add(idx);
      spans.push({ start: pointAt(idx), end: pointAt(idx + term.length) });
    }
  }
  // Document order, so "the first" is the one nearest the top of the message.
  spans.sort((a, b) => a.start.piece - b.start.piece || a.start.offset - b.start.offset);
  return spans;
}

/**
 * Marks every occurrence of `hl` inside `root` and returns what it did.
 *
 * Nothing in the DOM is touched: the marks are `Range`s handed to the CSS Custom
 * Highlight API, so React keeps owning every node it rendered — inserting <mark>
 * elements into markdown it re-renders every few seconds in a live session is a
 * fight nobody wins — and clearing them is one `delete`. A browser without the
 * API gets no marks, and the bubble's own flash still says where the hit is.
 */
export function markMatches(root: HTMLElement, hl: MatchHighlight): { first: Range | null; clear: () => void } {
  const nothing = { first: null, clear: () => {} };
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return nothing;

  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data.length > 0) nodes.push(node as Text);
  }
  const spans = matchSpans(
    nodes.map((n) => n.data),
    hl,
  );
  if (spans.length === 0) return nothing;

  const ranges = spans.map((span) => {
    const range = document.createRange();
    range.setStart(nodes[span.start.piece], Math.min(span.start.offset, nodes[span.start.piece].data.length));
    range.setEnd(nodes[span.end.piece], Math.min(span.end.offset, nodes[span.end.piece].data.length));
    return range;
  });
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  return {
    first: ranges[0],
    clear: () => CSS.highlights.delete(HIGHLIGHT_NAME),
  };
}
