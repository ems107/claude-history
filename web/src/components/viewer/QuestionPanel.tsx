import type { ChatPlanDecision, ChatQuestion } from '@claude-history/shared';
import { useEffect, useState } from 'react';
import { FileRefChip } from './FileRefLink.tsx';
import { Markdown } from './Markdown.tsx';
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
  }, [question.askedAt]);

  /**
   * What this question's answer will say. Picks first, free text last — the
   * order Claude Code writes, and the order the viewer reads back.
   *
   * The free text does NOT replace the picks. It used to, and that made one real
   * kind of answer unsendable from here: several boxes ticked plus a typed
   * requirement, which exists in this corpus and which the transcript card
   * already knew how to draw.
   */
  const answerOf = (q: string): string[] => {
    const free = other[q]?.trim();
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

  return (
    // No gutter or width of its own: it renders inside the composer, which is
    // itself inside the conversation's column, so the panel and the box below it
    // line up on the same edges as the bubbles.
    <div className="pb-2">
      <div className="mx-auto">
        <div className="rounded-lg border border-[var(--accent-dim)] bg-[var(--accent)]/5 shadow-lg">
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
          </div>

          <div className="max-h-[40vh] overflow-y-auto px-3 py-2">
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
                          } ${o.preview && shown?.label === o.label ? 'ring-1 ring-[var(--accent-dim)]/50' : ''}`}
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
                    onChange={(e) => setOther((prev) => ({ ...prev, [current.question]: e.target.value }))}
                    placeholder="Or type your own answer…"
                    className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
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
                {current.multiSelect && (
                  <div className="mt-1 text-[11px] text-[var(--text-dim)]">Pick as many as apply.</div>
                )}
              </>
            )}

            {/* The plan is the thing being judged, so it is rendered as the
                markdown it is. Escaped inside a <pre> — which is what every
                other permission gets — it was unreadable at exactly the moment
                it had to be read. */}
            {isPlan && question.plan && <Markdown text={question.plan} />}
            {isPlan && !question.plan && (
              <p className="text-sm text-[var(--text-dim)]">
                Claude has finished planning, but the plan itself could not be read
                {question.planFilePath ? ' from its plan file' : ''}. Approving still works.
              </p>
            )}
            {!items && !isPlan && (
              <>
                <p className="mb-2 text-sm text-[var(--text)]">
                  Claude wants to use <span className="font-mono">{question.toolName}</span>, and auto mode did not
                  approve it on its own.
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
              {question.planFilePath && <FileRefChip path={question.planFilePath} title="Open the plan file" />}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What should change? (sent back with the plan)"
                className="min-w-40 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
              />
              <button
                type="button"
                onClick={() => onPlanDecision('keep-planning', note)}
                disabled={busy}
                className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                Keep planning
              </button>
              <button
                type="button"
                onClick={() => onPlanDecision('approve-manual')}
                disabled={busy}
                title="Approve the plan and ask before each change from here on."
                className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                Approve · ask me
              </button>
              <button
                type="button"
                onClick={() => onPlanDecision('approve-auto')}
                disabled={busy}
                title="Approve the plan and let Claude carry it out the way it normally works."
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
      </div>
    </div>
  );
}
