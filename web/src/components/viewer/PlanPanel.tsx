import type { PlanCommentRecord } from '@claude-history/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatTokens } from '../../lib/cost.ts';
import { commentsFeedback, type SessionPlan } from '../../lib/plans.ts';
import { PlanReview, type PlanComment } from './PlanReview.tsx';

const STATUS: Record<SessionPlan['status'], { label: string; tone: string }> = {
  approved: { label: '✔ approved', tone: 'text-emerald-400' },
  rejected: { label: '✖ not approved', tone: 'text-amber-400' },
  pending: { label: 'awaiting an answer', tone: 'text-[var(--text-dim)]' },
};

/** The draft row's own key. It is never commented on, so it never reaches the store. */
const DRAFT = 'draft';

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/**
 * Every plan of one session, and the remarks left on each.
 *
 * ## Why this is a panel and not a moment
 *
 * The reviewer underneath it (`PlanReview`) has existed for as long as the
 * composer has, and it was reachable for exactly as long as a dialog was on
 * screen: its stack lived in a `useState`, so a refresh lost it, a session
 * driven from a real terminal never had it at all, and a phone could not get to
 * it. Reviewing a 14 KB plan is not a moment — it is reading, going away, and
 * coming back — so the stack lives in `userdata.json` and this panel is the way
 * in, for any plan of any session, alive or three months dead.
 *
 * ## The two exits, and why they are not the same button
 *
 * Remarks only travel with a REFUSAL: the approval's `tool_result` is a fixed
 * template with no field for them. Which refusal is possible depends on who
 * holds the session. This app's composer holds a pending question we can
 * answer, so there the stack is SENT. An embedded terminal draws the CLI's own
 * dialog inside itself and exposes nothing to answer, and an outside terminal
 * is not ours at all — so there the stack is COPIED, and the reader pastes it
 * into the CLI's own *keep planning* box, where it lands identically.
 */
