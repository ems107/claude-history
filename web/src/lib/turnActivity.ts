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
  /**
   * When that turn began (epoch ms): the FIRST item of it, whatever its role —
   * normally the prompt that opened it.
   *
   * A session does not use this and must not: its turn starts when
   * `~/.claude/sessions` says so, which is stamped at the instant it happens,
   * while the transcript's first line of a turn is written later. A SUBAGENT has
   * no such file — it shares its parent's process — and its first line is its
   * brief, so this is the only clock it has and it is the right one: an agent
   * begins when it is sent out.
   */
  startedAt: number | null;
  /**
   * When the model last SAID something in that turn (epoch ms) — the newest
   * assistant message carrying anything that is not a tool call.
   *
   * Tool calls are deliberately not messages here, and neither is a prompt: a
   * message that called something ends with the call, so counting it would make
   * this figure and `lastToolAt` the same number for as long as a run lasts, and
   * two clocks that always agree are one clock and a lie. What is left is the
   * one worth reading beside the tools — how long since the model last wrote.
   */
  lastMessageAt: number | null;
  /**
   * The newest tool CALL of that turn (epoch ms) — when it was ISSUED, not when
   * it came back. That is the question worth answering while a turn hangs: a
   * `Bash` that has been running for four minutes says so here, where the
   * result's own clock would still be saying nothing at all.
   */
  lastToolAt: number | null;
}

export const NO_ACTIVITY: TurnActivity = { startedAt: null, lastMessageAt: null, lastToolAt: null };

function stamp(when: string | null): number | null {
  if (!when) return null;
  const ms = Date.parse(when);
  return Number.isNaN(ms) ? null : ms;
}

export function turnActivity(turns: Turn[]): TurnActivity {
  const turn = turns[turns.length - 1];
  if (!turn) return NO_ACTIVITY;

  const startedAt = stamp(turn.items[0]?.timestamp ?? null);
  let lastMessageAt: number | null = null;
  let lastToolAt: number | null = null;

  for (const item of turn.items) {
    // Only the model's own output: the prompt that opened the turn is what the
    // turn's own counter measures FROM, and neither a queued prompt nor an
    // injected notice is Claude answering.
    if (item.role !== 'assistant') continue;
    // A rewound-away branch is history, not this turn's progress.
    if (item.discardedBranch !== null) continue;

    // The two stamps a merged message carries, and each answers a different
    // question. `endTimestamp` is its LAST line, which for a message that
    // called anything IS its last call — Claude writes and then calls, so the
    // tool_use lines close the message (0 of 6,295 calls in this corpus land
    // between two pieces of prose). `timestamp` is its FIRST line, which is
    // where the writing was: the thinking or the prose that came before the
    // call. That is why the message figure reads the start and the tool figure
    // the end — a per-block clock exists in the transcript and is dropped in
    // the merge, and this is what survives of it.
    const started = stamp(item.timestamp);
    const ended = stamp(item.endTimestamp ?? item.timestamp);
    const wrote = item.blocks.some((b) => b.kind !== 'tool');
    const called = item.blocks.some((b) => b.kind === 'tool');
    if (wrote && started !== null && (lastMessageAt === null || started > lastMessageAt)) lastMessageAt = started;
    if (called && ended !== null && (lastToolAt === null || ended > lastToolAt)) lastToolAt = ended;
  }

  return { startedAt, lastMessageAt, lastToolAt };
}
