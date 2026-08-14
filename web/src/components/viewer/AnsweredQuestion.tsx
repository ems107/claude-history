import type { ContentBlock } from '@claude-history/shared';

type ToolBlockType = Extract<ContentBlock, { kind: 'tool' }>;

interface AskedQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
  /** The options the user marked, in the order the answer named them. */
  picked: string[];
  /** What was typed under "Other" — alongside the picks, or instead of them. */
  typed: string | null;
  /** Whether an answer to this question was recorded at all. */
  answered: boolean;
}

export interface AnsweredQuestions {
  questions: AskedQuestion[];
  declined: boolean;
}

/**
 * Split one recorded answer into the options it names and the rest.
 *
 * The answer is ONE string: Claude Code joins the picks of a multiSelect with
 * ", " and appends any free text last. So the obvious `split(',')` is wrong the
 * moment a label carries a comma — and labels do, constantly ("Stash, tags y
 * worktrees", "Detectar y guiar, resolver fuera"). It broke the card both ways:
 * an option really picked drew as unpicked because only half its label was
 * looked for, and a single-choice answer whose label held a comma matched
 * nothing at all and was then announced as typed by hand. 12 of the 64
 * questions in this corpus rendered wrongly, and 2 free-text answers were
 * dropped from the page entirely (they only show when NOTHING matched).
 *
 * So the answer is consumed from the front instead: at each position take the
 * longest label that fits — a label can be a prefix of another — eat the
 * joiner, repeat. Whatever is left never matched an option, and that is exactly
 * what "Other" is.
 */
function splitAnswer(answer: string, options: { label: string }[]): { picked: string[]; typed: string | null } {
  const labels = options.map((o) => o.label).sort((a, b) => b.length - a.length);
  const picked: string[] = [];
  let rest = answer.trim();
  while (rest) {
    const label = labels.find((l) => rest === l || rest.startsWith(`${l},`));
    if (!label) break;
    if (!picked.includes(label)) picked.push(label);
    rest = rest.slice(label.length).replace(/^\s*,\s*/, '');
  }
  const typed = rest.trim();
  return { picked, typed: typed || null };
}

/**
 * What may follow an answer's closing quote — and nothing else can, which is
 * what lets a quote INSIDE the answer be told apart from the one ending it.
 * Beyond the joiner and the tool's own closing sentence, the prose appends the
 * annotations a question can carry (`selected preview:`, `notes:`).
 */
const AFTER_ANSWER = /^(\s*,?\s*|\s+selected preview:[\s\S]*|\s+notes:[\s\S]*|\.\s[\s\S]*)$/;

/**
 * The answers as prose, for a transcript that recorded them no other way.
 *
 * Anchored on the question texts we already hold rather than on a blind
 * `"…"="…"` scan: a quote inside a question ended that scan on the wrong pair
 * and cost the question its whole answer (7 questions here carry one), and a
 * quote inside an answer truncated it there. Each value is bounded by the next
 * question's marker — an end no quote can fake — and closed at the first quote
 * with nothing but a joiner or an annotation behind it.
 *
 * A question answered with notes alone is written `"…"=(no option selected)`,
 * with no marker to find: it stays unanswered here, which is the truth the
 * prose holds. The structured answers say more, and are why they come first.
 */
function answersFromProse(text: string, questions: string[]): Record<string, string> {
  const found = questions
    .map((question) => ({ question, at: text.indexOf(`"${question}"="`) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  const answers: Record<string, string> = {};
  found.forEach((m, i) => {
    const from = m.at + m.question.length + 4; // "…"="
    const next = found[i + 1];
    const slice = next ? text.slice(from, next.at) : text.slice(from);
    for (let end = slice.indexOf('"'); end >= 0; end = slice.indexOf('"', end + 1)) {
      if (AFTER_ANSWER.test(slice.slice(end + 1))) {
        answers[m.question] = slice.slice(0, end);
        return;
      }
    }
    answers[m.question] = slice;
  });
  return answers;
}

/**
 * Recover an `AskUserQuestion` exchange from the transcript.
 *
 * The two halves live apart: the questions are the tool's input, and the answer
 * comes back on the result — structurally when Claude Code recorded it that way
 * (`ToolResultInfo.answers`, the only unambiguous form), otherwise as the prose
 * `Your questions have been answered: "…"="…"`. Rendering the raw JSON of both,
 * which is what a generic tool block does, buries the one line a reader
 * actually wants: which option was picked.
 */
export function parseAskUserQuestion(block: ToolBlockType): AnsweredQuestions | null {
  if (block.toolName !== 'AskUserQuestion') return null;
  const input = block.input as { questions?: unknown } | null;
  const raw = input?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const asked: Omit<AskedQuestion, 'picked' | 'typed' | 'answered'>[] = [];
  for (const q of raw) {
    if (typeof q !== 'object' || q === null) continue;
    const item = q as Partial<AskedQuestion>;
    if (typeof item.question !== 'string' || !Array.isArray(item.options)) continue;
    asked.push({
      question: item.question,
      header: typeof item.header === 'string' ? item.header : '',
      options: item.options.filter(
        (o): o is { label: string; description: string } =>
          typeof o === 'object' && o !== null && typeof (o as { label?: unknown }).label === 'string',
      ),
      multiSelect: item.multiSelect === true,
    });
  }
  if (asked.length === 0) return null;

  const text = block.result?.text ?? '';
  const answers =
    block.result?.answers ??
    answersFromProse(
      text,
      asked.map((q) => q.question),
    );
  const questions: AskedQuestion[] = asked.map((q) => {
    const answer = answers[q.question];
    const answered = typeof answer === 'string' && answer.trim().length > 0;
    const { picked, typed } = answered ? splitAnswer(answer, q.options) : { picked: [], typed: null };
    return { ...q, picked, typed, answered };
  });
  // A refusal leaves no answers, and the tool says so in its own words.
  const declined = questions.every((q) => !q.answered) && /declin|denied|stopped/i.test(text);
  return { questions, declined };
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
      {/* "assistant", not "Claude", to match the label on every answer bubble:
          the reader is following one speaker, called the same thing throughout. */}
      <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
        {parsed.declined ? 'Assistant asked — declined' : 'Assistant asked'}
      </div>
      <AnsweredQuestionPanel parsed={parsed} />
    </div>
  );
}

/** One-line summary of what was chosen. */
export function answerSummary(parsed: AnsweredQuestions): string {
  if (parsed.declined) return 'declined';
  const answered = parsed.questions
    .map((q) => [...q.picked, ...(q.typed ? [q.typed] : [])].join(', '))
    .filter((a) => a.length > 0);
  return answered.length ? answered.join(' · ') : 'no answer recorded';
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
                const picked = q.picked.includes(o.label);
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
              {/* "Other": text that matched no option. It shows even when
                  options WERE picked — a multiSelect answer can be several
                  boxes plus a sentence, and dropping that sentence deleted a
                  requirement the user had actually stated. */}
              {q.typed && (
                <div className="flex items-baseline gap-2 rounded border border-[var(--accent-dim)] bg-[var(--accent)]/10 px-2 py-1 text-xs text-[var(--text)]">
                  <span aria-hidden className="shrink-0 text-[var(--accent)]">
                    ✎
                  </span>
                  <span className="font-medium">{q.typed}</span>
                  <span className="shrink-0 text-[11px] opacity-70">
                    {q.picked.length > 0 ? 'typed as well' : 'typed instead'}
                  </span>
                </div>
              )}
              {!q.answered && !parsed.declined && (
                <div className="px-2 py-1 text-[11px] text-[var(--text-dim)] italic">
                  No answer to this question was recorded.
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
