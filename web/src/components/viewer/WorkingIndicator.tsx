import type { LiveInfo } from '@claude-history/shared';
import { useEffect, useState } from 'react';
import { elapsed, formatDateTime } from '../../lib/format.ts';
import { NO_ACTIVITY, type TurnActivity } from '../../lib/turnActivity.ts';
import { Bubble } from './Bubble.tsx';
import { PILL_CORNER_PX } from './FollowBottom.tsx';

/**
 * Claude Code stamps `status` on ~/.claude/sessions/<pid>.json the moment a turn
 * starts and again when it ends. There is no heartbeat in between (measured:
 * `updatedAt` frozen for 3 minutes into a busy turn), so the transition is
 * written exactly when it happens and the file watcher sees it within its 300 ms
 * debounce — this indicator is as immediate as the CLI's own spinner.
 */
const BUSY = 'busy';

/**
 * Whether this session is mid-turn. Exported because the caller has to know
 * BEFORE rendering: the indicator hangs on the turn's rail, and a rail built
 * around a component that renders nothing is a stray green line down the page.
 */
export function isWorking(live: LiveInfo | null | undefined): boolean {
  return live?.status === BUSY;
}

/**
 * The clock a session's `total` figure counts from: when the status last
 * changed, which for a busy session is when the turn began.
 *
 * Beside `isWorking` because it is the other half of the same reading, and
 * because the indicator itself no longer knows what a `LiveInfo` is — a
 * subagent has none, and the row is the same row.
 */
export function workingSince(live: LiveInfo | null | undefined): number | null {
  return live?.statusUpdatedAt ?? live?.updatedAt ?? null;
}

/**
 * One elapsed figure. The clock it counts from is on the hover, because the
 * span alone cannot say WHEN — and the span is the thing worth reading at a
 * glance, so the absolute time may not take a character of the row.
 *
 * **The number is brighter than its caption**, and both are readable. Three
 * figures written in one flat grey were a single grey string the eye had to
 * parse word by word, and the whole row sat at `/70` of `--text-dim`: 3.6:1 on
 * the bubble, under AA for 12 px text. Now the captions carry the full dim
 * (5.9:1) and the seconds — the only part that changes — carry `--text` (9.5:1),
 * so the row is scanned as three numbers with quiet labels rather than read.
 * Not `font-mono`: the tabular figures are already aligned, and mono spaced
 * "3 min 25 s" out into something wider and clumsier than the sans.
 */
function Figure({ label, at, hint }: { label?: string; at: number; hint: string }) {
  return (
    <span className="whitespace-nowrap" title={`${hint} ${formatDateTime(at)}`}>
      {label ? `${label} ` : ''}
      <span className="text-[var(--text)]/90">{elapsed(at)}</span>
    </span>
  );
}

/**
 * "Claude is working" at the foot of a live conversation.
 *
 * This is the closest an on-disk reader can get to the CLI's streaming answer,
 * and the gap is not ours to close: the transcript is written one CLOSED content
 * block per line (thinking, text, tool_use — each with its own timestamp), so
 * partial text never touches the disk at all. Between blocks the viewer has
 * nothing new to draw for a median of 4.5 s, and a long final answer lands whole
 * after ~20 s of silence. That silence is what this fills.
 *
 * It is presentation only: no turn, no item, no cost. It hangs BELOW TurnList
 * rather than inside it, so nothing that folds, counts or prices a message can
 * ever see it — and, being inside the followed content box, the "To the end"
 * pill keeps it in view as the answer grows.
 *
 * Three clocks, and the two after the first are the ones that say whether the
 * silence is going anywhere: the turn's `total`, how long since the model last
 * WROTE (tool calls are not messages, or the two would be the same number all
 * through a run) and how long since the last tool was called. Each appears only
 * once it has something of its own to report — a turn that has produced nothing
 * yet shows one figure, which is the truth about it.
 *
 * **Whether anything is working at all is the CALLER's to answer**, and so is
 * the clock: a session reads both off `~/.claude/sessions` (`isWorking` /
 * `workingSince`), a subagent has no such file and reads its own transcript
 * instead. Rendered, this row always means "still going" — every call site
 * already had to know that before drawing the rail it hangs on.
 */
