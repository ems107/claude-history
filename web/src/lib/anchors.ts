/**
 * Turning a selection into two numbers, and two numbers back into a selection.
 *
 * The arithmetic of anchoring a remark to a passage, with nothing in it about
 * what the passage IS: it works over any element whose text nodes are the
 * document — rendered markdown, a file's syntax-highlighted source, anything.
 * What each feature adds on top of it is its own way of telling two similar
 * passages apart, which is the only part that knows about the content: a plan
 * uses the heading above it (`planAnchors.ts`), a file uses its line number.
 *
 * It lives here rather than in `planAnchors.ts`, where it grew up, because the
 * plan is no longer the only thing with passages worth commenting on — and a
 * second copy of `offsetsOf` would be a second place for the same off-by-one.
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
 * This one may not skip anything: these offsets are positions in the whole
 * rendered text, and a walker that left parts out would put every anchor after
 * the gap in the wrong place. A caller whose box contains furniture as well as
 * content anchors on the content instead — the file viewer wraps its code
 * column and leaves the line-number gutter, its sibling, outside.
 */
export function textNodesIn(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** That string itself — what a quote is searched for in. */
export function renderedText(root: HTMLElement): string {
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
 * The inverse, and the reason the offsets are stored at all: the same content
 * is rendered more than once — a panel and, full screen, a portal — and the
 * second one is a fresh set of nodes. A `Range` cannot survive that; two
 * numbers can.
 */
export function rangeOf(root: HTMLElement, start: number, end: number): Range | null {
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
 * The selection grown out to whole words.
 *
 * A drag ends where the mouse came up, so a real reader's selection routinely
 * starts and finishes mid-word — `d porque, según CLAUDE.md d` was a live one.
 * As a quote that is both ugly to read and a worse anchor: it is the text
 * Claude is asked to find again. Only the two ends are touched, and only while
 * both sides of them are word characters, so a selection that already lands on
 * a boundary is left exactly where it was.
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
