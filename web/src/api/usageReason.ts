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
export interface UsageRead {
  trigger: UsageTrigger;
  /** Sessions Claude answered in — 'widget-activity' only. */
  ids?: string[];
}

/**
 * How long after a failure an unattributed read is taken to be its retry.
 * TanStack retries within a second or two; well outside that, an unlabelled
 * read is a genuinely unknown one and must be reported as such.
 */
const RETRY_WINDOW_MS = 10_000;

let pending: UsageRead | null = null;
let lastFailedAt = 0;

export function markUsageRead(trigger: UsageTrigger, ids?: string[]): void {
  pending = { trigger, ids };
}

/** Called when a read fails, so its retry is not filed as a cause of its own. */
export function markUsageReadFailed(): void {
  lastFailedAt = Date.now();
}

export function takeUsageRead(): UsageRead {
  if (pending) {
    const read = pending;
    pending = null;
    return read;
  }
  if (Date.now() - lastFailedAt < RETRY_WINDOW_MS) return { trigger: 'widget-retry' };
  return { trigger: 'widget' };
}
