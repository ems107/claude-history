import { RECAP_SUBTYPE, type MessageItem, type Turn } from '@claude-history/shared';

/**
 * What the turn in flight is made of — the readings the working indicator's
 * clocks are drawn from, and the evidence that says the turn is still the one
 * being answered.
 *
 * All of it is read off the LAST turn of the conversation, which is the one
 * being answered whenever the session is busy, and every stamp is epoch
 * milliseconds taken from the transcript's own timestamps: the figure is exact
 * even though it appears a moment late, because the conversation is refetched on
 * `sessions-changed` and a re-parse takes what it takes.
 *
 * Pure, and checkable without a browser.
 */
export interface TurnActivity {
  /**
   * When that turn began (epoch ms): the FIRST item of it, whatever its role —
   * normally the prompt that opened it.
   *
   * **This is what `total` counts from once the turn is known to be the one in
   * flight** (`turnClocks`), and the reason is the whole point of that function:
   * a turn is not over because the user interrupted it. A prompt typed mid-turn
   * is delivered INTO this turn, and an `AskUserQuestion` answer is not even an
   * item — both land inside these very `items`, so the transcript's own boundary
   * already ignores exactly what the busy flip does not.
   *
   * A SUBAGENT has only this: it shares its parent's process, so there is no
   * `~/.claude/sessions` file to read a start off, and its first line is its
   * brief. An agent begins when it is sent out.
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
  /**
   * The newest line Claude wrote in that turn (epoch ms), whatever it carried —
   * the two figures above merged, and never drawn. It answers one question and
   * only one: has this turn been written into since the session went busy? If it
   * has, the busy flip belongs to THIS turn and not to a prompt whose first line
   * has yet to reach the disk (`turnClocks`).
   */
  lastWriteAt: number | null;
  /**
   * The newest prompt typed while the turn ran (`MessageItem.queued`), as its
   * own stamp — **when it was TYPED, not when it was delivered**, which is the
   * only clock the transcript keeps for it (39 s apart in `15a86025`).
   *
   * It has to be read here because the busy flip cannot stand in for it: a queued
   * prompt does not wake a session that never stopped. Claude Code holds it and
   * hands it over when the turn's current stretch of work ends, with `status`
   * `busy` throughout — verified on `06b1f9ec`, where `statusUpdatedAt` still
   * named the turn's own start after one had been delivered and answered. So the
   * flip knows about an answered question and knows nothing about this.
   */
  lastQueuedAt: number | null;
  /**
   * The turn's LAST item is something Claude has yet to answer, so the turn
   * cannot be over whatever the status file says. Three shapes, the first two
   * being the two ways a user interrupts a turn:
   *
   *  - a prompt typed while the turn ran (`MessageItem.queued`). Claude Code
   *    delivers one into the turn already open rather than into a turn of its
   *    own, and the line is appended AT DELIVERY — verified: `15a86025`'s was
   *    typed at 13:44:06 and sits after an item that ended at 13:44:43 — so
   *    being the last item is exactly the window between delivery and Claude's
   *    first word. (Its `timestamp` is when it was typed, so it is a signal and
   *    never a clock.)
   *  - an assistant message ending on `AskUserQuestion` or `ExitPlanMode`: the
   *    calls whose answer comes from a human, and the reason this reads the NAME
   *    rather than a missing result. The `tool_result` is written the instant
   *    the question is answered, so gating on a missing result would put the
   *    signal out one re-parse after it was needed — the very second the answer
   *    starts being counted, with Claude still 5-20 s from writing anything.
   *  - an assistant message ending on any other call that has NO result yet: a
   *    permission prompt on screen, or a tool still running.
   *
   * **A call that already came back is not this**, and that is the whole reason
   * the asking ones are named rather than the rule being "ends on a call": a
   * turn ends on a returned call all the time, because a `<task-notification>`
   * that arrives with the turn already closed opens one of its own right after
   * it — 4 of the 44 turns in `15a86025` + `b343d4ac`, on `ScheduleWakeup`,
   * `Bash`, `AskUserQuestion` and `ExitPlanMode`. Calling those unfinished would
   * lend a finished turn's start to whatever opens the next one. (A notification
   * that landed MID-turn joins the turn instead and cuts nothing, so it never
   * produced one of these — see `notice.queued`.)
   */
  unanswered: boolean;
}

