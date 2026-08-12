import type { LiveInfo } from '@claude-history/shared';
import { useEffect, useState } from 'react';
import { elapsed } from '../../lib/format.ts';
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
 */
export function WorkingIndicator({ live }: { live: LiveInfo | null }) {
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
  const spent = since === null ? null : elapsed(since);

  // No margin of its own: it is spaced by whatever holds it — the turn's rail,
  // or the list itself when there is no turn to hang it on.
  return (
    <div role="status">
      <Bubble side="assistant">
        {/* py-1.5 is headroom, not padding: the dots rise 5 px out of their line
            and a tight row would clip the top of the wave. */}
        <div className="flex items-center gap-3 py-1.5 text-sm text-[var(--text-dim)]">
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
          {spent !== null && (
            // Out of the announced text: a screen reader repeating the seconds
            // every second would drown the one thing worth saying.
            <span aria-hidden="true" className="tabular-nums text-xs text-[var(--text-dim)]/70">
              {spent}
            </span>
          )}
        </div>
      </Bubble>
    </div>
  );
}
