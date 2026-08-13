import type { ChatQuestion } from '@claude-history/shared';
import { useEffect, useState } from 'react';

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
  maxWidth,
  onAnswer,
  onDecline,
  busy,
}: {
  question: ChatQuestion;
  maxWidth?: string;
  onAnswer: (answers: Record<string, string | string[]>) => void;
  onDecline: () => void;
  busy: boolean;
}) {
  const items = question.questions;
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  // A new question starts clean, on its first tab.
  useEffect(() => {
    setPicked({});
    setOther({});
    setActive(0);
  }, [question.askedAt]);

  const answerOf = (q: string): string | string[] | null => {
    const free = other[q]?.trim();
    if (free) return free;
    const chosen = picked[q];
    if (!chosen?.length) return null;
    return chosen.length === 1 ? chosen[0] : chosen;
  };

  const toggle = (q: string, label: string, multi: boolean) => {
    setOther((prev) => ({ ...prev, [q]: '' }));
    setPicked((prev) => {
      const current = prev[q] ?? [];
      if (!multi) return { ...prev, [q]: [label] };
      return {
        ...prev,
        [q]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
      };
    });
  };

  const answered = (q: string) => answerOf(q) !== null;
  const complete = (items ?? []).every((q) => answered(q.question));

  const submit = () => {
    if (!items) {
      onAnswer({});
      return;
    }
    if (!complete) return;
    const answers: Record<string, string | string[]> = {};
    for (const q of items) {
      const a = answerOf(q.question);
      if (a !== null) answers[q.question] = a;
    }
    onAnswer(answers);
  };

  const current = items?.[active];

  return (
    // No gutter of its own: it renders inside the composer's, so the panel and
    // the box below it line up on the same edges as the bubbles.
    <div className="pb-2">
      <div className="mx-auto" style={{ maxWidth }}>
        <div className="rounded-lg border border-[var(--accent-dim)] bg-[var(--accent)]/5 shadow-lg">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--accent-dim)]/40 px-3 py-1.5">
            {/* Same wording as the card it becomes in the transcript, and as
                the label on every answer bubble. */}
            <span className="text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
              {items ? 'Assistant asked' : 'Assistant needs permission'}
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
                <div className="space-y-1">
                  {current.options.map((o) => {
                    const on = (picked[current.question] ?? []).includes(o.label) && !other[current.question]?.trim();
                    return (
                      <button
                        key={o.label}
                        type="button"
                        onClick={() => toggle(current.question, o.label, current.multiSelect)}
                        className={`block w-full rounded border px-2.5 py-1.5 text-left transition-colors ${
                          on
                            ? 'border-[var(--accent-dim)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        <div className="text-sm text-[var(--text)]">{o.label}</div>
                        {o.description && o.description.trim() !== o.label.trim() && (
                          <div className="text-[11px] text-[var(--text-dim)]">{o.description}</div>
                        )}
                      </button>
                    );
                  })}
                  <input
                    value={other[current.question] ?? ''}
                    onChange={(e) => setOther((prev) => ({ ...prev, [current.question]: e.target.value }))}
                    placeholder="Or type your own answer…"
                    className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
                  />
                </div>
                {current.multiSelect && (
                  <div className="mt-1 text-[11px] text-[var(--text-dim)]">Pick as many as apply.</div>
                )}
              </>
            )}

            {!items && (
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
        </div>
      </div>
    </div>
  );
}
