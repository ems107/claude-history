import type { UsageTrigger } from '@claude-history/shared';

/**
 * The cause of the next usage read, handed to the request that follows.
 *
 * TanStack Query's `queryFn` is not told why it was called, and the reasons are
 * scattered across the code that triggers them (session activity in useEvents,
 * the reset timer and the idle poll in UsageWidget, a settings save). So each of
 * them says so here immediately before invalidating, and the request picks it up.
 *
 * Whoever triggers a read owns setting this; anything unattributed is reported
 * as plain 'widget' rather than inheriting somebody else's reason, because a log
 * that guesses is worse than one that admits it does not know.
 */
let pending: UsageTrigger | null = null;

export function markUsageRead(trigger: UsageTrigger): void {
  pending = trigger;
}

export function takeUsageReason(fallback: UsageTrigger): UsageTrigger {
  const reason = pending ?? fallback;
  pending = null;
  return reason;
}