export const NO_ACTIVITY: TurnActivity = {
  startedAt: null,
  lastMessageAt: null,
  lastToolAt: null,
  lastWriteAt: null,
  lastQueuedAt: null,
  unanswered: false,
};

/** The calls whose result is a human, and the only ones named anywhere here. */
const ASKS_THE_USER = new Set(['AskUserQuestion', 'ExitPlanMode']);

function stamp(when: string | null): number | null {
  if (!when) return null;
  const ms = Date.parse(when);
  return Number.isNaN(ms) ? null : ms;
}

/** `TurnActivity.unanswered`, read off the turn's last surviving item. */
function unansweredAt(items: MessageItem[]): boolean {
  const kept = items.filter((i) => i.discardedBranch === null);
  const last = kept[kept.length - 1];
  if (!last) return false;
  if (last.queued) return true;
  if (last.role !== 'assistant') return false;
  const block = last.blocks[last.blocks.length - 1];
  if (block?.kind !== 'tool') return false;
  return ASKS_THE_USER.has(block.toolName) || block.result === null;
}

export function turnActivity(turns: Turn[]): TurnActivity {
  const turn = turns[turns.length - 1];
  if (!turn) return NO_ACTIVITY;

  const startedAt = stamp(turn.items[0]?.timestamp ?? null);
  let lastMessageAt: number | null = null;
  let lastToolAt: number | null = null;
  let lastWriteAt: number | null = null;
  let lastQueuedAt: number | null = null;

  for (const item of turn.items) {
    // A rewound-away branch is history, not this turn's progress.
    if (item.discardedBranch !== null) continue;
    // Only the model's own output: the prompt that opened the turn is what the
    // turn's own counter measures FROM, and neither a queued prompt nor an
    // injected notice is Claude answering. One of them is still a clock, just
    // not one of Claude's — it is the reader's own last word.
    if (item.role !== 'assistant') {
      const typed = item.queued ? stamp(item.timestamp) : null;
      if (typed !== null && (lastQueuedAt === null || typed > lastQueuedAt)) lastQueuedAt = typed;
      continue;
    }

    // The two stamps a merged message carries, and each answers a different
    // question. `endTimestamp` is its LAST line, which for a message that
    // called anything IS its last call — Claude writes and then calls, so the
    // tool_use lines close the message (0 of 6,295 calls in this corpus land
    // between two pieces of prose). `timestamp` is its FIRST line, which is
    // where the writing was: the thinking or the prose that came before the
    // call. That is why the message figure reads the start and the tool figure
    // the end. (Each tool block now keeps its own line's clock too —
    // `block.timestamp`, what ToolBlock's pill reads — but for these two
    // figures the message's own ends already say the same thing.)
    const started = stamp(item.timestamp);
    const ended = stamp(item.endTimestamp ?? item.timestamp);
    const wrote = item.blocks.some((b) => b.kind !== 'tool');
    const called = item.blocks.some((b) => b.kind === 'tool');
    if (wrote && started !== null && (lastMessageAt === null || started > lastMessageAt)) lastMessageAt = started;
    if (called && ended !== null && (lastToolAt === null || ended > lastToolAt)) lastToolAt = ended;
    // Not `lastToolAt`, which is the same stamp read for a different reason: a
    // message with no call at all still proves the turn was written into.
    if (ended !== null && (lastWriteAt === null || ended > lastWriteAt)) lastWriteAt = ended;
  }

  return { startedAt, lastMessageAt, lastToolAt, lastWriteAt, lastQueuedAt, unanswered: unansweredAt(turn.items) };
}

