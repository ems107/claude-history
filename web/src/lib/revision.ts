import type { RevisionCommentRecord } from '@claude-history/shared';

/**
 * What a branch review is filed under, and what it reads like when it leaves.
 */

/**
 * Which file of the review is open in the column. Beside `file`, `agent` and
 * `msg` — and the BASE branch is deliberately not a parameter: it is the
 * panel's choice, worked out from the repository and from the review already
 * under way, so a link carrying a stale branch name would open a comparison
 * nobody asked for.
 */
export const REV_FILE_PARAM = 'revfile';

/**
 * The key for one comparison: the two branch NAMES, hashed.
 *
 * `planKeyOf`'s hash, and the same reasoning about what belongs in a path
 * segment — a branch name holds slashes. What is different is WHAT is hashed,
 * and that is the whole of why a review survives being worked on: a plan is
 * keyed on its text because the text cannot move, and a comparison is keyed on
 * two names because everything else about it will. Key it on the shas and the
 * first push during a review would open an empty basket beside the one
 * somebody was halfway through.
 */
export function revisionKeyOf(currentBranch: string, baseBranch: string): string {
  // A NUL between them, because it cannot occur in a ref name: without a
  // separator `ab` against `c` and `a` against `bc` would be one key.
  const text = `${currentBranch}\u0000${baseBranch}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `${text.length.toString(36)}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** Where one remark points, in the words the copied prose uses. */
function where(c: RevisionCommentRecord): string {
  if (c.line === null) return 'this fragment';
  const side = c.side === 'old' ? ' of the old file' : '';
  return c.endLine !== null && c.endLine !== c.line
    ? `lines ${String(c.line)}-${String(c.endLine)}${side}`
    : `line ${String(c.line)}${side}`;
}

/**
 * The review as the message somebody pastes into a terminal.
 *
 * **Every remark carries its own fragment of diff, even two on the same hunk.**
 * Repeating it is the point: a reader — a person or a model — may act on one
 * paragraph of this in isolation, and a note whose context is four paragraphs
 * up is a note that has to be reassembled before it can be used. The cost is
 * some duplicated text in a message nobody re-reads whole.
 *
 * The branches are said ONCE, at the top, because they are the one fact common
 * to all of it, and saying them per remark would read as though each were
 * about a different comparison.
 */
export function revisionFeedback(
  currentBranch: string,
  baseBranch: string,
  comments: RevisionCommentRecord[],
): string {
  if (comments.length === 0) return '';
  // Grouped by file in first-seen order — the order the reader worked in, the
  // same rule the file basket follows.
  const byPath = new Map<string, RevisionCommentRecord[]>();
  for (const c of comments) {
    const list = byPath.get(c.path);
    if (list) list.push(c);
    else byPath.set(c.path, [c]);
  }
  const blocks: string[] = [];
  for (const [path, list] of byPath) {
    for (const c of list) {
      blocks.push(`## ${path}\n${c.diffText}\n\n[Comment on ${where(c)}]: ${c.text}`);
    }
  }
  return `Diff review — \`${currentBranch}\` against \`${baseBranch}\`:\n\n${blocks.join('\n\n')}`;
}
