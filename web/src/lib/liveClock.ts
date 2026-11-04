import type { LiveInfo } from '@claude-history/shared';
import { LIVE_BUSY } from '@claude-history/shared';

/**
 * When the CLI last stamped a change of status. `updatedAt` stands in for a CLI
 * too old to write `statusUpdatedAt`. What re-stamps it is not only a change of
 * state — see [AI_TRANSCRIPTS.md](../../../docs/AI_TRANSCRIPTS.md#status-has-four-values-and-one-of-them-says-the-session-is-waiting-for-you).
 */
export function flipOf(live: LiveInfo | null | undefined): number | null {
  return live?.statusUpdatedAt ?? live?.updatedAt ?? null;
}

/**
 * When a session started doing what it is doing now: the clock its STATE badge
 * counts from (`Badges`), and the one the live sections at the top of the list
 * are ordered by (`buildRows`) — so the order on screen is the badges' own
 * numbers, smallest first.
 *
 * - **working** counts from the turn's own start, `busySince`, which holds
 *   across the waiting↔busy flips a dialog causes, where the flip restarts on
 *   every answered permission.
 * - **waiting** and **idle** count from the flip, which is exactly what those
 *   two states mean. NOT the last activity: a resumed session is idle for
 *   seconds over a transcript last written days ago, and a menu pulled up
 *   writes `waiting` without a byte of transcript.
 */
export function stateSinceOf(live: LiveInfo | null | undefined): number | null {
  if (!live) return null;
  return live.status === LIVE_BUSY ? (live.busySince ?? flipOf(live)) : flipOf(live);
}
