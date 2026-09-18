import type { ContentBlock } from '@claude-history/shared';

type InterruptBlock = Extract<ContentBlock, { kind: 'interrupt' }>;

/**
 * The user pressing stop, drawn as the event it is.
 *
 * Claude Code records it as a `user` line reading `[Request interrupted by
 * user]`, and taken at face value it became a prompt bubble in the user's own
 * colour, saying a sentence the user never wrote — the same class of bug as a
 * task notification drawn as a prompt, and with the same fix: it is not a
 * message, it is what happened to the message above it.
 *
 * So it is a thin line, on the rail with the answer it cut short, in the rose
 * the viewer already uses for a branch that was cut away. It carries no
 * timestamp of its own: it lands within a second of the reply it stopped, and
 * the turn's clock already says when that was.
 */
export function InterruptMarker({ block }: { block: InterruptBlock }) {
  return (
    <div
      className="my-1.5 flex flex-wrap items-center gap-2 rounded border border-dashed border-rose-500/30 bg-rose-500/5 px-3 py-1 text-xs"
      title={
        block.forToolUse
          ? 'The user stopped the turn while a tool call was in flight — Claude Code wrote "[Request interrupted by user for tool use]".'
          : 'The user stopped the turn — Claude Code wrote "[Request interrupted by user]".'
      }
    >
      <span aria-hidden className="text-rose-300/80">
        ⏹
      </span>
      <span className="text-[10px] font-semibold tracking-wider text-rose-300 uppercase">interrupted</span>
      <span className="text-[var(--text-dim)]">
        {block.forToolUse ? 'The user stopped Claude at a tool call' : 'The user stopped Claude mid-answer'}
      </span>
    </div>
  );
}
