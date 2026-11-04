import type { LiveInfo } from '@claude-history/shared';
import { flipOf, LIVE_BUSY } from '@claude-history/shared';

/**
 * The clock a session's STATE badge counts from (`Badges`), and the one the
 * live sections at the top of the list are ordered by (`buildRows`).
 *
 * - **working** counts from the turn's own start, `busySince`, which holds
 *   across the waiting↔busy flips a dialog causes.
 * - **waiting** and **idle** count from the last flip (`flipOf`), never from the
 *   last activity: a resumed session is idle for seconds over a transcript last
 *   written days ago, and a menu pulled up writes `waiting` without a byte of
 *   transcript. A flip is not always a change of state — see `flipOf`.
 */
export function stateSinceOf(live: LiveInfo | null | undefined): number | null {
  if (!live) return null;
  return live.status === LIVE_BUSY ? (live.busySince ?? flipOf(live)) : flipOf(live);
}
