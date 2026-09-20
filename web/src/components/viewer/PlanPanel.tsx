import type { PlanCommentRecord } from '@claude-history/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatTokens } from '../../lib/cost.ts';
import { commentsFeedback, planKeyOf, planTitle, type SessionPlan } from '../../lib/plans.ts';
import { PlanCommentRef, PlanReview, type PlanComment } from './PlanReview.tsx';

const STATUS: Record<SessionPlan['status'], { label: string; tone: string }> = {
  approved: { label: '✔ approved', tone: 'text-emerald-400' },
  rejected: { label: '✖ not approved', tone: 'text-amber-400' },
  pending: { label: 'awaiting an answer', tone: 'text-[var(--text-dim)]' },
};

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/** One row of the selector, whichever of the two places its plan came from. */
interface Row {
  key: string;
  title: string;
  askedAt: string | null;
  status: { label: string; tone: string };
  text: string;
  /** The `ExitPlanMode` call, where there is one to jump to. */
  toolUseId: string | null;
  inPlay: boolean;
  /** Claude is still writing this one, so it must not be commented on. */
  unsettled: boolean;
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
 * ## The two places a plan lives, and why the file is not a lesser one
 *
 * A plan is in the transcript once its `ExitPlanMode` call has been ANSWERED,
 * and in `~/.claude/plans/<slug>.md` from the moment Claude writes it. Those
 * overlap for every finished plan and they are the same bytes, so a row is a
 * plan rather than a source — `planKeyOf` hashes the text, the two collapse
 * into one row the moment they agree, and remarks written while the dialog was
 * up are still the same remarks when the plan becomes history.
 *
 * The one state where the file is NOT a plan yet is while Claude is writing it
 * — the session is `busy` — and that row is shown and not commentable, because
 * a remark filed against text that is about to be rewritten is a remark
 * pointing nowhere. While the dialog is up the session is `waiting` and Claude
 * is blocked, so the text cannot move under a reader.
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
  composerPlan,
  liveStatus,
  canSend,
  onSend,
  onGoToCall,
}: {
  sessionId: string;
  plans: SessionPlan[];
  /** The plan this app's composer is holding open, when it is holding one. */
  composerPlan: string | null;
  /** What the CLI is doing, when one is alive: `busy`, `waiting`, or null. */
  liveStatus: 'busy' | 'waiting' | null;
  canSend: boolean;
  onSend: (note: string) => Promise<unknown>;
  onGoToCall: (toolUseId: string) => void;
}) {
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ['planReviews', sessionId],
    queryFn: () => api.planReviews(sessionId),
    staleTime: 30_000,
  });
  /**
   * The plan file. Polled while the CLI is alive, because in a terminal this is
   * the ONLY place the plan on screen exists: the `tool_use` line is not
   * persisted until the dialog is answered (0 of them in a 94-line transcript
   * with the prompt up), so without this the panel has nothing to show at the
   * one moment it is wanted.
   */
  const file = useQuery({
    queryKey: ['planFile', sessionId],
    queryFn: () => api.planFile(sessionId),
    staleTime: 5_000,
    refetchInterval: liveStatus ? 5_000 : false,
  });

  const fileText = file.data?.plan?.trim() ?? '';
  const fileKey = fileText ? planKeyOf(fileText) : null;
  /** What the dialog on screen is about, in either door. */
  const inPlayKey = composerPlan ? planKeyOf(composerPlan.trim()) : liveStatus === 'waiting' ? fileKey : null;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = plans.map((p) => ({
      key: p.key,
      title: p.title ?? 'Untitled plan',
      askedAt: p.askedAt,
      status: STATUS[p.status],
      text: p.text ?? '',
      toolUseId: p.toolUseId,
      inPlay: p.key === inPlayKey,
      unsettled: false,
    }));
    // The file is its own row only while no submitted plan already IS it. Once
    // the dialog is answered the transcript line arrives with the same text and
    // the same key, so the row does not move and neither do its remarks.
    if (fileKey && !out.some((r) => r.key === fileKey)) {
      const waiting = liveStatus === 'waiting';
      out.unshift({
        key: fileKey,
        title: planTitle(fileText) ?? 'The plan file',
        askedAt: null,
        status: waiting
          ? { label: 'waiting for your answer', tone: 'text-amber-400' }
          : liveStatus === 'busy'
            ? { label: 'Claude is still writing it', tone: 'text-[var(--text-dim)]' }
            : { label: 'in the plan file', tone: 'text-[var(--text-dim)]' },
        text: fileText,
        toolUseId: null,
        inPlay: waiting,
        unsettled: liveStatus === 'busy',
      });
    }
    return out;
  }, [plans, fileKey, fileText, liveStatus, inPlayKey]);

  const [selected, setSelected] = useState<string | null>(null);
  // Follow the plan on screen when one appears — that is what the reader came
  // for — but never take the choice back off them afterwards.
  useEffect(() => {
    if (inPlayKey) setSelected(inPlayKey);
  }, [inPlayKey]);
  const current = selected && rows.some((r) => r.key === selected) ? selected : (inPlayKey ?? rows[0]?.key ?? null);
  const row = rows.find((r) => r.key === current) ?? null;

  const comments: PlanComment[] = reviews.data?.find((r) => r.planKey === current)?.comments ?? [];
  const sentAt = reviews.data?.find((r) => r.planKey === current)?.sentAt ?? null;
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of reviews.data ?? []) out.set(r.planKey, r.comments.length);
    return out;
  }, [reviews.data]);
  /**
   * Stacks whose plan is not in this list any more — a plan commented on while
   * Claude was still writing it, and then rewritten. Listed rather than dropped:
   * the remark carries its own quote, so it is still readable and still
   * copyable, and silently losing somebody's writing is the one outcome this
   * panel may not have.
   */
  const orphans = (reviews.data ?? []).filter((r) => !rows.some((x) => x.key === r.planKey));

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
    mutationFn: (key: string) => api.clearPlanReview(sessionId, key),
    onSuccess: refresh,
  });
  const markSent = useMutation({
    mutationFn: () => api.markPlanReviewSent(sessionId, current ?? ''),
    onSuccess: refresh,
  });

  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // One string, one channel: the transcript keeps the note and the remarks glued
  // together exactly as Claude was given them.
  const outgoing = [note.trim(), commentsFeedback(comments)].filter(Boolean).join('\n\n');

  // A fresh plan starts with a fresh note; the remarks are keyed on the plan and
  // look after themselves.
  useEffect(() => {
    setNote('');
    setCopied(false);
    setSendError(null);
  }, [current]);

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

  if (rows.length === 0) {
    return <div className="px-4 py-3 text-sm text-[var(--text-dim)]">This session has not planned anything.</div>;
  }

  return (
    <div className="px-4 py-3">
      <div className="space-y-1">
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setSelected(r.key)}
            className={`block w-full rounded border px-2 py-1.5 text-left ${
              current === r.key
                ? 'border-[var(--accent-dim)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] md:hover:bg-[var(--bg-hover)]'
            }`}
          >
            <div className="truncate text-xs font-semibold text-[var(--text)]">{r.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-dim)]">
              <span className={r.status.tone}>{r.status.label}</span>
              {/* A word, not a colour: which plan is on screen right now is the
                  one fact a reader opens this panel to find. */}
              {r.inPlay && <span className="font-semibold text-[var(--accent)]">· on screen now</span>}
              {r.askedAt && <span>· {when(r.askedAt)}</span>}
              <span>· {formatTokens(r.text.length)} chars</span>
              {(counts.get(r.key) ?? 0) > 0 && <span className="text-amber-400/80">· {counts.get(r.key)} ✎</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-[var(--border)] pt-3">
        {!row || !row.text ? (
          <div className="text-sm text-[var(--text-dim)]">
            The plan itself was not recorded in this transcript, so there is nothing to comment on.
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              {row.toolUseId && (
                <button
                  type="button"
                  onClick={() => onGoToCall(row.toolUseId!)}
                  className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-dim)] md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
                >
                  ↓ in the conversation
                </button>
              )}
              {sentAt && <span className="text-[var(--text-dim)]">sent {when(sentAt)}</span>}
              {comments.length > 0 && (
                <button
                  type="button"
                  onClick={() => clear.mutate(current!)}
                  className="ml-auto rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-dim)] md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
                >
                  Clear all
                </button>
              )}
            </div>
            {row.unsettled && (
              <div className="mb-2 rounded border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-dim)]">
                Claude is still writing this one, so it will change under you — it becomes commentable the moment it is
                put in front of you.
              </div>
            )}
            <PlanReview
              plan={row.text}
              comments={comments}
              readOnly={row.unsettled}
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
                  {canSend && (
                    <button
                      type="button"
                      onClick={() => void send()}
                      className="min-h-11 rounded border border-[var(--accent-dim)] px-3 text-[11px] text-[var(--accent)] md:min-h-0 md:py-1 md:hover:bg-[var(--bg-hover)]"
                    >
                      Send as “keep planning”
                    </button>
                  )}
                </div>
                {/* Said in words rather than as a dead button, and the words are
                    what to DO — not why a button is missing. The server's
                    `blockedReason` ("already open in the embedded terminal") is
                    true and useless here: that terminal is exactly where this
                    text is going. */}
                <div className="mt-1 text-[10px] text-[var(--text-dim)]">
                  {canSend
                    ? 'Comments travel with a refusal only — approving cannot carry them.'
                    : row.inPlay
                      ? 'Paste it into the CLI’s “Tell Claude what to change” box.'
                      : 'Copy it to use it wherever you like.'}
                </div>
                {sendError && <div className="mt-1 text-[11px] text-red-400">{sendError}</div>}
              </div>
            )}
          </>
        )}
      </div>

      {orphans.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-2">
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
            on earlier versions of a plan
          </div>
          {orphans.map((o) => (
            <div key={o.planKey} className="mb-2 rounded border border-[var(--border)] px-2 py-1.5">
              <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--text-dim)]">
                <span>
                  {o.comments.length} comment{o.comments.length === 1 ? '' : 's'} on text that is no longer in this
                  session
                </span>
                <button
                  type="button"
                  onClick={() => clear.mutate(o.planKey)}
                  className="ml-auto rounded px-1 md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
                >
                  Discard
                </button>
              </div>
              {o.comments.map((c, i) => (
                <div key={c.id} className="mt-1 rounded border border-[var(--border)] px-2 py-1 text-xs">
                  <PlanCommentRef index={i + 1} quote={c.quote} heading={c.heading || null} />
                  <div className="whitespace-pre-wrap text-[var(--text)]">{c.text}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
