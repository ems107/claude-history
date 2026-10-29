import { Markdown } from './Markdown.tsx';

/**
 * A progress note: what Claude said between two tool calls, as the API returned
 * it — a SUMMARY of the note, not its words, and the same text the terminal
 * showed. Usually the only answer a prompt typed mid-turn gets before the turn
 * ends.
 *
 * It is drawn OPEN and it is never hidden: this is prose the user has already
 * read once, in the terminal, and it arrives in the transcript wearing the
 * `thinking` type it is not ([AI_TRANSCRIPTS.md](../../../../docs/AI_TRANSCRIPTS.md#narration-is-not-thinking)).
 * Behind the thinking switch it was invisible here while the terminal had it,
 * which is exactly the asymmetry the queued prompt had before it.
 *
 * The rule and the label are the whole distinction from an answer, so the
 * label says both things an answer is not: a note made DURING the work rather
 * than the conclusion, and a summary rather than Claude's own words. It read
 * `while working`, which said neither — the short lines Claude writes before a
 * tool call are written while working too, and carry no label. No fold, no id
 * of its own — the bubble around it is what `?msg=` points at, as with thinking.
 *
 * **The label is `data-chrome`** and the rule is the general one: this is drawn
 * inside `[data-bubble-body]` and it is not a word the session said, so the
 * marking walk has to reject it and the formatted copy has to cut it out — or
 * copying the message hands over a stray label that exists only on
 * screen. The rule and the walk are in AI_VIEWER.md#data-chrome-and-why-it-had-to-exist-first.
 */
export function NarrationBlock({ text }: { text: string }) {
  return (
    <div className="my-1.5 border-l-2 border-[var(--border)] pl-3">
      <div
        data-chrome
        className="mb-0.5 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase"
        title="A note Claude wrote between two tool calls, as the API returned it: a summary of what Claude wrote, not its exact words — the terminal showed the same summary. Not the answer that closed the turn."
      >
        progress note · summary
      </div>
      <Markdown text={text} />
    </div>
  );
}
