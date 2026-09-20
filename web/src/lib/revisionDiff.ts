import type { GitDiffLine, GitHunk } from '@claude-history/shared';

/**
 * Reading a selection back out of a rendered diff, and rebuilding the fragment
 * it is about from the DATA.
 *
 * Both halves are deliberate. A diff is a grid, not prose: a remark on one
 * belongs to a hunk and a run of rows, and that is what the DOM is asked for —
 * no character offsets, because a diff's furniture (two gutters and a sign per
 * row) sits between the words and counting through it would be counting line
 * numbers as text.
 *
 * And the fragment that travels with the remark is rebuilt from `GitHunk`,
 * never lifted from the screen. `DiffView` draws a removal with a typographic
 * minus — U+2212, not the ASCII `-` git writes — so a fragment copied from the
 * DOM would hand Claude a diff that is subtly not a diff.
 */

/** Where a selection fell, once it has been traced back to the diff's own grid. */
export interface DiffLocation {
  /** The file, as the diff names it. */
  path: string;
  hunkIndex: number;
  /** Row indices within that hunk, inclusive. */
  startRow: number;
  endRow: number;
}

function rowOf(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest<HTMLElement>('[data-line-index]') ?? null;
}

function fileOf(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest<HTMLElement>('[data-file-path]') ?? null;
}

/**
 * The file, hunk and rows a selection covers — or null when there is no single
 * fragment to quote.
 *
 * Null for a selection that crosses two files or two hunks, and that is a
 * restriction rather than a shortcoming: those are two different edits, and a
 * remark that claimed to be about both would have to carry two fragments and
 * point at neither. Every review tool draws the same line.
 *
 * A drag that BEGINS on a hunk's `@@` header started on no row at all, and it
 * means "from the top of this hunk" — so it is read as row 0 rather than
 * collapsed onto wherever it ended. One end has to be in the grid; a selection
 * with neither in it (a header alone, the fold above it) is not a fragment.
 */
export function locateSelection(range: Range): DiffLocation | null {
  const startFile = fileOf(range.startContainer);
  if (!startFile || startFile !== fileOf(range.endContainer)) return null;
  const path = startFile.dataset.filePath;
  if (!path) return null;

  const startRow = rowOf(range.startContainer);
  const endRow = rowOf(range.endContainer);
  const inGrid = startRow ?? endRow;
  if (!inGrid) return null;
  // Two hunks is two edits, and a remark claiming both would carry two
  // fragments and point at neither.
  if (startRow && endRow && startRow.dataset.hunkIndex !== endRow.dataset.hunkIndex) return null;
  const hunk = Number(inGrid.dataset.hunkIndex);
  if (!Number.isFinite(hunk)) return null;

  const a = startRow ? Number(startRow.dataset.lineIndex) : 0;
  const b = endRow ? Number(endRow.dataset.lineIndex) : Number(startRow?.dataset.lineIndex);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { path, hunkIndex: hunk, startRow: Math.min(a, b), endRow: Math.max(a, b) };
}

/** One line with the prefix git gives it, and no other. */
function rawLine(line: GitDiffLine): string {
  switch (line.kind) {
    case 'add':
      return `+${line.text}`;
    case 'del':
      return `-${line.text}`;
    // `\ No newline at end of file`, which git writes with a backslash and a
    // space. It describes the line above it rather than being one.
    case 'meta':
      return `\\ ${line.text}`;
    // A conflict marker is already the whole line in a conflicted diff, and
    // context takes the space git writes.
    default:
      return ` ${line.text}`;
  }
}

/**
 * The hunk as git wrote it: its header, then every line with its own prefix.
 *
 * This is what a remark carries, and it carries the WHOLE hunk rather than the
 * rows that were selected. A diff read three lines at a time says nothing —
 * the point of the notation is that the context is there — and the rows are
 * named separately in the sentence beside it.
 */
export function rawHunkText(hunk: GitHunk): string {
  return [hunk.header, ...hunk.lines.map(rawLine)].join('\n');
}

/**
 * Which line of the file a row is, and which side of the diff that number
 * belongs to.
 *
 * The new side wins where a row has both, which is every context line: it is
 * the file as it will be, which is the one a reader is going to open. A
 * removal has only an old number, and that is exactly when saying which side
 * matters.
 */
export function lineOfRow(line: GitDiffLine | undefined): { line: number | null; side: 'old' | 'new' | null } {
  if (!line) return { line: null, side: null };
  if (line.newNo !== null) return { line: line.newNo, side: 'new' };
  if (line.oldNo !== null) return { line: line.oldNo, side: 'old' };
  return { line: null, side: null };
}
