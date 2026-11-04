import type { LiveInfo } from './types.ts';

/**
 * When the CLI last stamped a status: `statusUpdatedAt`, with `updatedAt`
 * standing in for a CLI too old to write it. What re-stamps it is more than a
 * change of state (`LiveInfo.statusUpdatedAt`).
 *
 * Both sides read it, so it lives here: the server dates the bell's rows and
 * seeds a turn's start with it, and fingerprints it so a moved clock reaches
 * the list; the web draws the idle and waiting clocks with it and orders the
 * live sections by them.
 */
export function flipOf(live: Pick<LiveInfo, 'statusUpdatedAt' | 'updatedAt'> | null | undefined): number | null {
  return live?.statusUpdatedAt ?? live?.updatedAt ?? null;
}