/** When a finished turn ran: prompt in to last thing that landed, epoch ms. */
export interface TurnSpan {
  start: number;
  end: number;
}

/**
 * The whole turn as the transcript records it: from its first kept item —
 * normally the prompt — to the newest stamp anything in it carries, a recap
 * excepted.
 *
 * **The same boundary `total` counts from live** (`turnClocks`), interruptions
 * held inside the turn and rewound-away items left out, so the figure the fold
 * strip settles on is the one the working row was showing when the turn ended.
 * Deliberately NOT the CLI's own `turn_duration.durationMs`, which the parser
 * drops. Measured against it over the whole corpus (751 lines): on a turn with
 * no human wait inside, the two agree within ms (p50 58 ms) — and every real
 * disagreement is a wait or a boundary, not an error. A permission dialog (the
 * gap between a call and its result), a question, a queued prompt make this
 * span LONGER by exactly the wait, which is the point: the figure is wall
 * time, prompt in to answer out, the same reading the live `total` gives —
 * where `durationMs` excludes what the turn spent blocked on a person. And the
 * line is missing exactly where a fallback would be needed anyway: interrupted
 * turns get none, CLIs ≤ 2.1.202 write none at all.
 *
 * The end reads tool RESULTS as well as message ends: a `<task-notification>`
 * arriving with the turn already closed opens one of its own right after a
 * returned call, whose result stamp is then the newest clock that turn has.
 *
 * **A recap is the one thing left out, and it is left out whole.** Claude Code
 * writes the `away_summary` line minutes AFTER the turn it summarises, for
 * whoever comes back to it, and the parser has no turn of its own to give it
 * ([AI_TRANSCRIPTS.md](../../../docs/AI_TRANSCRIPTS.md)) — so its stamp is
 * normally the newest one the turn carries and what it measures is the reader's
 * absence: a turn nobody came back to until morning read as a turn that took all
 * night. It closed 258 of this corpus's 1,235 turns (20.9 %), adding a median
 * 3 min and once 16 hr, and it was the whole of the disagreement with
 * `durationMs` the paragraph above says cannot happen — on `fa64ae58`'s four
 * recap turns the span now lands within 14-63 ms of the CLI's own figure, where
 * it used to overshoot by 3 min, 3 min, 43 min and 3 min. Left out of the START
 * as well as the end, so a turn that opens on one cannot take its beginning from
 * it, and a turn that is nothing but one has nothing to measure.
 *
 * Null for a turn with nothing to measure — a dangling prompt, a turn Claude
 * never answered. Pure, and checkable without a browser.
 */
