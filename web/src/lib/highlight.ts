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
/** Which tool call to open, when the hit was in one. */
export const TOOL_PARAM = 'tool';
/** The registered name of the CSS highlight; `::highlight()` in styles.css must match. */
const HIGHLIGHT_NAME = 'search-match';
/**
 * The find bar's own two, kept separate from the one above on purpose: a deep
 * link arriving while the bar is open would otherwise replace the bar's whole
 * set with its own handful and then delete it 8 seconds later.
 */
export const FIND_NAME = 'find-match';
export const FIND_CURRENT_NAME = 'find-current';
/** A term can match hundreds of times in one long answer; marks past this add nothing. */
const MAX_MARKS = 400;
/** The same idea over a whole conversation rather than one box. */
const MAX_FIND_MARKS = 4000;
/** And per box, so one 20,000-character tool result cannot eat the whole budget. */
const MAX_BOX_MARKS = 1000;
/** No cap at all: what "the 137th occurrence in this box" needs. */
const NO_CAP = Number.MAX_SAFE_INTEGER;
/** The two elements marks are allowed inside — see `markMatches` on why. */
const BOX_SELECTOR = '[data-bubble-body], [data-tool-id]';

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
 * How much of a scroller's bottom is hidden by something stuck to it. The
 * conversation's own scroller reaches the foot of the window with the composer
 * stuck inside it, so its last stretch is *in* the box and *behind* the box:
 * "already in view" has to stop above that, or a match in the last message is
 * revealed by leaving it exactly where nothing can be read.
 */
function stuckToBottom(scroller: Element): number {
  const stuck = scroller.querySelector<HTMLElement>('[data-sticky-bottom]');
  return stuck ? stuck.getBoundingClientRect().height : 0;
}

/**
 * Brings a marked range into view — and does nothing when it already is.
 *
 * Scrolling the page to the box that holds a match is not the same as showing
 * the match: a tool result renders inside a `max-h-96 overflow-auto` pre, so a
 * hit 2,000 lines down was on screen only in the sense that its container was.
 * Every scroller between the text and the window gets its turn, innermost first,
 * each measured again after the one inside it moved.
 */
export function revealRange(range: Range): void {
  const scrollers: Element[] = [];
  for (let node = range.startContainer.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      scrollers.push(node);
    }
  }
  for (const scroller of scrollers) {
    const rect = range.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const bottom = box.bottom - stuckToBottom(scroller);
    if (rect.top >= box.top && rect.bottom <= bottom) continue;
    // Centred on what can be SEEN, which is the box minus whatever covers it.
    scroller.scrollTop += rect.top - box.top - (bottom - box.top) / 2 + rect.height / 2;
  }
  const rect = range.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  }
}

/** Whether this browser can mark at all. Without it the flash still says where the hit is. */
function canHighlight(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS;
}

/**
 * Which unit of the find bar's corpus an element belongs to — the same key
 * `unitKey` builds from the data, so a box on screen and a box in the corpus can
 * be told apart from either side.
 *
 * A tool block says so itself. Everything else is inside a panel carrying the
 * message's uuid as its `id`: a bubble, a notice, a carried-over summary, a
 * system line. The walk stops before the app's own root, so a click on the page
 * behind the conversation is nothing rather than everything.
 */
export function boxKeyOf(el: Element | null): string | null {
  for (let node = el; node; node = node.parentElement) {
    const toolId = node.getAttribute('data-tool-id');
    if (toolId) return `tool:${toolId}`;
    // The app's own root is the one id above the conversation, and stopping
    // there is what makes a click on the empty page mean "nothing".
    if (node.id && node.id !== 'root') return `msg:${node.id}`;
  }
  return null;
}

/**
 * The inverse of `boxKeyOf`: which anchor a key names. The two prefixes are
 * known here and nowhere else, so the ring that reads a key back and the jump
 * that travels to it cannot drift about what one looks like.
 */
export function anchorOfKey(key: string | null): { uuid: string | null; toolUseId: string | null } {
  if (key?.startsWith('tool:')) return { uuid: null, toolUseId: key.slice(5) };
  return { uuid: key?.startsWith('msg:') ? key.slice(4) : null, toolUseId: null };
}

/**
 * Which message or call a click landed in.
 *
 * The walk is the whole of it, and it is deliberately wider than a marking box:
 * clicking a bubble's header, a notice's padding or a tool block's fold row is
 * still clicking that thing, and having the selection fall off because you
 * missed the prose by three pixels would be its own bug. Anything with no
 * message id above it — the scroller, the page behind the conversation — is
 * nothing, which is what deselects.
 */
