import type { LiveInfo } from '@claude-history/shared';
import { useEffect, useState } from 'react';
import { elapsed, formatDateTime } from '../../lib/format.ts';
import { NO_ACTIVITY, type TurnActivity } from '../../lib/turnActivity.ts';
import { Bubble } from './Bubble.tsx';

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
 * One elapsed figure. The clock it counts from is on the hover, because the
 * span alone cannot say WHEN — and the span is the thing worth reading at a
 * glance, so the absolute time may not take a character of the row.
 */
function Figure({ label, at, hint }: { label?: string; at: number; hint: string }) {
  return (
    <span className="whitespace-nowrap" title={`${hint} ${formatDateTime(at)}`}>
      {label ? `${label} ` : ''}
      {elapsed(at)}
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
 * silence is going anywhere: how long the TURN has run, how long since the last
 * message landed, how long since the last tool was called. Each appears only
 * once it has something of its own to report — a turn that has produced nothing
 * yet shows one figure, which is the truth about it.
 */
export function WorkingIndicator({
  live,
  activity = NO_ACTIVITY,
}: {
  live: LiveInfo | null;
  /** What has landed since this turn began — see `turnActivity`. */
  activity?: TurnActivity;
}) {
  const busy = isWorking(live);
  const since = live?.statusUpdatedAt ?? live?.updatedAt ?? null;
  // The counter is re-rendered, not recomputed from a stored value: `elapsed`
  // reads the clock, so a tick a second is all it takes to keep it truthful.
  const [, tick] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [busy]);

  if (!busy) return null;

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
          <span className="working-label">Claude is working…</span>
          {since !== null && (
            // Out of the announced text: a screen reader repeating the seconds
            // every second would drown the one thing worth saying.
            <span aria-hidden="true" className="tabular-nums text-xs text-[var(--text-dim)]/70">
              <Figure at={since} hint="Turn started" />
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