export function turnSpan(turn: Turn): TurnSpan | null {
  let start: number | null = null;
  let end: number | null = null;
  for (const item of turn.items) {
    if (item.discardedBranch !== null) continue;
    // The one line written after the turn, about the turn: see above.
    if (item.systemSubtype === RECAP_SUBTYPE) continue;
    if (start === null) start = stamp(item.timestamp);
    const ended = stamp(item.endTimestamp ?? item.timestamp);
    if (ended !== null && (end === null || ended > end)) end = ended;
    for (const block of item.blocks) {
      if (block.kind !== 'tool') continue;
      const returned = stamp(block.result?.timestamp ?? null);
      if (returned !== null && (end === null || returned > end)) end = returned;
    }
  }
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/**
 * How far from the turn's own start a stamp has to be before it is somebody
 * interrupting rather than somebody starting. Below it the two figures are one
 * instant written twice: the flip IS the start on every ordinary turn, and a
 * prompt typed in the first seconds of one is part of asking, not an
 * interjection. It is not a tolerance on a pause — the shortest a human can
 * cause is seconds — it is the gap the app's own composer opens by stamping
 * `turnStartedAt` on the click, a few hundred milliseconds before the prompt's
 * first line reaches the disk.
 */
const INTERJECTION_MS = 5_000;

/** Where the indicator's first two figures count from. */
export interface TurnClocks {
  /** `total`: the whole turn, or the busy flip while that cannot be proved. */
  total: number | null;
  /** `last input`: the user's last word in this turn, or null for a turn nobody interrupted. */
  input: number | null;
  /**
   * Which of the two things `input` is, because they are not the same act and
   * the hover says so: a prompt typed over a turn still running, or an answer
   * that woke a session waiting on one.
   */
  inputTyped: boolean;
}

/**
 * The turn's own clock, and the one that says when the user last put something
 * into it.
 *
 * **A session goes busy when the user gives it something back** — the prompt
 * that opened the turn, an answer to a question, a permission granted. So
 * `since` is not "the turn started": it is "the user last unblocked it", and
 * reading it as the former is what restarted `total` from 0 every time a turn
 * was interrupted, on a turn the transcript never split.
 *
 * So `total` counts from the transcript's own boundary — which already holds the
 * interruptions inside the turn — and `since` becomes the figure it always was:
 * `last input`, drawn only when it has something of its own to say.
 *
 * **The flip is only half of the reader's last word, and the transcript holds
 * the other half.** A prompt typed while Claude works never wakes anything: the
 * session was never asleep, `status` stays `busy` across the delivery, and the
 * flip goes on naming the turn's own start (measured on `06b1f9ec`). So the
 * queued prompt's own stamp is the only record of it, and `last input` takes
 * whichever of the two is the more recent — with `inputTyped` saying which, since
 * a stamp that means "when you typed it" and one that means "when you answered"
 * cannot share a hover.
 *
 * **The one thing the transcript cannot do is answer immediately.** Between a
 * prompt and its first line reaching disk the last turn on record is still the
 * PREVIOUS one, and anchoring there would read `total 3 hr` for a second at the
 * start of every turn. So the turn is adopted only once it is demonstrably the
 * one in flight, by either of two signs: something in it was written at or after
 * the flip, or its last item is one Claude has yet to answer. Until then the
 * flip is all there is, and it is right.
 *
 * The second sign is what covers the seconds an answer is being counted while
 * Claude has still written nothing, and it is also the one that can be wrong: a
 * turn that really ended while looking unanswered lends its start to whatever
 * opens the next one, for as long as the watcher takes to catch up. Measured
 * over the 30 most recent sessions of this project, that is 2 of 94 ended turns
 * (2.1 %) — both a turn cut by a `<task-notification>` right after a question
 * was answered — and it costs a second of an inflated `total`, against a `total`
 * stuck at 0 for the 5-20 s Claude takes to write its first block after every
 * question, which is the case this exists for.
 */
export function turnClocks(activity: TurnActivity, since: number | null): TurnClocks {
  const flip = { total: since, input: null, inputTyped: false };
  const { startedAt, lastQueuedAt } = activity;
  if (since === null || startedAt === null) return flip;
  const inFlight = (activity.lastWriteAt !== null && activity.lastWriteAt >= since) || activity.unanswered;
  if (!inFlight) return flip;

  // The earlier of the two, which is the flip only where the composer stamped it
  // on the click, a moment before the prompt's first line reached the disk.
  const total = Math.min(startedAt, since);
  // Under the floor the two figures would be one number written twice: on an
  // ordinary turn the flip IS the start, and a prompt typed in the first seconds
  // of one is not an interruption anybody needs a clock for.
  const answered = since - total >= INTERJECTION_MS ? since : null;
  const typed = lastQueuedAt !== null && lastQueuedAt - total >= INTERJECTION_MS ? lastQueuedAt : null;
  if (answered === null && typed === null) return { total, input: null, inputTyped: false };
  return {
    total,
    input: Math.max(answered ?? 0, typed ?? 0),
    inputTyped: (typed ?? 0) >= (answered ?? 0),
  };
}
