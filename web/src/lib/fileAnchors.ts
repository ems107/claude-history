import { rangeOf } from './anchors.ts';

/**
 * Where a remark on a FILE points, and — as much to the point — what it does
 * not do when the answer is nothing.
 *
 * `resolveAnchor` (`planAnchors.ts`) re-finds a moved passage by its own words,
 * and is right to: a plan is frozen in an append-only transcript line, so a
 * quote that has shifted has shifted because this app's markdown rendering
 * changed under it, and the words are still the same words in the same
 * document.
 *
 * A file is not that. It is read from disk on every open, it is being edited by
 * the very session whose panel this is, and `return null;` occurs in it forty
 * times. Re-finding a quote in a rewritten file would paint a remark over a
 * passage nobody pointed at — which is worse than not painting it, because it
 * is wrong instead of merely missing.
 *
 * So the offsets are trusted or the passage goes unpainted, and either way the
 * remark is untouched: it was frozen the moment it was written, and what it
 * says — the path, the lines, the quote, the note — is what gets copied out.
 */
export function resolveFileAnchor(root: HTMLElement, comment: { start: number; end: number }): Range | null {
  if (comment.start < 0 || comment.end <= comment.start) return null;
  return rangeOf(root, comment.start, comment.end);
}

/**
 * The 1-based line an offset falls on, counted in the file's own text.
 *
 * Off the TEXT and not off the DOM, which it can be because the viewer's code
 * column renders either hljs's markup — which adds no characters, only tags —
 * or the text in a single node. So an offset into the rendered text is an
 * offset into the file, and the line is however many newlines precede it.
 */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) if (text[i] === '\n') line++;
  return line;
}
