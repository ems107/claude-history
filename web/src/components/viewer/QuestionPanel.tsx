import type { ChatPlanDecision, ChatQuestion } from '@claude-history/shared';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileRefChip } from './FileRefLink.tsx';
import { Markdown } from './Markdown.tsx';
import { type PlanComment, PlanReview, commentsFeedback } from './PlanReview.tsx';
import { Sketch } from './Sketch.tsx';

/**
 * What Claude is waiting on, sitting where the next message would go.
 *
 * Deliberately NOT a modal. A question does not stop the rest of the app being
 * useful — you may want to scroll back and read what led to it, or check
 * another session — and a dialog over the conversation prevents exactly that.
 * It lives between the transcript and the composer because that is where it
 * belongs in the flow: the last thing said, waiting for the next.
 *
 * Two shapes arrive, told apart by `questions`: Claude's multiple-choice list
 * (one tab each) and a tool the auto classifier would not approve, which is a
 * plain allow/deny over its own input.
 */
export function QuestionPanel({
  question,
  onAnswer,
  onDecline,
  onPlanDecision,
  busy,
}: {
  question: ChatQuestion;
  onAnswer: (answers: Record<string, string | string[]>, annotations: Record<string, { notes?: string }>) => void;
  onDecline: () => void;
  /** The three answers a plan takes — see `PlanApproval`. */
  onPlanDecision: (decision: ChatPlanDecision, note?: string) => void;
  busy: boolean;
}) {
  const items = question.questions;
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** Which option's sketch is on show — the last one pointed at, per question. */
  const [focused, setFocused] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  /** Reading the plan over the whole window instead of in the strip. */
  const [full, setFull] = useState(false);
  /** Remarks filed against passages of the plan — see `PlanReview`. */
  const [comments, setComments] = useState<PlanComment[]>([]);
  const commentId = useRef(0);
  const isPlan = question.toolName === 'ExitPlanMode';

  useEffect(() => {
    setNote('');
  }, [question.askedAt]);

  // A new question starts clean, on its first tab.
  useEffect(() => {
    setPicked({});
    setOther({});
    setNotes({});
    setFocused({});
    setActive(0);
    setFull(false);
    setComments([]);
  }, [question.askedAt]);

  // Escape comes back from full screen, and stops there: the page's own handler
  // ends in `navigate(-1)`, so letting it through would leave the session as
  // well as the overlay.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFull(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  /** Whether a question takes several answers — the tool's own `multiSelect`. */
  const multiOf = (q: string): boolean => items?.find((i) => i.question === q)?.multiSelect === true;

  /**
   * What this question's answer will say. Picks first, free text last — the
   * order Claude Code writes, and the order the viewer reads back.
   *
   * On a multiSelect the free text does NOT replace the picks: several boxes
   * ticked plus a typed requirement is a real answer, it exists in this corpus,
   * and the transcript card already knows how to draw it.
   *
   * On a SINGLE-choice question it is the opposite — there is one answer slot,
   * so sending both wrote `"Notificaciones dentro de la propia UI (toast/banner),
   * kk"` into it: a string Claude has to guess at, and one the viewer reads back
   * (correctly) as an option AND a typed answer, drawing two picks on a question
   * that had one. The UI keeps the two mutually exclusive; this is the same rule
   * stated where the answer is built.
   */
  const answerOf = (q: string): string[] => {
    const free = other[q]?.trim();
    if (!multiOf(q)) return free ? [free] : (picked[q] ?? []);
    return [...(picked[q] ?? []), ...(free ? [free] : [])];
  };

  const toggle = (q: string, label: string, multi: boolean) => {
    setFocused((prev) => ({ ...prev, [q]: label }));
    setPicked((prev) => {
      const current = prev[q] ?? [];
      if (!multi) return { ...prev, [q]: [label] };
      return {
        ...prev,
        [q]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
      };
    });
  };

  /**
   * Typing your own answer. On a single-choice question it TAKES the answer
   * slot: the pick is dropped as the first character lands and the options go
   * flat until the box is empty again, which is the only reading of "I am
   * answering this myself" that cannot also mean "and this option too".
   */
  const typeOther = (q: string, value: string) => {
    setOther((prev) => ({ ...prev, [q]: value }));
    if (!multiOf(q) && value.trim()) setPicked((prev) => (prev[q]?.length ? { ...prev, [q]: [] } : prev));
  };

  // A note on its own is an answer: Claude Code records it as `(notes only)`,
  // and refusing to send it would be this app being stricter than the tool.
  const answered = (q: string) => answerOf(q).length > 0 || !!notes[q]?.trim();
  const complete = (items ?? []).every((q) => answered(q.question));

  const submit = () => {
    if (!items) {
      onAnswer({}, {});
      return;
    }
    if (!complete) return;
    const answers: Record<string, string | string[]> = {};
    const annotations: Record<string, { notes?: string }> = {};
    for (const q of items) {
      const a = answerOf(q.question);
      if (a.length > 0) answers[q.question] = a;
      const n = notes[q.question]?.trim();
      if (n) annotations[q.question] = { notes: n };
    }
    onAnswer(answers, annotations);
  };

  const current = items?.[active];
  // The sketch on show: the option last pointed at, else the one taken, else the
  // first that has one — so the column is never blank while a drawing exists.
  const shown = current
    ? (current.options.find((o) => o.label === focused[current.question] && o.preview) ??
      current.options.find((o) => (picked[current.question] ?? []).includes(o.label) && o.preview) ??
      current.options.find((o) => o.preview))
    : undefined;
  const hasSketches = !!current?.options.some((o) => o.preview);
  /** A single-choice question whose answer is being typed: the options are out. */
  const typing = !!current && !current.multiSelect && !!other[current.question]?.trim();

  /**
   * What *keep planning* sends: the note, then the comments in Claude Code's own
   * `[Re: "…"] …` shape. Both in one string because there is one channel — the
   * deny message, which the transcript keeps as `userFeedback`.
   */
  const feedback = commentsFeedback(comments);
  const planNote = [note.trim(), feedback].filter(Boolean).join('\n\n');
  /**
   * Approving with comments pending is refused rather than allowed to drop them.
   * The approval's tool_result is a fixed template — there is no `userFeedback`
   * on that side of the tool for them to travel in (checked against the CLI:
   * `userComments`, which the IDE panel sends, appears in it nowhere) — so a
   * button that took them would be a button that ate them.
   */
  const approveTitle =
    comments.length > 0
      ? `${String(comments.length)} comment${comments.length === 1 ? '' : 's'} to send: comments travel with "Keep planning". Remove them to approve as it stands.`
      : null;

  const card = (
    <div
      className={`rounded-lg border border-[var(--accent-dim)] bg-[var(--accent)]/5 shadow-lg ${
        full ? 'flex max-h-full min-h-0 w-full max-w-5xl flex-col' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--accent-dim)]/40 px-3 py-1.5">
        {/* Same wording as the card it becomes in the transcript, and as
            the label on every answer bubble. */}
        <span className="text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
          {isPlan ? 'Assistant proposed a plan' : items ? 'Assistant asked' : 'Assistant needs permission'}
        </span>
        {/* One tab per question. With a single one there is nothing to
            switch between, so the strip would only be furniture. */}
        {items && items.length > 1 && (
          <div className="ml-2 flex flex-wrap gap-1">
            {items.map((q, i) => (
              <button
                key={q.question}
                type="button"
                onClick={() => setActive(i)}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  i === active
                    ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                    : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
                }`}
              >
                {answered(q.question) && <span className="mr-1 text-[var(--accent)]">✓</span>}
                {q.header || `Question ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <span className="ml-auto text-[11px] text-[var(--text-dim)]">
          {items && items.length > 1
            ? `${items.filter((q) => answered(q.question)).length} of ${items.length} answered`
            : 'waiting for you'}
        </span>
        {/* A plan is 25 KB of markdown being read in a strip above the composer,
            and it is the one thing here nobody can answer without reading it all
            — so it gets the whole window on demand. The panel comes with it,
            buttons and all: the decision is taken while the plan is on screen,
            not after closing it. */}
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          // It says *full screen* on the way out too, and never "close": beside
          // something waiting to be answered, *close* reads as dismissing it —
          // and this button only ever changes how much of the window it is being
          // read in. Same wording as the terminal's, for the same reason
          // ([SessionTerminal]).
          title={
            full
              ? `Leave full screen (Esc) — the ${isPlan ? 'plan' : 'question'} stays open`
              : 'Read it full screen'
          }
          className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          {full ? '⤡ exit full screen' : '⤢ full screen'}
        </button>
      </div>

      <div className={full ? 'min-h-0 flex-1 overflow-y-auto px-3 py-2' : `${isPlan ? 'max-h-[52vh]' : 'max-h-[40vh]'} overflow-y-auto px-3 py-2`}>
        {current && (
          <>
            <div className="mb-1.5 flex items-baseline gap-2">
              {current.header && items && items.length === 1 && (
                <span className="shrink-0 rounded bg-[var(--bg)] px-1.5 py-px text-[10px] font-semibold tracking-wide text-[var(--accent)] uppercase">
                  {current.header}
                </span>
              )}
              <span className="text-sm text-[var(--text)]">{current.question}</span>
            </div>
            {/* Side by side once there is a sketch to put beside the list —
                which is what Claude Code's own card does, and the only way
                the comparison the drawings exist for can be made. Stacked
                below `sm`, where two columns would leave neither readable. */}
            <div className={hasSketches ? 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : ''}>
              <div className="space-y-1">
                {current.options.map((o) => {
                  const on = (picked[current.question] ?? []).includes(o.label);
                  return (
                    <button
                      key={o.label}
                      type="button"
                      disabled={typing}
                      onClick={() => toggle(current.question, o.label, current.multiSelect)}
                      // Pointing at an option is asking to see it. Focus is
                      // there for the keyboard, which otherwise tabs through
                      // a list of labels with the drawings frozen elsewhere.
                      onMouseEnter={() => setFocused((prev) => ({ ...prev, [current.question]: o.label }))}
                      onFocus={() => setFocused((prev) => ({ ...prev, [current.question]: o.label }))}
                      className={`block w-full rounded border px-2.5 py-1.5 text-left transition-colors ${
                        on
                          ? 'border-[var(--accent-dim)] bg-[var(--accent)]/10'
                          : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                      } ${typing ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''} ${
                        o.preview && shown?.label === o.label ? 'ring-1 ring-[var(--accent-dim)]/50' : ''
                      }`}
                    >
                      <div className="text-sm text-[var(--text)]">{o.label}</div>
                      {o.description && o.description.trim() !== o.label.trim() && (
                        <div className="text-[11px] text-[var(--text-dim)]">{o.description}</div>
                      )}
                    </button>
                  );
                })}
              </div>
              {hasSketches && (
                <div className="min-w-0">
                  {shown?.preview ? (
                    <Sketch text={shown.preview} className="max-h-64 overflow-y-auto" />
                  ) : (
                    <div className="rounded border border-dashed border-[var(--border)] p-2 text-[11px] text-[var(--text-dim)] italic">
                      This option has no sketch.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-1.5 space-y-1">
              <input
                value={other[current.question] ?? ''}
                onChange={(e) => typeOther(current.question, e.target.value)}
                placeholder="Or type your own answer…"
                className={`w-full rounded border bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)] ${
                  typing ? 'border-[var(--accent-dim)] bg-[var(--accent)]/10' : 'border-[var(--border)]'
                }`}
              />
              {/* A different thing from the box above, recorded in a
                  different place: that one is the answer, this one is the
                  condition put on it ("this one, but explain why"). Claude
                  Code keeps them apart as `answers` and `annotations.notes`,
                  and so does this. */}
              <input
                value={notes[current.question] ?? ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [current.question]: e.target.value }))}
                placeholder="✎ A note on your answer…"
                className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-amber-500/60"
              />
            </div>
            {current.multiSelect ? (
              <div className="mt-1 text-[11px] text-[var(--text-dim)]">
                Pick as many as apply — and a typed answer can go with them.
              </div>
            ) : (
              typing && (
                <div className="mt-1 text-[11px] text-[var(--text-dim)]">
                  This question takes one answer, and you are writing it — clear the box to pick an option instead.
                </div>
              )
            )}
          </>
        )}

        {/* The plan is the thing being judged, so it is rendered as the
            markdown it is. Escaped inside a <pre> — which is what every
            other permission gets — it was unreadable at exactly the moment
            it had to be read. */}
        {isPlan && question.plan && (
          <PlanReview
            plan={question.plan}
            comments={comments}
            onAdd={(c) => setComments((prev) => [...prev, { ...c, id: `c${String(++commentId.current)}` }])}
            onRemove={(id) => setComments((prev) => prev.filter((c) => c.id !== id))}
          />
        )}
        {isPlan && !question.plan && (
          <p className="text-sm text-[var(--text-dim)]">
            Claude has finished planning, but the plan itself could not be read
            {question.planFilePath ? ' from its plan file' : ''}. Approving still works.
          </p>
        )}
        {!items && !isPlan && (
          <>
            <p className="mb-2 text-sm text-[var(--text)]">
              Claude wants to use <span className="font-mono">{question.toolName}</span>, and auto mode did not approve
              it on its own.
            </p>
            <pre className="max-h-40 overflow-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[11px] text-[var(--text-dim)]">
              {JSON.stringify(question.input, null, 2)}
            </pre>
          </>
        )}
      </div>

      {/* A plan takes the three answers Claude Code itself offers, not
          allow/deny: approving it also decides how the session continues,
          and refusing it is really "go back and change this", which is
          useless without saying what. The note reaches the transcript as
          `userFeedback` — the very text the viewer later prints under
          "the user said". */}
      {isPlan ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--accent-dim)]/40 px-3 py-1.5">
          {/* Full width, above the row: the reason two of the three buttons are
              out has to be readable without hovering one of them. */}
          {comments.length > 0 && (
            <div className="w-full text-[11px] text-[var(--text-dim)]">
              ✎ {comments.length} comment{comments.length === 1 ? '' : 's'} go back with{' '}
              <span className="text-[var(--text)]">Keep planning</span> — approving sends the plan as it stands, so
              remove them first.
            </div>
          )}
          {question.planFilePath && <FileRefChip path={question.planFilePath} title="Open the plan file" />}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              comments.length > 0 ? 'Anything else? (sent with the comments)' : 'What should change? (sent back with the plan)'
            }
            className="min-w-40 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
          />
          <button
            type="button"
            onClick={() => onPlanDecision('keep-planning', planNote)}
            disabled={busy}
            title={
              comments.length > 0
                ? `Send the plan back with your note and ${String(comments.length)} comment${comments.length === 1 ? '' : 's'}.`
                : 'Send the plan back for more work, with your note as the reason.'
            }
            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            Keep planning{comments.length > 0 ? ` · ${String(comments.length)} ✎` : ''}
          </button>
          <button
            type="button"
            onClick={() => onPlanDecision('approve-manual')}
            disabled={busy || comments.length > 0}
            title={approveTitle ?? 'Approve the plan and ask before each change from here on.'}
            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            Approve · ask me
          </button>
          <button
            type="button"
            onClick={() => onPlanDecision('approve-auto')}
            disabled={busy || comments.length > 0}
            title={approveTitle ?? 'Approve the plan and let Claude carry it out the way it normally works.'}
            className="rounded border border-[var(--accent-dim)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {busy ? 'Sending…' : 'Approve · go ahead'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 border-t border-[var(--accent-dim)]/40 px-3 py-1.5">
          {items && items.length > 1 && active < items.length - 1 && (
            <button
              type="button"
              onClick={() => setActive((i) => i + 1)}
              className="rounded px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              Next question →
            </button>
          )}
          <span className="ml-auto" />
          <button
            type="button"
            onClick={onDecline}
            disabled={busy}
            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            {items ? 'Decline' : 'Deny'}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || (!!items && !complete)}
            className="rounded border border-[var(--accent-dim)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {busy ? 'Sending…' : items ? 'Answer' : 'Allow'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    // No gutter or width of its own: it renders inside the composer, which is
    // itself inside the conversation's column, so the panel and the box below it
    // line up on the same edges as the bubbles.
    <div className="pb-2">
      <div className="mx-auto">
        {/* Full screen, the panel is drawn ONCE, over everything, and the strip
            keeps its place with a line saying where it went — two live copies of
            the same form would be two answers to one question. */}
        {full ? (
          <button
            type="button"
            onClick={() => setFull(false)}
            className="w-full rounded-lg border border-dashed border-[var(--accent-dim)] bg-[var(--accent)]/5 px-3 py-1.5 text-left text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
          >
            {isPlan ? 'The plan is open full screen' : 'The question is open full screen'} — Esc, or click here, to come
            back.
          </button>
        ) : (
          card
        )}
      </div>
      {/* Portalled for the same reason `ZoomableImage` is: `inset-0` has to mean
          the viewport, and inside the composer it would mean the composer. */}
      {full &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 sm:p-8"
            onClick={() => setFull(false)}
          >
            {/* The card's own background is a 5% tint — enough over the page it
                normally sits on, and nothing at all over an overlay: the
                conversation showed straight through the plan. So the ground it
                needs goes here, under it. */}
            <div
              className="flex max-h-full w-full max-w-5xl rounded-lg bg-[var(--bg)] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {card}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
