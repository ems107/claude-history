/**
 * The basket as the message somebody pastes into a terminal.
 *
 * `commentsFeedback` in `plans.ts` is the equivalent for a plan, and the two
 * differ in the one way the features do: a plan's remarks travel back to Claude
 * through a REFUSAL, in the shape Claude Code's own IDE panel writes, so that
 * one is a convention with a reader at the far end. This has no far end at all
 * — it goes to the clipboard and from there wherever the reader puts it — so
 * the shape is chosen for one job only: that Claude, reading it cold, knows
 * exactly which file and which lines each note is about.
 *
 * Hence a heading per file and a line reference per remark, which is how this
 * codebase's own prose points at code (`fileRefs.ts` parses `path:12` and
 * `path#L12-L20` because that is what Claude writes). There is no parser for
 * this direction: nothing ever reads it back.
 */

export interface FileCommentInput {
  /** As `FileCommentRecord.path` holds it: relative to the project where it can be. */
  path: string;
  line: number;
  endLine: number;
  text: string;
}

/** The line reference for one remark: `L42`, or `L42-L45` for a stretch. */
function where(c: FileCommentInput): string {
  return c.line === c.endLine ? `L${String(c.line)}` : `L${String(c.line)}-L${String(c.endLine)}`;
}

export function commentsForFiles(comments: FileCommentInput[]): string {
  if (comments.length === 0) return '';
  // Grouped in FIRST-SEEN order, which is the order the reader worked in: they
  // opened a file, said two things about it, opened the next. Sorting the paths
  // would be tidier and would throw that away.
  const byPath = new Map<string, FileCommentInput[]>();
  for (const c of comments) {
    const list = byPath.get(c.path);
    if (list) list.push(c);
    else byPath.set(c.path, [c]);
  }
  const sections = [...byPath.entries()].map(
    ([path, list]) => `## ${path}\n${list.map((c) => `[${where(c)}] ${c.text}`).join('\n')}`,
  );
  return `Comments on files in this project:\n\n${sections.join('\n\n')}`;
}