export function PlanPanel({
  sessionId,
  plans,
  pendingPlanId,
  canSend,
  sendBlockedWhy,
  onSend,
  onGoToCall,
}: {
  sessionId: string;
  plans: SessionPlan[];
  /** The `ExitPlanMode` this app's composer is holding open, if it is holding one. */
  pendingPlanId: string | null;
  canSend: boolean;
  /** Why not, in the server's own words, when it cannot. */
  sendBlockedWhy: string | null;
  onSend: (note: string) => Promise<unknown>;
  onGoToCall: (toolUseId: string) => void;
}) {
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ['planReviews', sessionId],
    queryFn: () => api.planReviews(sessionId),
    staleTime: 30_000,
  });
  // The plan Claude has not submitted yet. Cheap (one file read) and worth
  // asking for unconditionally: whether there IS one is the answer.
  const draft = useQuery({
    queryKey: ['planDraft', sessionId],
    queryFn: () => api.planDraft(sessionId),
    staleTime: 15_000,
  });

  /**
   * The draft is only its own row while it differs from what was submitted.
   * Claude writes the file and then submits the same text, so listing both
   * unconditionally would show every finished session the same plan twice.
   */
  const draftText = draft.data?.plan?.trim() ?? '';
  const showDraft = draftText !== '' && !plans.some((p) => (p.text ?? '').trim() === draftText);

  const [selected, setSelected] = useState<string | null>(null);
  // Follow the plan in play when one appears — that is what the reader came
  // for — but never take the choice back off them afterwards.
  useEffect(() => {
    if (pendingPlanId) setSelected(pendingPlanId);
  }, [pendingPlanId]);
  const current = selected ?? pendingPlanId ?? plans[0]?.toolUseId ?? (showDraft ? DRAFT : null);
  const plan = plans.find((p) => p.toolUseId === current) ?? null;

  const comments: PlanComment[] = useMemo(() => {
    const review = reviews.data?.find((r) => r.planKey === current);
    return review?.comments ?? [];
  }, [reviews.data, current]);
  const sentAt = reviews.data?.find((r) => r.planKey === current)?.sentAt ?? null;
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of reviews.data ?? []) out.set(r.planKey, r.comments.length);
    return out;
  }, [reviews.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['planReviews', sessionId] });
  const write = useMutation({
    mutationFn: (comment: Omit<PlanCommentRecord, 'createdAt' | 'editedAt'>) =>
      api.savePlanComment(sessionId, current ?? '', comment),
    onSuccess: refresh,
  });
  const drop = useMutation({
    mutationFn: (id: string) => api.removePlanComment(sessionId, current ?? '', id),
    onSuccess: refresh,
  });
  const clear = useMutation({
    mutationFn: () => api.clearPlanReview(sessionId, current ?? ''),
    onSuccess: refresh,
  });
  const markSent = useMutation({ mutationFn: () => api.markPlanReviewSent(sessionId, current ?? ''), onSuccess: refresh });

  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // One string, one channel: the transcript keeps the note and the remarks glued
  // together exactly as Claude was given them.
  const outgoing = [note.trim(), commentsFeedback(comments)].filter(Boolean).join('\n\n');

  const copy = async () => {
    if (!outgoing) return;
    setSendError(null);
    try {
      await copyPlain(outgoing);
    } catch (err) {
      // A browser that refuses the clipboard must say so rather than tick: the
      // whole exit is "the text is now on your clipboard", and a silent ✔ over
      // an empty clipboard is the one failure that wastes the reader's work.
      setSendError(err instanceof Error ? err.message : String(err));
      return;
    }
    setCopied(true);
    await markSent.mutateAsync();
  };

  const send = async () => {
    if (!outgoing) return;
    setSendError(null);
    try {
      await onSend(outgoing);
      await markSent.mutateAsync();
      setNote('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    }
  };

  const rows = [
    ...plans.map((p) => ({
      key: p.toolUseId,
      title: p.title ?? 'Untitled plan',
      askedAt: p.askedAt,
      status: STATUS[p.status],
      chars: p.text?.length ?? 0,
      inPlay: p.toolUseId === pendingPlanId,
      draft: false,
    })),
    ...(showDraft
      ? [
          {
            key: DRAFT,
            title: 'The plan Claude is writing',
            askedAt: null,
            status: { label: 'not submitted yet', tone: 'text-[var(--text-dim)]' },
            chars: draftText.length,
            inPlay: false,
            draft: true,
          },
        ]
      : []),
  ];

  if (rows.length === 0) {
    return <div className="px-4 py-3 text-sm text-[var(--text-dim)]">This session has not planned anything.</div>;
  }

  return (
    <div className="px-4 py-3">
      <div className="space-y-1">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => setSelected(row.key)}
            className={`block w-full rounded border px-2 py-1.5 text-left ${
              current === row.key
                ? 'border-[var(--accent-dim)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] md:hover:bg-[var(--bg-hover)]'
            }`}
          >
            <div className="truncate text-xs font-semibold text-[var(--text)]">{row.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-dim)]">
              <span className={row.status.tone}>{row.status.label}</span>
              {/* A word, not a colour: which plan is on screen right now is the
                  one fact a reader opens this panel to find. */}
              {row.inPlay && <span className="font-semibold text-[var(--accent)]">· in play now</span>}
              {row.askedAt && <span>· {when(row.askedAt)}</span>}
              <span>· {formatTokens(row.chars)} chars</span>
              {(counts.get(row.key) ?? 0) > 0 && (
                <span className="text-amber-400/80">· {counts.get(row.key)} ✎</span>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-[var(--border)] pt-3">
        {current === DRAFT ? (
          <>
            {/* Read-only on purpose, and it says so: this text is a file Claude
                keeps rewriting, so a remark filed here would point at a passage
                that has since moved. */}
            <div className="mb-2 rounded border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-dim)]">
              Claude has not submitted this yet, so it is still being rewritten — you can read it, and comment once it
              is submitted.
            </div>
            <PlanReview plan={draftText} comments={[]} onAdd={() => undefined} onRemove={() => undefined} readOnly />
          </>
        ) : plan?.text ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => onGoToCall(plan.toolUseId)}
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-dim)] md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
              >
                ↓ in the conversation
              </button>
              {sentAt && <span className="text-[var(--text-dim)]">sent {when(sentAt)}</span>}
              {comments.length > 0 && (
                <button
                  type="button"
                  onClick={() => clear.mutate()}
                  className="ml-auto rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-dim)] md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
                >
                  Clear all
                </button>
              )}
            </div>
            <PlanReview
              plan={plan.text}
              comments={comments}
              onAdd={(c) => write.mutate({ ...c, id: crypto.randomUUID() })}
              onRemove={(id) => drop.mutate(id)}
              onEdit={(id, text) => {
                const existing = comments.find((c) => c.id === id);
                if (existing) write.mutate({ ...existing, text });
              }}
            />
            {comments.length > 0 && (
              <div className="mt-3 border-t border-[var(--border)] pt-2">
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything to say in your own words (optional)"
                  className="w-full resize-none rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className="min-h-11 rounded border border-[var(--accent-dim)] px-3 text-[11px] text-[var(--accent)] md:min-h-0 md:py-1 md:hover:bg-[var(--bg-hover)]"
                  >
                    {copied ? '✔ copied' : 'Copy for the terminal'}
                  </button>
                  {canSend ? (
                    <button
                      type="button"
                      onClick={() => void send()}
                      className="min-h-11 rounded border border-[var(--accent-dim)] px-3 text-[11px] text-[var(--accent)] md:min-h-0 md:py-1 md:hover:bg-[var(--bg-hover)]"
                    >
                      Send as “keep planning”
                    </button>
                  ) : (
                    // Absent would be a mystery; disabled with the reason on it
                    // is the same answer the composer's own blocked bar gives.
                    <span className="text-[10px] text-[var(--text-dim)]">
                      {sendBlockedWhy ?? 'Paste it into the terminal holding this session.'}
                    </span>
                  )}
                </div>
                {sendError && <div className="mt-1 text-[11px] text-red-400">{sendError}</div>}
                {copied && (
                  <div className="mt-1 text-[10px] text-[var(--text-dim)]">
                    Paste it into the CLI’s “No, keep planning” box.
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-[var(--text-dim)]">
            The plan itself was not recorded in this transcript, so there is nothing to comment on.
          </div>
        )}
      </div>
    </div>
  );
}
