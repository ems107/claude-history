import type { ContentBlock } from '@claude-history/shared';

type ToolBlockType = Extract<ContentBlock, { kind: 'tool' }>;

interface AskedQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface AnsweredQuestions {
  questions: AskedQuestion[];
  /** Question text -> what was chosen. Empty when the user declined. */
  answers: Record<string, string>;
  declined: boolean;
}

/**
 * Recover an `AskUserQuestion` exchange from the transcript.
 *
 * The two halves live apart: the questions are the tool's input, and the answer
 * only exists as prose in its result — `Your questions have been answered:
 * "…"="…"` — because that is what Claude Code writes. Rendering the raw JSON of
 * both, which is what a generic tool block does, buries the one line a reader
 * actually wants: which option was picked.
 */
export function parseAskUserQuestion(block: ToolBlockType): AnsweredQuestions | null {
  if (block.toolName !== 'AskUserQuestion') return null;
  const input = block.input as { questions?: unknown } | null;
  const raw = input?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const questions: AskedQuestion[] = [];
  for (const q of raw) {
    if (typeof q !== 'object' || q === null) continue;
    const item = q as Partial<AskedQuestion>;
    if (typeof item.question !== 'string' || !Array.isArray(item.options)) continue;
    questions.push({
      question: item.question,
      header: typeof item.header === 'string' ? item.header : '',
      options: item.options.filter(
        (o): o is { label: string; description: string } =>
          typeof o === 'object' && o !== null && typeof (o as { label?: unknown }).label === 'string',
      ),
      multiSelect: item.multiSelect === true,
    });
  }
  if (questions.length === 0) return null;

  const answers: Record<string, string> = {};
  const text = block.result?.text ?? '';
  for (const m of text.matchAll(/"([^"]+)"="([^"]*)"/g)) answers[m[1]] = m[2];
  // A refusal leaves no pairs, and the tool says so in its own words.
  const declined = Object.keys(answers).length === 0 && /declin|denied|stopped/i.test(text);
  return { questions, answers, declined };
}

/**
 * The exchange as a part of the conversation, not as one of the tool calls.
 *
 * It sits BETWEEN tool runs rather than inside one, and never folds: Claude
 * stopping to ask something, and the answer it was given, is a turn of the
 * conversation in miniature — burying it among twenty Reads and Greps files it
 * as plumbing, which it is not. The call itself stays in the run behind this,
 * with its raw input, its result and its cost, so nothing is lost for anyone
 * reading the mechanics or following a `?tool=` link.
 */
export function AnsweredQuestionCard({ parsed }: { parsed: AnsweredQuestions }) {
  return (
    <div className="my-2 rounded-lg border border-[var(--accent-dim)]/50 bg-[var(--accent)]/5 px-3 py-2">
      <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
        {parsed.declined ? 'Claude asked — declined' : 'Claude asked'}
      </div>
      <AnsweredQuestionPanel parsed={parsed} />
    </div>
  );
}

/** One-line summary of what was chosen. */
export function answerSummary(parsed: AnsweredQuestions): string {
  if (parsed.declined) return 'declined';
  const picked = parsed.questions
    .map((q) => parsed.answers[q.question])
    .filter((a): a is string => typeof a === 'string' && a.length > 0);
  return picked.length ? picked.join(' · ') : 'no answer recorded';
}

/**
 * The exchange as it happened: every option Claude offered, with the chosen one
 * marked. Showing the ones NOT taken is the point — it is what makes the answer
 * a decision rather than a sentence.
 */
export function AnsweredQuestionPanel({ parsed }: { parsed: AnsweredQuestions }) {
  return (
    <div className="space-y-2.5">
      {parsed.questions.map((q) => {
        const answer = parsed.answers[q.question] ?? '';
        // multiSelect answers arrive joined; a free-typed one matches nothing.
        const chosen = answer.split(',').map((a) => a.trim()).filter(Boolean);
        const matched = q.options.filter((o) => chosen.includes(o.label));
        const freeText = answer && matched.length === 0 ? answer : null;
        return (
          <div key={q.question}>
            <div className="mb-1 flex items-baseline gap-2">
              {q.header && (
                <span className="shrink-0 rounded bg-[var(--bg)] px-1.5 py-px text-[10px] font-semibold tracking-wide text-[var(--accent)] uppercase">
                  {q.header}
                </span>
              )}
              <span className="text-xs text-[var(--text)]">{q.question}</span>
            </div>
            <div className="space-y-0.5">
              {q.options.map((o) => {
                const picked = chosen.includes(o.label);
                return (
                  <div
                    key={o.label}
                    className={`flex items-baseline gap-2 rounded px-2 py-1 text-xs ${
                      picked
                        ? 'border border-[var(--accent-dim)] bg-[var(--accent)]/10 text-[var(--text)]'
                        : 'border border-transparent text-[var(--text-dim)] opacity-60'
                    }`}
                  >
                    <span aria-hidden className={`shrink-0 ${picked ? 'text-[var(--accent)]' : 'opacity-40'}`}>
                      {picked ? '●' : '○'}
                    </span>
                    <span className={picked ? 'font-medium' : ''}>{o.label}</span>
                    {o.description && o.description.trim() !== o.label.trim() && (
                      <span className="truncate text-[11px] opacity-70">{o.description}</span>
                    )}
                  </div>
                );
              })}
              {freeText && (
                <div className="flex items-baseline gap-2 rounded border border-[var(--accent-dim)] bg-[var(--accent)]/10 px-2 py-1 text-xs text-[var(--text)]">
                  <span aria-hidden className="shrink-0 text-[var(--accent)]">
                    ✎
                  </span>
                  <span className="font-medium">{freeText}</span>
                  <span className="text-[11px] opacity-70">typed instead</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {parsed.declined && (
        <div className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)]">
          The question was declined, so Claude carried on without an answer.
        </div>
      )}
    </div>
  );
}
