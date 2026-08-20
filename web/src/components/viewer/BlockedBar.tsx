import { PILL_CORNER_PX } from './FollowBottom.tsx';

/**
 * Why this session cannot be picked up from the app — drawn **in place of** the
 * control it would have been pressed on.
 *
 * Two rows for one fact is what this replaces: a dead composer (or a greyed
 * "start a terminal" button) with a grey sentence stacked above it, both saying
 * the same nothing. The control is not disabled here, it is absent: there is no
 * action to offer, so the row is the message and the message is the row.
 *
 * **Amber, not red.** Nothing has gone wrong — the commonest reason by far is
 * that the conversation is simply open somewhere else, which is a state to
 * resolve rather than a failure to report. Red is kept for what actually broke:
 * a prompt that came back with an error, a CLI that would not start. That
 * distinction has to survive any restyling of this, or the palette stops meaning
 * anything.
 *
 * It clears itself. Every reason behind it is re-read on the events that could
 * change it (`live-changed`, `terminal-changed`, `chat-changed`), so closing the
 * other terminal brings the control back with no reload and nothing to press
 * here.
 */
export function BlockedBar({ reason, columnWidth }: { reason: string; columnWidth?: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90"
      style={
        // The follow pill floats in this corner where the column reaches the
        // window's edge; give it room, exactly as the composer and the start bar
        // do. Same `max()`, same constant.
        columnWidth
          ? { paddingRight: `max(0.75rem, calc(${String(PILL_CORNER_PX)}px - 50vw + ${columnWidth} / 2))` }
          : undefined
      }
    >
      <span aria-hidden className="shrink-0 text-amber-400">
        ⚠
      </span>
      <span className="min-w-0">{reason}</span>
    </div>
  );
}
