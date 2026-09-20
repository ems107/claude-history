import type { RevisionCommentRecord } from '@claude-history/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { revisionFeedback, revisionKeyOf } from '../../lib/revision.ts';

/**
 * Reviewing what this session's branch introduced.
 *
 * The rail half: which two branches, which files changed, and everything you
 * have said about them. One file's diff opens in the column beside the
 * conversation, which is where the reading and the commenting happen — the
 * same split the Files panel makes, and on purpose.
 *
 * ## Why there is a Refresh button and no watcher
 *
 * Because a branch moves while it is being reviewed, and the two honest
 * answers to that are "ask again when you open it" and "ask again when you say
 * so". Both are here: the queries do not serve a cached answer on mount, and
 * the button re-asks everything. What is NOT here is a `.git` watcher pulling
 * the diff out from under somebody mid-sentence — and the remarks are
 * unaffected either way, because each one already carries its own copy of what
 * it was about.
 */
export function RevisionPanel({
  sessionId,
  base,
  onBase,
  openPath,
  onOpenFile,
}: {
  sessionId: string;
  /** The branch being compared against, or null until one has been chosen. */
  base: string | null;
  onBase: (base: string | null) => void;
  /** Which file the column is showing, so the list can say which. */
  openPath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Never a cached answer on mount: what is on screen when this opens has to
  // be what the repository says now, not what it said the last time it was
  // looked at.
  const info = useQuery({
    queryKey: ['revisionInfo', sessionId],
    queryFn: () => api.revisionInfo(sessionId),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const diff = useQuery({
    queryKey: ['revisionDiff', sessionId, base],
    queryFn: () => api.revisionDiff(sessionId, base ?? ''),
    enabled: !!base,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const reviews = useQuery({
    queryKey: ['revisionReviews', sessionId],
    queryFn: () => api.revisionReviews(sessionId),
    staleTime: 30_000,
  });

  /**
   * The suggestion is adopted ONCE, and never taken back off the reader: it is
   * where the dropdown opens, not what it is pinned to.
   */
  useEffect(() => {
    if (base === null && info.data?.suggestedBase) onBase(info.data.suggestedBase);
  }, [base, info.data?.suggestedBase, onBase]);

  const current = info.data?.currentBranch ?? null;
  const comparisonKey = current && base ? revisionKeyOf(current, base) : null;
  const review = comparisonKey ? (reviews.data?.find((r) => r.comparisonKey === comparisonKey) ?? null) : null;
  const comments = useMemo(() => review?.comments ?? [], [review]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['revisionReviews', sessionId] });
  const failed = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  const ok = () => {
    setError(null);
    return refresh();
  };
  const write = useMutation({
    mutationFn: (comment: Parameters<typeof api.saveRevisionComment>[2]) =>
      api.saveRevisionComment(sessionId, comparisonKey ?? '', comment),
    onSuccess: ok,
    onError: failed,
  });
  const drop = useMutation({
    mutationFn: (commentId: string) => api.removeRevisionComment(sessionId, comparisonKey ?? '', commentId),
    onSuccess: ok,
    onError: failed,
  });
  const clear = useMutation({
    mutationFn: () => api.clearRevisionReview(sessionId, comparisonKey ?? ''),
    onSuccess: ok,
    onError: failed,
  });
  const markCopied = useMutation({
    mutationFn: () => api.markRevisionReviewCopied(sessionId, comparisonKey ?? ''),
    onSuccess: ok,
    onError: failed,
  });

  const byPath = useMemo(() => {
    const out = new Map<string, RevisionCommentRecord[]>();
    for (const c of comments) {
      const list = out.get(c.path);
      if (list) list.push(c);
      else out.set(c.path, [c]);
    }
    return out;
  }, [comments]);

  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const copy = async () => {
    if (!current || !base || comments.length === 0) return;
    setError(null);
    try {
      await copyPlain(revisionFeedback(current, base, comments));
    } catch (err) {
      failed(err);
      return;
    }
    setCopied(true);
    await markCopied.mutateAsync();
  };

  if (info.isPending) return <div className="px-4 py-3 text-sm text-[var(--text-dim)]">Reading the repository…</div>;
  if (info.isError) return <div className="px-4 py-3 text-sm text-red-400">{String(info.error)}</div>;
  if (!info.data?.isRepo) {
    return (
      <div className="px-4 py-3 text-sm text-[var(--text-dim)]">
        The folder this session ran in is not a git repository, so there is no branch to review.
      </div>
    );
  }
  if (info.data.detached || !current) {
    return (
      <div className="px-4 py-3 text-sm text-[var(--text-dim)]">
        This repository is on a detached HEAD — there is no branch to review, and nothing to file remarks under.
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-1 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        what <span className="font-mono normal-case">{current}</span> introduced
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-[var(--text-dim)]">against</span>
        <select
          value={base ?? ''}
          onChange={(e) => {
            onBase(e.target.value || null);
            setCopied(false);
          }}
          className="min-h-11 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent-dim)] md:min-h-0 md:py-1"
        >
          <option value="">choose a branch…</option>
          {info.data.branches.map((b) => (
            <option key={b.ref} value={b.ref}>
              {b.ref}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="Read the branches and the diff again"
          onClick={() => {
            setError(null);
            void queryClient.invalidateQueries({ queryKey: ['revisionInfo', sessionId] });
            void queryClient.invalidateQueries({ queryKey: ['revisionDiff', sessionId] });
          }}
          disabled={info.isFetching || diff.isFetching}
          className="min-h-11 shrink-0 rounded border border-[var(--border)] px-2 text-[11px] text-[var(--text-dim)] disabled:opacity-40 md:min-h-0 md:py-1 md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
        >
          ↻
        </button>
      </div>
      {/* Said out loud, because the two are different promises: one is where
          you left off, the other is a guess about where the branch came from —
          and a guess that is wrong is a dropdown somebody has to notice. */}
      {info.data.suggestedBase && base === info.data.suggestedBase && (
        <div className="mb-2 text-[10px] text-[var(--text-dim)]">
          {info.data.resumed
            ? 'carrying on the review you already started on this branch'
            : 'a guess at where this branch was cut from — change it if it is wrong'}
        </div>
      )}
      {info.data.branches.length === 0 && (
        <div className="mb-2 text-[11px] text-amber-400/80">
          This repository has no other branch to compare against.
        </div>
      )}

      {error && (
        <div className="mb-2 rounded border border-red-500/40 bg-red-500/5 px-2 py-1 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {base && (
        <div className="mb-3 rounded border border-[var(--border)]">
          {diff.isPending ? (
            <div className="px-2 py-1.5 text-xs text-[var(--text-dim)]">Reading the diff…</div>
          ) : diff.isError ? (
            <div className="px-2 py-1.5 text-xs text-red-400">{String(diff.error)}</div>
          ) : !diff.data?.ok ? (
            <div className="px-2 py-1.5 text-xs text-amber-400/90">{diff.data?.error}</div>
          ) : diff.data.files.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-[var(--text-dim)]">
              Nothing — this branch has introduced no changes since it diverged.
            </div>
          ) : (
            <>
              {diff.data.files.map((f) => {
                const on = byPath.get(f.path)?.length ?? 0;
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => onOpenFile(f.path)}
                    className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs ${
                      openPath === f.path ? 'bg-[var(--accent)]/10' : 'md:hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>
                      {f.path}
                    </span>
                    {on > 0 && <span className="shrink-0 text-[10px] text-amber-300/80">{on} ✎</span>}
                    <span className="shrink-0 text-[10px] tabular-nums">
                      <span className="text-emerald-400">+{f.additions}</span>{' '}
                      <span className="text-red-400">−{f.deletions}</span>
                    </span>
                  </button>
                );
              })}
              {diff.data.truncated && (
                <div className="px-2 py-1 text-[10px] text-amber-400/80">
                  more files changed than are listed here
                </div>
              )}
            </>
          )}
        </div>
      )}

      {comments.length === 0 ? (
        <div className="text-sm text-[var(--text-dim)]">
          No comments on this comparison. Open a file above and select part of its diff.
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
              {comments.length} comment{comments.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => clear.mutate()}
              className="ml-auto rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-dim)] md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
            >
              Clear all
            </button>
          </div>
          {[...byPath.entries()].map(([path, list]) => (
            <div key={path} className="mb-2 rounded border border-[var(--border)] px-2 py-1.5">
              <button
                type="button"
                onClick={() => onOpenFile(path)}
                className="mb-1 block w-full truncate text-left font-mono text-[11px] text-[var(--text-dim)] md:hover:text-[var(--text)]"
                title={`Open ${path}`}
              >
                {path}
              </button>
              <div className="space-y-1">
                {list.map((c, i) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-2 rounded border border-[var(--border)] px-2 py-1 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-[var(--text-dim)]">
                        Comment {i + 1} on{' '}
                        {c.line === null
                          ? 'a fragment'
                          : c.endLine !== null && c.endLine !== c.line
                            ? `lines ${String(c.line)}-${String(c.endLine)}`
                            : `line ${String(c.line)}`}
                        {c.side === 'old' ? ' of the old file' : ''}
                      </div>
                      {editing?.id === c.id ? (
                        <textarea
                          autoFocus
                          rows={2}
                          value={editing.text}
                          onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              const text = editing.text.trim();
                              if (text && current && base) {
                                write.mutate({ ...c, currentBranch: current, baseBranch: base, text });
                              }
                              setEditing(null);
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditing(null);
                            }
                          }}
                          onBlur={() => {
                            const text = editing.text.trim();
                            if (text && text !== c.text && current && base) {
                              write.mutate({ ...c, currentBranch: current, baseBranch: base, text });
                            }
                            setEditing(null);
                          }}
                          className="mt-0.5 w-full resize-none rounded border border-[var(--accent-dim)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] outline-none"
                        />
                      ) : (
                        <div className="whitespace-pre-wrap text-[var(--text)]">{c.text}</div>
                      )}
                    </div>
                    {editing?.id !== c.id && (
                      <button
                        type="button"
                        onClick={() => setEditing({ id: c.id, text: c.text })}
                        title="Edit this comment"
                        className="min-h-11 shrink-0 rounded px-2 text-[var(--text-dim)] md:min-h-0 md:px-1 md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
                      >
                        ✎
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => drop.mutate(c.id)}
                      title="Remove this comment"
                      className="min-h-11 shrink-0 rounded px-2 text-[var(--text-dim)] md:min-h-0 md:px-1 md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void copy()}
              className="min-h-11 rounded border border-[var(--accent-dim)] px-3 text-[11px] text-[var(--accent)] md:min-h-0 md:py-1 md:hover:bg-[var(--bg-hover)]"
            >
              {copied ? '✔ copied' : 'Copy for the terminal'}
            </button>
            {review?.copiedAt && (
              <span className="text-[10px] text-[var(--text-dim)]">copied {new Date(review.copiedAt).toLocaleString()}</span>
            )}
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-dim)]">
            Every comment carries its own piece of the diff, so it still says what it is about after the branch moves.
          </div>
        </>
      )}
    </div>
  );
}
