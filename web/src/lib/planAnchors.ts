import { rangeOf, renderedText } from './anchors.ts';

/**
 * Where a remark on a PLAN actually points, in the rendered markdown.
 *
 * The arithmetic underneath it — a selection to two offsets and back — moved to
 * [anchors.ts](anchors.ts) when the file viewer grew remarks of its own. What
 * stays here is the half that knows it is looking at markdown: the heading a
 * passage sits under, and the recovery that uses it to tell two identical
 * quotes apart.
 */

export { offsetsOf, snapToWords } from './anchors.ts';

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
 *
 * **A remark on a FILE gets none of this** (`fileAnchors.ts`), and deliberately:
 * a file on disk really does change, so a quote re-found in a rewritten file
 * would be a passage nobody pointed at. There the offsets are trusted or the
 * passage goes unpainted, and the remark is frozen prose either way.
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