export function focusKeyAt(node: EventTarget | null): string | null {
  const start = node instanceof Element ? node : node instanceof Node ? (node.parentElement ?? null) : null;
  return boxKeyOf(start);
}

/** Every non-empty text node under `root`, in document order. */
function textNodesIn(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data.length > 0) nodes.push(node as Text);
  }
  return nodes;
}

/** The spans `matchSpans` found, as live DOM ranges. */
function rangesOf(nodes: Text[], hl: MatchHighlight, max: number): Range[] {
  return matchSpans(
    nodes.map((n) => n.data),
    hl,
    max,
  ).map((span) => {
    const range = document.createRange();
    range.setStart(nodes[span.start.piece], Math.min(span.start.offset, nodes[span.start.piece].data.length));
    range.setEnd(nodes[span.end.piece], Math.min(span.end.offset, nodes[span.end.piece].data.length));
    return range;
  });
}

/**
 * Every occurrence of `hl` inside one element, in document order and with no
 * cap — which is what picking the Nth match of a box needs. `matchSpans` applies
 * its own cap inside the per-term loop and BEFORE sorting, so a capped result is
 * "the first few of each term" and cannot be counted through.
 */
export function boxRanges(box: HTMLElement, hl: MatchHighlight): Range[] {
  if (!canHighlight()) return [];
  return rangesOf(textNodesIn(box), hl, NO_CAP);
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
  if (!canHighlight()) return nothing;

  const ranges = rangesOf(textNodesIn(root), hl, MAX_MARKS);
  if (ranges.length === 0) return nothing;

  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  return {
    first: ranges[0],
    clear: () => CSS.highlights.delete(HIGHLIGHT_NAME),
  };
}

/**
 * The find bar's pass: every occurrence in every marking box of a conversation,
 * grouped by the box it fell in.
 *
 * One walk, and each text node is handed to the NEAREST box above it
 * (`closest`), which buys three things at once. A tool call rendered inside an
 * assistant bubble is counted as the call and not as the answer around it; a
 * phrase cannot run out of the prose and into a nested call's JSON; and the
 * boxes come out in document order, which is the order the bar steps through.
 * A text node with no box above it — a header, a clock, a cost pill, the bar's
 * own panel — is not marked at all.
 *
 * The grouping is also what the "visible" scope reads: a box whose body is
 * folded away has no text nodes, so it yields nothing, which is exactly what
 * "not on screen" means.
 */
export function markConversation(
  root: HTMLElement,
  hl: MatchHighlight,
): { boxes: Map<HTMLElement, Range[]>; count: number; clear: () => void } {
  const boxes = new Map<HTMLElement, Range[]>();
  const nothing = { boxes, count: 0, clear: () => {} };
  if (!canHighlight() || hl.terms.length === 0) return nothing;

  const byBox = new Map<HTMLElement, Text[]>();
  for (const node of textNodesIn(root)) {
    const box = node.parentElement?.closest<HTMLElement>(BOX_SELECTOR);
    if (!box) continue;
    const list = byBox.get(box);
    if (list) list.push(node);
    else byBox.set(box, [node]);
  }

  const all: Range[] = [];
  let count = 0;
  for (const [box, nodes] of byBox) {
    const ranges = rangesOf(nodes, hl, MAX_BOX_MARKS);
    if (ranges.length === 0) continue;
    boxes.set(box, ranges);
    count += ranges.length;
    if (all.length < MAX_FIND_MARKS) all.push(...ranges.slice(0, MAX_FIND_MARKS - all.length));
  }
  if (all.length === 0) return nothing;
  CSS.highlights.set(FIND_NAME, new Highlight(...all));
  return { boxes, count, clear: () => CSS.highlights.delete(FIND_NAME) };
}

/**
 * The one match the reader is standing on, painted over the rest. Its own
 * registration rather than a class or a style, for the same reason the others
 * are ranges: the text belongs to React. `priority` is set explicitly — the
 * overlap with `find-match` must always resolve the same way, and registration
 * order is not something to depend on.
 */
export function setCurrentMark(range: Range | null): void {
  if (!canHighlight()) return;
  if (!range) {
    CSS.highlights.delete(FIND_CURRENT_NAME);
    return;
  }
  const highlight = new Highlight(range);
  highlight.priority = 2;
  CSS.highlights.set(FIND_CURRENT_NAME, highlight);
}
