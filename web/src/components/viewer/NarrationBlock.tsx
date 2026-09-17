import { Markdown } from './Markdown.tsx';

/**
 * The commentary Claude Code printed while it was working — the lines that run
 * between the tool calls in the terminal, and usually the only answer a prompt
 * typed mid-turn gets before the turn ends.
 *
 * It is drawn OPEN and it is never hidden: this is prose the user has already
 * read once, in the terminal, and it arrives in the transcript wearing the
 * `thinking` type it is not ([AI_TRANSCRIPTS.md](../../../../docs/AI_TRANSCRIPTS.md#narration-is-not-thinking)).
 * Behind the thinking switch it was invisible here while the terminal had it,
 * which is exactly the asymmetry the queued prompt had before it.
 *
 * The rule and the label are the whole distinction from an answer: it is the
 * same voice, but it was said DURING the work rather than at the end of it, and
 * a reader who cannot see which is which would take a mid-run status line for
 * the conclusion. No fold, no id of its own — the bubble around it is what
 * `?msg=` points at, as with thinking.
 */
export function NarrationBlock({ text }: { text: string }) {
  return (
    <div className="my-1.5 border-l-2 border-[var(--border)] pl-3">
      <div
        className="mb-0.5 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase"
        title="Claude Code printed this in the terminal while it was still working — a status line between two tool calls, not the answer that closed the turn."
      >
        while working
      </div>
      <Markdown text={text} />
    </div>
  );
}
