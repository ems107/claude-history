import type { ChatQuestion } from '@claude-history/shared';
import { useEffect, useState } from 'react';

/**
 * What Claude is waiting on, rendered where you can answer it.
 *
 * This is the whole point of talking to the CLI through the SDK: in a plain
 * `--print` run `AskUserQuestion` is not even offered, so Claude notices it is
 * missing and asks in prose instead. Here the question arrives structured and
 * the turn stays parked until this is answered — same behaviour as a terminal,
 * different paint.
 *
 * Two shapes come through, told apart by `questions`: Claude's multiple-choice
 * list, and a tool the auto classifier would not approve, which is a plain
 * allow/deny over its own input.
 */
export function QuestionDialog({
  question,
  onAnswer,
  onDecline,
  busy,
}: {
  question: ChatQuestion;
  onAnswer: (answers: Record<string, string | string[]>) => void;
  onDecline: () => void;
  busy: boolean;
}) {
  const items = question.questions;
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  // A new question wipes the previous answers rather than inheriting them.
  useEffect(() => {
    setPicked({});
    setOther({});
  }, [question.askedAt]);

  const toggle = (q: string, label: string, multi: boolean) => {
    setPicked((prev) => {
      const current = prev[q] ?? [];
      if (!multi) return { ...prev, [q]: [label] };
      return {
        ...prev,
        [q]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
      };
    });
  };

  const answerOf = (q: string): string | string[] | null => {
    const free = other[q]?.trim();
    if (free) return free;
    const chosen = picked[q];
    if (!chosen?.length) return null;
    return chosen.length === 1 ? chosen[0] : chosen;
  };

  const complete = (items ?? []).every((q) => answerOf(q.question) !== null);

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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 pt-20 pb-8">
      <div
        className="flex max-h-[80vh] w-[620px] max-w-[92vw] flex-col rounded-lg border border-[var(--accent-dim)] bg-[var(--bg-raised)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--text)]">
            {items ? 'Claude needs an answer' : 'Claude needs permission'}
          </h2>
          <span className="rounded bg-[var(--bg)] px-1.5 py-px font-mono text-[10px] text-[var(--text-dim)]">
            {question.toolName}
          </span>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {items?.map((q) => {
            const chosen = picked[q.question] ?? [];
            return (
              <div key={q.question}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="rounded bg-[var(--bg)] px-1.5 py-px text-[10px] font-semibold tracking-wide text-[var(--accent)] uppercase">
                    {q.header}
                  </span>
                  <span className="text-sm text-[var(--text)]">{q.question}</span>
                </div>
                <div className="space-y-1">
                  {q.options.map((o) => {
                    const on = chosen.includes(o.label) && !other[q.question]?.trim();
                    return (
                      <button
                        key={o.label}
                        type="button"
                        onClick={() => {
                          setOther((prev) => ({ ...prev, [q.question]: '' }));
                          toggle(q.question, o.label, q.multiSelect);
                        }}
                        className={`block w-full rounded border px-2.5 py-1.5 text-left transition-colors ${
                          on
                            ? 'border-[var(--accent-dim)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        <div className="text-sm text-[var(--text)]">{o.label}</div>
                        {/* Claude sometimes repeats the label as the description;
                            printing both just reads as a stutter. */}
                        {o.description && o.description.trim() !== o.label.trim() && (
                          <div className="text-[11px] text-[var(--text-dim)]">{o.description}</div>
                        )}
                      </button>
                    );
                  })}
                  {/* Claude's options do not always cover it — same escape hatch
                      the terminal offers. */}
                  <input
                    value={other[q.question] ?? ''}
                    onChange={(e) => setOther((prev) => ({ ...prev, [q.question]: e.target.value }))}
                    placeholder="Or type your own answer…"
                    className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
                  />
                </div>
                {q.multiSelect && (
                  <div className="mt-1 text-[11px] text-[var(--text-dim)]">Pick as many as apply.</div>
                )}
              </div>
            );
          })}

          {!items && (
            <div>
              <p className="mb-2 text-sm text-[var(--text)]">
                Claude wants to use <span className="font-mono">{question.toolName}</span>, and auto mode did not
                approve it on its own.
              </p>
              <pre className="max-h-60 overflow-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[11px] text-[var(--text-dim)]">
                {JSON.stringify(question.input, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-1.5">
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
  );
}
