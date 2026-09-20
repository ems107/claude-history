import type { RevisionCommentRecord } from '@claude-history/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { newId } from '../../lib/ids.ts';
import { revisionKeyOf } from '../../lib/revision.ts';
import { lineOfRow, locateSelection, rawHunkText } from '../../lib/revisionDiff.ts';
import { diffLineKey, FileDiffBody } from '../git/DiffView.tsx';
import { SelectionCommentLayer } from './SelectionCommentLayer.tsx';

/** One empty set for every file with no remarks — a fresh one would repaint every row. */
const NO_MARKS: ReadonlySet<string> = new Set();

/**
 * One file of a branch review, with its diff commentable.
 *
 * The column beside the session rather than a panel in the rail, for the same
 * reason the file viewer is one: a diff needs width. What stays in the rail is
 * the list of files and the basket — which is exactly the split the Files panel
 * makes, and on purpose: the two features should feel like one idea.
 *
 * It reads the diff out of the SAME query the panel already made, so opening a
 * file costs nothing: `['revisionDiff', sessionId, base]` is one request for
 * the whole comparison, and this picks its file out of it.
 *
 * ## What a remark here is made of
 *
 * Select anything inside one hunk and the fragment travels with the note: the
 * hunk exactly as git wrote it, plus which lines and which side. Not a
 * pointer — a copy. The branch will have moved by the time anybody reads it,
 * and a line number from yesterday's diff points at nothing in particular in
 * today's.
 */
export function RevisionDiffColumn({
  sessionId,
  base,
  path,
  onClose,
}: {
  sessionId: string;
  /** The branch being compared against. Null until the panel has chosen one. */
  base: string | null;
  path: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const diff = useQuery({
    queryKey: ['revisionDiff', sessionId, base],
    queryFn: () => api.revisionDiff(sessionId, base ?? ''),
    enabled: !!base,
    staleTime: 0,
  });
  const reviews = useQuery({
    queryKey: ['revisionReviews', sessionId],
    queryFn: () => api.revisionReviews(sessionId),
    staleTime: 30_000,
  });

  const file = diff.data?.files.find((f) => f.path === path) ?? null;
  const current = diff.data?.currentBranch ?? null;
  const comparisonKey = current && base ? revisionKeyOf(current, base) : null;
  const comments = useMemo<RevisionCommentRecord[]>(
    () =>
      comparisonKey
        ? (reviews.data?.find((r) => r.comparisonKey === comparisonKey)?.comments.filter((c) => c.path === path) ?? [])
        : [],
    [reviews.data, comparisonKey, path],
  );

  /**
   * Which rows carry a remark, recovered by matching the stored fragment
   * against the hunks on screen.
   *
   * A remark keeps no hunk index — it keeps the hunk's TEXT, which is the only
   * thing that still means something once the branch has moved. So the mark
   * appears where that exact hunk is still present and simply does not appear
   * where it is not, which is the honest answer: the remark is in the list
   * either way, with its own copy of what it was about.
   */
  const marked = useMemo<ReadonlySet<string>>(() => {
    if (!file || comments.length === 0) return NO_MARKS;
    const out = new Set<string>();
    file.hunks.forEach((hunk, hunkIndex) => {
      const raw = rawHunkText(hunk);
      for (const c of comments) {
        if (c.diffText !== raw || c.line === null) continue;
        hunk.lines.forEach((l, row) => {
          const no = c.side === 'old' ? l.oldNo : l.newNo;
          if (no !== null && no >= c.line! && no <= (c.endLine ?? c.line!)) out.add(diffLineKey(hunkIndex, row));
        });
      }
    });
    return out.size > 0 ? out : NO_MARKS;
  }, [file, comments]);

  const write = useMutation({
    mutationFn: (comment: Parameters<typeof api.saveRevisionComment>[2]) =>
      api.saveRevisionComment(sessionId, comparisonKey ?? '', comment),
    onSuccess: () => {
      setError(null);
      return queryClient.invalidateQueries({ queryKey: ['revisionReviews', sessionId] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <span className="min-w-0 shrink truncate rounded bg-sky-500/15 px-1.5 py-0.5 text-xs font-semibold text-sky-300">
          ± {path.split('/').pop()}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-dim)]" title={path}>
          {path}
        </span>
        {current && base && (
          <span className="shrink-0 truncate font-mono text-[11px] text-[var(--text-dim)]">
            {current} ← {base}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 cursor-pointer rounded px-2 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {comments.length > 0 && (
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-1 text-[11px] text-amber-300/80">
          {comments.length} comment{comments.length === 1 ? '' : 's'} on this file — listed in the Revision panel
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-1 text-[11px] text-red-400">
          Comment not saved — {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!base ? (
          <p className="px-2 py-2 text-[11px] text-[var(--text-dim)]">Choose a branch to compare against.</p>
        ) : diff.isPending ? (
          <p className="px-2 py-2 text-[11px] text-[var(--text-dim)]">Reading the diff…</p>
        ) : diff.isError ? (
          <p className="px-2 py-2 text-[11px] text-red-400">{String(diff.error)}</p>
        ) : !file ? (
          <p className="px-2 py-2 text-[11px] text-[var(--text-dim)]">
            {/* The diff was re-read and this file is no longer in it — the
                branch moved, or the base changed under the column. */}
            <span className="font-mono">{path}</span> is not in this comparison any more.
          </p>
        ) : (
          <SelectionCommentLayer
            boxRef={box}
            placeholder="What should change here?"
            onAdd={({ range, quote, text }) => {
              const at = locateSelection(range);
              // Refused rather than guessed: a selection across two hunks has
              // no single fragment to quote, and the button is not offered for
              // one — this is the belt to that braces.
              if (!at || at.path !== path || !comparisonKey || !current || !base) return;
              const hunk = file.hunks[at.hunkIndex];
              if (!hunk) return;
              const start = lineOfRow(hunk.lines[at.startRow]);
              const end = lineOfRow(hunk.lines[at.endRow]);
              write.mutate({
                id: newId(),
                currentBranch: current,
                baseBranch: base,
                path,
                quote,
                diffText: rawHunkText(hunk),
                line: start.line,
                // Only where both ends are the same side of the diff: a run
                // that starts on a removal and ends on an addition has two
                // numbering systems in it, and one of them would be a lie.
                endLine: end.side === start.side ? end.line : start.line,
                side: start.side,
                text,
              });
            }}
          >
            <FileDiffBody file={file} marked={marked} />
          </SelectionCommentLayer>
        )}
      </div>
    </>
  );
}
