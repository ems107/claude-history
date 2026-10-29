import type { GitDiffLine, GitDiffLineKind, GitFileDiff, GitHunk, ToolDiff, ToolDiffFile, Turn } from '@claude-history/shared';
import { normalisePath } from './fileRefs.ts';

/**
 * A call's recorded diff, put into the shape the GIT tab's renderer draws.
 *
 * Claude Code writes hunks as numbers plus prefixed lines (`structuredPatch`
 * on an Edit or Write, every file of a Bash command's `bashEditDiff`), and
 * `DiffView`'s `FileDiffBody` takes `GitFileDiff` — typed lines with their own
 * numbers, a header, the gap before each hunk. Converting here is what lets one
 * renderer serve both, with its gutters and its word-level marks.
 */

const KIND: Record<string, GitDiffLineKind> = { '+': 'add', '-': 'del', ' ': 'ctx', '\\': 'meta' };

function toHunk(h: ToolDiffFile['hunks'][number], gapBefore: number): GitHunk {
  let oldNo = h.oldStart;
  let newNo = h.newStart;
  const lines: GitDiffLine[] = h.lines.map((raw) => {
    // A line with no prefix is context: Bash diffs drop blank lines altogether,
    // and nothing else writes an unprefixed one.
    const kind = KIND[raw[0]] ?? 'ctx';
    const text = KIND[raw[0]] ? raw.slice(1) : raw;
    if (kind === 'add') return { kind, oldNo: null, newNo: newNo++, text };
    if (kind === 'del') return { kind, oldNo: oldNo++, newNo: null, text };
    if (kind === 'meta') return { kind, oldNo: null, newNo: null, text };
    return { kind, oldNo: oldNo++, newNo: newNo++, text };
  });
  return {
    header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    gapBefore,
    lines,
  };
}

/** `displayPath` is what the header shows; the file's own path stays absolute for opening it. */
export function toGitFileDiff(file: ToolDiffFile, displayPath: string): GitFileDiff {
  const hunks: GitHunk[] = [];
  let nextOld = 1;
  for (const h of file.hunks) {
    hunks.push(toHunk(h, Math.max(0, h.oldStart - nextOld)));
    nextOld = h.oldStart + h.oldLines;
  }
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') additions++;
      else if (l.kind === 'del') deletions++;
    }
  }
  return {
    path: displayPath,
    origPath: null,
    status: file.created ? 'A' : file.deleted ? 'D' : 'M',
    binary: false,
    additions,
    deletions,
    tooLarge: file.tooLarge,
    hunks,
  };
}

/**
 * When every change in the file is a line ending and nothing else — a file
 * rewritten from LF to CRLF or back — which ending it changed TO; null
 * otherwise. Such a diff is the whole file removed and added again, identical on
 * screen, so the header says what happened instead. 63 files of the Bash diffs
 * on this machine are only that.
 */
export function lineEndingChange(file: ToolDiffFile): 'CRLF' | 'LF' | null {
  if (file.hunks.length === 0) return null;
  let to: 'CRLF' | 'LF' | null = null;
  for (const h of file.hunks) {
    const del = h.lines.filter((l) => l[0] === '-').map((l) => l.slice(1));
    const add = h.lines.filter((l) => l[0] === '+').map((l) => l.slice(1));
    if (del.length === 0 || del.length !== add.length) return null;
    if (del.some((l, i) => l === add[i] || l.replace(/\r$/, '') !== add[i].replace(/\r$/, ''))) return null;
    to ??= add[0].endsWith('\r') ? 'CRLF' : 'LF';
  }
  return to;
}

/**
 * Every recorded diff of a session, by the call that made it. The Changed
 * panel's entries name their call rather than carry a copy of its hunks, and
 * this is where they are looked up.
 */
export function diffsByCall(turns: Turn[]): Map<string, ToolDiff> {
  const out = new Map<string, ToolDiff>();
  for (const turn of turns) {
    for (const item of turn.items) {
      for (const b of item.blocks) {
        if (b.kind === 'tool' && b.toolUseId && b.result?.diff) out.set(b.toolUseId, b.result.diff);
      }
    }
  }
  return out;
}

/** One file's part of a call's diff: an Edit's only file, or the command's file with this path. */
export function fileOfDiff(diff: ToolDiff, path: string): ToolDiffFile | null {
  if (diff.source === 'edit') return diff.files[0] ?? null;
  const key = normalisePath(path);
  return diff.files.find((f) => normalisePath(f.path) === key) ?? null;
}

export interface DiffTally {
  /** Files with a diff plus the ones changed without one. */
  files: number;
  additions: number;
  deletions: number;
  /** Whether any line was counted at all: a command whose files were all kept without a diff has no `+0 −0` to show. */
  counted: boolean;
}

/** What the call's header says about its diff. */
export function diffTally(diff: ToolDiff): DiffTally {
  let additions = 0;
  let deletions = 0;
  for (const f of diff.files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l[0] === '+') additions++;
        else if (l[0] === '-') deletions++;
      }
    }
  }
  if (diff.newFileLines !== null) additions += diff.newFileLines;
  const counted = diff.newFileLines !== null || diff.files.some((f) => f.hunks.length > 0);
  return { files: diff.files.length + diff.moreFiles, additions, deletions, counted };
}
