/**
 * Where a remark on a plan actually points, in the rendered markdown.
 *
 * The maths lives here rather than in the panel because two things now need it
 * — the reviewer that makes an anchor and the panel that repaints one written
 * days ago — and because it is the half that can be reasoned about without a
 * component around it.
 *
 * A remark carries BOTH a quote and a pair of offsets, and neither can be
 * recovered from the other: a selection crossing two blocks reads back with
 * newlines the rendered text does not have, so the quote is what a human and a
 * model read while the offsets are what the browser paints.
 */

/**
 * Every text node under `root`, in document order — the string the offsets index.
 *
 * **Not `highlight.ts`'s function of the same name**, which rejects any subtree
 * marked `data-chrome` so the find bar never counts a button's label as a hit.
 * This one may not skip anything: these offsets are positions in the plan's
 * whole rendered text, and a walker that left parts out would put every anchor
 * after the gap in the wrong place.
 */
function textNodesIn(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** That string itself — what a quote is searched for in. */
function renderedText(root: HTMLElement): string {
  let out = '';
  for (const node of textNodesIn(root)) out += node.data;
  return out;
}

/** Where a selection falls in that string, or null if either end is not text. */
export function offsetsOf(root: HTMLElement, range: Range): { start: number; end: number } | null {
  let pos = 0;
  let start = -1;
  let end = -1;
  for (const node of textNodesIn(root)) {
    if (node === range.startContainer) start = pos + range.startOffset;
    if (node === range.endContainer) end = pos + range.endOffset;
    pos += node.data.length;
  }
  return start >= 0 && end > start ? { start, end } : null;
}

/**
 * The inverse, and the reason the offsets are stored at all: the reviewer is
 * rendered more than once — in a panel and, full screen, in a portal — and the
 * second one is a fresh set of nodes. A `Range` cannot survive that; two
 * numbers can.
 */
function rangeOf(root: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  let pos = 0;
  let opened = false;
  for (const node of textNodesIn(root)) {
    const len = node.data.length;
    if (!opened && start <= pos + len) {
      range.setStart(node, Math.max(0, start - pos));
      opened = true;
    }
    if (opened && end <= pos + len) {
      range.setEnd(node, Math.max(0, end - pos));
      return range;
    }
    pos += len;
  }
  return null;
}

/**
 * The heading a passage sits under: the nearest `h1`-`h6` before it, walking
 * back through siblings and then up. The same walk Claude Code's IDE panel
 * does, and a selection inside a heading answers with itself.
 */
export function headingOf(node: Node): string {
  const from = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const own = from?.closest('h1, h2, h3, h4, h5, h6');
  if (own) return own.textContent?.trim() ?? '';
  for (let current = from; current; current = current.parentElement) {
    for (let sib = current.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (/^H[1-6]$/.test(sib.tagName)) return sib.textContent?.trim() ?? '';
    }
  }
  return '';
}

/**
 * The selection grown out to whole words.
 *
 * A drag ends where the mouse came up, so a real reader's selection routinely
 * starts and finishes mid-word — `d porque, según CLAUDE.md d` was a live one.
 * As a quote that is both ugly to read and a worse anchor: it is the text
 * Claude is asked to find in its own plan. Only the two ends are touched, and
 * only while both sides of them are word characters, so a selection that
 * already lands on a boundary is left exactly where it was.
 */
export function snapToWords(range: Range): Range {
  const word = /[\p{L}\p{N}_]/u;
  const snapped = range.cloneRange();
  const { startContainer, endContainer } = snapped;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const data = (startContainer as Text).data;
    let at = snapped.startOffset;
    while (at > 0 && word.test(data[at - 1] ?? '') && word.test(data[at] ?? '')) at--;
    snapped.setStart(startContainer, at);
  }
  if (endContainer.nodeType === Node.TEXT_NODE) {
    const data = (endContainer as Text).data;
    let at = snapped.endOffset;
    while (at < data.length && word.test(data[at] ?? '') && word.test(data[at - 1] ?? '')) at++;
    snapped.setEnd(endContainer, at);
  }
  return snapped;
}

/** What a remark needs for its passage to be found again. */
export interface Anchored {
  quote: string;
  heading: string;
  start: number;
  end: number;
}

/**
 * The passage a remark is about, as a range in THIS rendering — or null when it
 * cannot be found, which is the one honest answer left.
 *
 * ## Why this exists when the text cannot change
 *
 * It normally cannot. A remark is filed against a plan submitted through
 * `ExitPlanMode`, whose text is frozen in an append-only transcript line, so
 * the stored offsets hold for ever and the first branch here is the only one
 * that ever runs. What they are offsets INTO, though, is the rendered markdown
 * — and that is this app's output, not Claude's. A change to how a list or a
 * code fence is rendered would shift every offset in the document by a
 * character or two, silently, in remarks already written.
 *
 * So the quote is checked rather than trusted, and a remark whose passage has
 * moved is re-found by its own words instead of painted over the wrong
 * sentence. A remark that cannot be found at all is **listed and not painted**:
 * it is still what somebody wrote, and it still says which passage it meant.
 */
export function resolveAnchor(root: HTMLElement, comment: Anchored): Range | null {
  if (comment.start < 0 || comment.end <= comment.start) return null;
  const quote = comment.quote.trim();
  const stored = rangeOf(root, comment.start, comment.end);
  if (stored && (!quote || stored.toString().trim() === quote)) return stored;
  if (!quote) return null;

  // Re-find it. Several matches are broken by the heading the remark was filed
  // under, which is exactly what that field is for — and failing that by the
  // first one, because a quote appearing twice under the same heading makes
  // them interchangeable for a reader anyway.
  const text = renderedText(root);
  const hits: number[] = [];
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) hits.push(at);
  if (hits.length === 0) return null;
  let at = hits[0];
  if (hits.length > 1 && comment.heading) {
    const under = hits.find((i) => {
      const range = rangeOf(root, i, i + quote.length);
      return range ? headingOf(range.startContainer) === comment.heading : false;
    });
    if (under !== undefined) at = under;
  }
  return rangeOf(root, at, at + quote.length);
}