export function WorkingIndicator({
  since,
  activity = NO_ACTIVITY,
  columnWidth,
  startHint = 'Turn started',
  label = 'Claude is working…',
}: {
  /** When the thing being waited on began (epoch ms); null draws no clocks. */
  since: number | null;
  /** What has landed since this turn began — see `turnActivity`. */
  activity?: TurnActivity;
  /** What the `total` figure's hover says it counts from. */
  startHint?: string;
  /**
   * The sentence itself, for a wait that is not Claude's. A turn can END with
   * agents still running — they are launched asynchronously and the report is
   * what wakes the session back up — and there "Claude is working" would be
   * plainly false: Claude is idle, and something it sent out is not.
   */
  label?: string;
  /**
   * The width of the conversation's column, as a CSS length — the same string
   * the composer takes, for the same corner. The clocks sit at the far right of
   * the bubble, and the follow pill floats in the scroller's bottom-right: where
   * the column reaches the window's edge (`Full` width) the two share that band
   * and the pill covers `last tool` outright (measured: the figure at x 1380-1447
   * under the pill's 1375-1470). So the row gives up exactly the difference, as
   * one `max()` over the column — the same arithmetic that moves `Send` aside,
   * with the floor at 0 because the flush edge is what right alignment is for.
   *
   * **Passed only when nothing stands between this row and the pill**, which
   * means a foot with no composer — and the caller decides, because only the
   * caller knows what the foot holds. The pill's band is the bottom 16-46 px of
   * the scroller (`bottom-4` plus its own 30 px) and the sticky composer is stuck
   * across it, never shorter than ~70 px of box plus its 24 px gap (measured:
   * 119 px). So with a composer the pill floats over THAT and these clocks are
   * clear of it by construction; giving up the corner anyway was 120 px of gutter
   * at `Full` width, dragging the figures off the very edge this row is anchored
   * to. Absent, nothing is given up.
   */
  columnWidth?: string;
}) {
  // The counter is re-rendered, not recomputed from a stored value: `elapsed`
  // reads the clock, so a tick a second is all it takes to keep it truthful.
  // Unconditional, because this row only exists while something is working.
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Only what landed AFTER the turn began. With no turn start there is nothing
   * to be "during" — a bare "last message 3 hr" would be the previous turn's
   * last word wearing this turn's clothes — so an unknown start hides both.
   */
  const during = (at: number | null) => (at !== null && since !== null && at > since ? at : null);
  const messageAt = during(activity.lastMessageAt);
  const toolAt = during(activity.lastToolAt);

  // No margin of its own: it is spaced by whatever holds it — the turn's rail,
  // or the list itself when there is no turn to hang it on.
  return (
    <div role="status">
      <Bubble side="assistant">
        {/* py-1.5 is headroom, not padding: the dots rise 5 px out of their line
            and a tight row would clip the top of the wave. It wraps rather than
            overflows: three figures are still a short row at the default width,
            and a narrow column or a 150 % zoom must break the line instead of
            pushing the seconds out of the bubble. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm text-[var(--text-dim)]">
          <span aria-hidden="true" className="flex items-center gap-1.5">
            {/* One keyframe, three delays: the stagger is what reads as motion. */}
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="working-dot size-[7px] rounded-full bg-[var(--accent)]"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
          {/* Deliberately not "writing a response": `busy` covers the whole turn,
              tool calls included, and most of a turn is not prose being written.
              Claiming otherwise would be wrong for most of the time it shows. */}
          <span className="working-label">{label}</span>
          {since !== null && (
            // Out of the announced text: a screen reader repeating the seconds
            // every second would drown the one thing worth saying.
            // `ml-auto` puts them at the far end of the bubble, which is what
            // makes the row a status line instead of a sentence with telemetry
            // glued to it: the sentence owns the left, the clocks own the right,
            // and the empty half between them is the separation. It also anchors
            // the RIGHT edge, so `total` growing from "59 s" to "1 min 0 s"
            // pushes leftwards and the figure being watched — `last tool`, the
            // one that moves every second — never shifts under the eye.
            <span
              aria-hidden="true"
              className="ml-auto tabular-nums text-xs text-[var(--text-dim)]"
              style={
                columnWidth
                  ? { paddingRight: `max(0px, calc(${PILL_CORNER_PX}px - 50vw + ${columnWidth} / 2))` }
                  : undefined
              }
            >
              {/* Labelled like the two beside it: bare, it was the only figure
                  and could only be the turn, but next to "last message" a naked
                  number is one of three and says nothing about which. */}
              <Figure label="total" at={since} hint={startHint} />
              {/* Neither figure can appear without the turn's own (both are gated
                  on a known start), so a separator never opens the row. Inline
                  text with `nowrap` on each figure: the line breaks at a dot and
                  never inside "1 min 4 s". */}
              {messageAt !== null && (
                <>
                  {' · '}
                  <Figure label="last message" at={messageAt} hint="Last message landed" />
                </>
              )}
              {toolAt !== null && (
                <>
                  {' · '}
                  <Figure label="last tool" at={toolAt} hint="Last tool called" />
                </>
              )}
            </span>
          )}
        </div>
      </Bubble>
    </div>
  );
}
