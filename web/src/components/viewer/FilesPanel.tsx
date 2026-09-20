import type { FileCommentRecord, FileTreeResponse } from '@claude-history/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { commentsForFiles } from '../../lib/fileComments.ts';
import { FileCommentRef } from './FileCommentRef.tsx';
import { FileTree } from './FileTree.tsx';

/**
 * The project this session ran in, and everything you have said about it.
 *
 * The tree is the way in and the basket is the point: remarks made anywhere —
 * from this tree, from a path chip in the conversation, from a plan's file link
 * — land in one place, grouped by file, and leave as one paste. The viewer
 * itself only adds them and paints them, so the list of what you have said
 * exists exactly once.
 *
 * ## Why it only copies
 *
 * Because there is nothing to send. A plan's stack rides a refusal, which is a
 * real channel with Claude at the far end; a remark about a file answers no
 * question and belongs to no dialog. So it goes to the clipboard, and from
 * there into whichever terminal is running this project — which the panel
 * cannot know and does not guess.
 */
export function FilesPanel({ sessionId, root }: { sessionId: string; root: FileTreeResponse | null }) {
  const queryClient = useQueryClient();
  const review = useQuery({
    queryKey: ['fileReview', sessionId],
    queryFn: () => api.fileReview(sessionId),
    staleTime: 30_000,
  });
  const comments = useMemo(() => review.data?.comments ?? [], [review.data]);
  const copiedAt = review.data?.copiedAt ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fileReview', sessionId] });
  /**
   * Every write says what went wrong, for the plan panel's reason: a remark is
   * somebody's writing, and losing one has to be LOUD.
   */
  const [error, setError] = useState<string | null>(null);
  const failed = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  const ok = () => {
    setError(null);
    return refresh();
  };
  const write = useMutation({
    mutationFn: (comment: Parameters<typeof api.saveFileComment>[1]) => api.saveFileComment(sessionId, comment),
    onSuccess: ok,
    onError: failed,
  });
  const drop = useMutation({
    mutationFn: (id: string) => api.removeFileComment(sessionId, id),
    onSuccess: ok,
    onError: failed,
  });
  const clear = useMutation({
    mutationFn: () => api.clearFileReview(sessionId),
    onSuccess: ok,
    onError: failed,
  });
  const markCopied = useMutation({
    mutationFn: () => api.markFileReviewCopied(sessionId),
    onSuccess: ok,
    onError: failed,
  });

  // Grouped in FIRST-SEEN order, the same order `commentsForFiles` prints them
  // in — what is on screen and what lands on the clipboard must not disagree
  // about which file comes first.
  const byPath = useMemo(() => {
    const out = new Map<string, FileCommentRecord[]>();
    for (const c of comments) {
      const list = out.get(c.path);
      if (list) list.push(c);
      else out.set(c.path, [c]);
    }
    return out;
  }, [comments]);

  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (comments.length === 0) return;
    setError(null);
    try {
      await copyPlain(commentsForFiles(comments));
    } catch (err) {
      // A browser that refuses the clipboard must say so rather than tick: the
      // whole exit is "the text is now on your clipboard", and a silent ✔ over
      // an empty clipboard is the one failure that wastes the reader's work.
      failed(err);
      return;
    }
    setCopied(true);
    await markCopied.mutateAsync();
  };

  return (
    <div className="px-4 py-3">
      <div className="mb-1 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        the folder this session ran in
      </div>
      {/* Its own scroller, and capped: the tree can be opened as deep as
          somebody likes, and without this the basket below it would be pushed
          off the bottom of the panel by the first folder with fifty files in
          it — which is the half of this panel that has the button. */}
      <div className="mb-3 max-h-72 overflow-auto rounded border border-[var(--border)] py-1">
        {root && !root.exists ? (
          <div className="px-2 py-1 text-xs text-[var(--text-dim)]">
            {/* Two ordinary states, and the panel cannot tell them apart from
                here: a folder that has been moved or deleted, and a session
                whose transcript never recorded a cwd — that one's path is the
                encoded directory name, which is not a path anywhere. */}
            This folder is not there any more, or this session never recorded which one it ran in.
            <div className="mt-1 font-mono text-[10px] break-all">{root.path}</div>
          </div>
        ) : (
          <FileTree sessionId={sessionId} />
        )}
      </div>

      {error && (
        <div className="mb-2 rounded border border-red-500/40 bg-red-500/5 px-2 py-1 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {comments.length === 0 ? (
        <div className="text-sm text-[var(--text-dim)]">
          No comments yet. Open a file and select a passage of it — the button that appears files a remark here,
          and the same works for any file opened from the conversation.
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
              {comments.length} comment{comments.length === 1 ? '' : 's'} on {byPath.size} file
              {byPath.size === 1 ? '' : 's'}
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
              <div className="mb-1 truncate font-mono text-[11px] text-[var(--text-dim)]" title={path}>
                {path}
              </div>
              <div className="space-y-1">
                {list.map((c, i) => (
                  <div key={c.id} className="flex items-start gap-2 rounded border border-[var(--border)] px-2 py-1 text-xs">
                    <div className="min-w-0 flex-1">
                      <FileCommentRef index={i + 1} quote={c.quote} line={c.line} endLine={c.endLine} />
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
                              if (text) write.mutate({ ...c, text });
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
                            if (text && text !== c.text) write.mutate({ ...c, text });
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
            {copiedAt && <span className="text-[10px] text-[var(--text-dim)]">copied {new Date(copiedAt).toLocaleString()}</span>}
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-dim)]">
            Paste it into the terminal running this project.
          </div>
        </>
      )}
    </div>
  );
}
