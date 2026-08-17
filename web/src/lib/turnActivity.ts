import type { Turn } from '@claude-history/shared';

/**
 * What has landed since the turn in flight began — the two clocks the working
 * indicator counts from beside the turn's own.
 *
 * Both are read off the LAST turn of the conversation, which is the one being
 * answered whenever the session is busy, and both are epoch milliseconds taken
 * from the transcript's own timestamps: the figure is exact even though it
 * appears a moment late, because the conversation is refetched on
 * `sessions-changed` and a re-parse takes what it takes.
 *
 * Pure, and checkable without a browser.
 */
export interface TurnActivity {
  /** The newest message of that turn (epoch ms), the prompt that opened it aside. */
  lastMessageAt: number | null;
  /**
   * The newest tool CALL of that turn (epoch ms) — when it was ISSUED, not when
   * it came back. That is the question worth answering while a turn hangs: a
   * `Bash` that has been running for four minutes says so here, where the
   * result's own clock would still be saying nothing at all.
   */
  lastToolAt: number | null;
}

export const NO_ACTIVITY: TurnActivity = { lastMessageAt: null, lastToolAt: null };

function stamp(when: string | null): number | null {
  if (!when) return null;
  const ms = Date.parse(when);
  return Number.isNaN(ms) ? null : ms;
}

export function turnActivity(turns: Turn[]): TurnActivity {
  const turn = turns[turns.length - 1];
  if (!turn) return NO_ACTIVITY;

  let lastMessageAt: number | null = null;
  let lastToolAt: number | null = null;

  for (let i = 0; i < turn.items.length; i++) {
    const item = turn.items[i];
    // The prompt that opened the turn is what the turn's own counter measures
    // FROM, so counting it would print the same number twice — and it is
    // written a beat after the turn is stamped busy, which is exactly the skew
    // that makes "since" too coarse a filter on its own. Only at index 0, so a
    // prompt typed mid-turn (`queued`, on the rail) still counts as news.
    if (i === 0 && item.role === 'user') continue;
    // A rewound-away branch is history, not this turn's progress.
    if (item.discardedBranch !== null) continue;
    const at = stamp(item.endTimestamp ?? item.timestamp);
    if (at === null) continue;
    if (lastMessageAt === null || at > lastMessageAt) lastMessageAt = at;
    // `endTimestamp` is the last CHUNK of the message, and a message's tool
    // calls are the last lines it writes (Claude writes and then calls: 0 of
    // 6,295 calls in this corpus land between two pieces of prose), so for a
    // message that called anything that stamp IS its last call.
    if (item.blocks.some((b) => b.kind === 'tool') && (lastToolAt === null || at > lastToolAt)) {
      lastToolAt = at;
    }
  }

  return { lastMessageAt, lastToolAt };
}
