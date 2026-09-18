import type { LiveInfo } from '@claude-history/shared';
import { LIVE_BUSY, LIVE_WAITING } from '@claude-history/shared';
import { useEffect, useState } from 'react';
import { elapsed, formatDateTime } from '../../lib/format.ts';
import { NO_ACTIVITY, type TurnActivity, turnClocks } from '../../lib/turnActivity.ts';

/**
 * What the row SAYS, for the reader who cannot see it turning. The spinner is
 * the whole visible statement now, and a spinner announces nothing at all — so
 * this is drawn `sr-only` and the live region has something to read out.
 *
 * Hidden from the eye and not from `textContent`, which is deliberate: the
 * status region still reads `Claude is working… total …` for the checks in
 * AI_TESTING, and the sentence that named this row for as long as it had one is
 * still the sentence.
 */
const WORKING = 'Claude is working…';

/**
 * Whether this session is mid-turn. Exported because the caller has to know
 * BEFORE rendering: the indicator hangs on the turn's rail, and a rail built
 * around a component that renders nothing is a stray green line down the page.
 *
 * Claude Code stamps `status` on ~/.claude/sessions/<pid>.json the moment a turn
 * starts and again when it ends. There is no heartbeat in between (measured:
 * `updatedAt` frozen for 3 minutes into a busy turn), so the transition is
 * written exactly when it happens and the watcher sees it within its 300 ms
 * debounce — this indicator is as immediate as the CLI's own spinner.
 *
 * **`LIVE_BUSY` is one of four values that field can hold**, and the other three
 * all mean stopped — see [AI_TRANSCRIPTS.md](../../../../docs/AI_TRANSCRIPTS.md).
 * `waiting` is the one worth naming here: a session with a dialog on screen has
 * a turn open and nothing moving in it, so this must stay false for it. Spinning
 * for a session blocked on a person would be the one lie this row could tell —
 * that state gets the row's own waiting mode instead (`waitingFor` below).
 */
export function isWorking(live: LiveInfo | null | undefined): boolean {
  return live?.status === LIVE_BUSY;
}

/**
 * The other live state with a turn open: a dialog is on screen — a permission,
 * a question, a plan — and nothing can move until the reader answers it.
 * `isWorking`'s counterpart so the two branches of the foot read as one
 * decision, and `LiveInfo.waitingFor` is the sentence that goes with it.
 */
export function isWaiting(live: LiveInfo | null | undefined): boolean {
  return live?.status === LIVE_WAITING;
}

/**
 * The waiting state written out, one wording for everything that says it — the
 * row below and the follow pill's hover. The badge's own tooltip already used
 * these words; the cause is the CLI's `waitingFor`, null for a dialog it has
 * no name for.
 */
export function waitingSentence(waitingFor: string | null): string {
  return `Waiting for you${waitingFor ? ` — ${waitingFor}` : ''}`;
}

/**
 * The clock a session's row is read against: when the status last changed,
 * which for a busy session is **when the user last put something into it** — a
 * prompt, an answer to a question, a permission granted. That is a turn's start
 * only for a turn nobody interrupted, which is why the row runs it through
 * `turnClocks` rather than drawing it as `total`.
 *
 * Beside `isWorking` because it is the other half of the same reading, and
 * because the indicator itself no longer knows what a `LiveInfo` is — a
 * subagent has none, and the row is the same row.
 */
export function workingSince(live: LiveInfo | null | undefined): number | null {
  return live?.statusUpdatedAt ?? live?.updatedAt ?? null;
}

/**
 * One elapsed figure. The clock it counts from is on the hover, because the
 * span alone cannot say WHEN — and the span is the thing worth reading at a
 * glance, so the absolute time may not take a character of the row.
 *
 * **The number is brighter than its caption**, and both are readable. Three
 * figures written in one flat grey were a single grey string the eye had to
 * parse word by word, and the whole row sat at `/70` of `--text-dim`. Now the
 * captions carry the full dim and the seconds — the only part that changes —
 * carry `--text`, so the row is scanned as three numbers with quiet labels
 * rather than read. Both readings improved when the bubble went: against the
 * page's own background the captions are 6.3:1 and the figures 13.8:1, where on
 * the assistant bubble they were 5.8 and 9.5.
 * Not `font-mono`: the tabular figures are already aligned, and mono spaced
 * "3 min 25 s" out into something wider and clumsier than the sans.
 */
function Figure({ label, at, hint }: { label?: string; at: number; hint: string }) {
  return (
    <span className="whitespace-nowrap" title={`${hint} ${formatDateTime(at)}`}>
      {label ? `${label} ` : ''}
      <span className="text-[var(--text)]/90">{elapsed(at)}</span>
    </span>
  );
}

/**
 * The turn in flight, at the foot of a live conversation: a spinner and its
 * clocks, floating under the last thing that landed.
 *
 * This is the closest an on-disk reader can get to the CLI's streaming answer,
 * and the gap is not ours to close: the transcript is written one CLOSED content
 * block per line (thinking, text, tool_use — each with its own timestamp), so
 * partial text never touches the disk at all. Between blocks the viewer has
 * nothing new to draw for a median of 4.5 s, and a long final answer lands whole
 * after ~20 s of silence. That silence is what this fills.
 *
 * **It is not a message, and no longer dressed as one.** It was a `Bubble` for a
 * while, which gave it a border, a fill and a TAIL — and a tail points at a
 * speaker. Nobody is speaking here: this is telemetry about a turn, it never
 * enters `turn.items`, nothing folds, counts or prices it, and there is nothing
 * in it to copy. Being a bubble also made it a marking box
 * (`data-bubble-body`), so a find for `total` or `last` painted marks over words
 * the transcript never held and the find bar could not step to — the same drift
 * `data-chrome` exists to stop, one component too late. A bare row has none of
 * that, and the bubbles are left saying the one thing they are for.
 *
 * It hangs BELOW TurnList's last turn rather than inside it, on that turn's own
 * rail, and being inside the followed content box the "To the end" pill keeps it
 * in view as the answer grows.
 *
 * Four clocks at most, and the three after the first are the ones that say
 * whether the silence is going anywhere: the turn's `total`, how long since the
 * USER last put something in (only on a turn that was interrupted), how long
 * since the model last WROTE (tool calls are not messages, or the two would be
 * the same number all through a run) and how long since the last tool was
 * called. Each appears only once it has something of its own to report — a turn
 * that has produced nothing yet shows one figure, which is the truth about it.
 *
 * **Whether anything is working at all is the CALLER's to answer**, and so is
 * the clock: a session reads both off `~/.claude/sessions` (`isWorking` /
 * `workingSince` / `isWaiting`), a subagent has no such file and reads its own
 * transcript instead. Rendered, this row always means "the turn is still open" —
 * still going, or blocked on the reader (`waitingFor`) — and every call site
 * already had to know which before drawing the rail it hangs on.
 */
export function WorkingIndicator({
  since,
  activity = NO_ACTIVITY,
  startHint = 'Turn started',
  news,
  waitingFor,
}: {
  /**
   * When the wait last started counting (epoch ms); null draws no clocks. For a
   * session that is the busy flip, which is when the USER last spoke rather than
   * when the turn began — `turnClocks` is what tells the two apart, and with no
   * `activity` to tell them apart with, this is `total` as it always was.
   */
  since: number | null;
  /**
   * What the turn in flight is made of — see `turnActivity`. Absent, `since` is
   * drawn as `total` and nothing else can be known about the turn.
   */
  activity?: TurnActivity;
  /** What the `total` figure's hover says it counts from. */
  startHint?: string;
  /**
   * A sentence worth DRAWING, for a wait the spinner cannot describe on its own.
   *
   * Passing one is what makes it visible, and that is the whole rule: the
   * ordinary case has nothing to add — a turning ring beside a running clock is
   * already "Claude is working", and the words spent a line of the reader's
   * eyeline repeating it for every second of every turn. What cannot be inferred
   * is a COUNT: a turn can END with agents still running (they are launched
   * asynchronously and the report is what wakes the session back up), and there
   * both halves are news — Claude is idle, and three things it sent out are not.
   *
   * Absent, `WORKING` is announced and nothing is drawn.
   */
  news?: string;
  /**
   * The row's WAITING mode: a dialog is on screen and the turn is blocked on
   * the reader. Its PRESENCE is the switch — the CLI writes `waitingFor` as
   * null for a dialog it has no name for, so `null` still means waiting and
   * only `undefined` means working. It changes three things at once: the
   * spinner rests into the amber pulse of the list's own badge (movement that
   * means "it wants you", not "it is going"), the sentence is drawn because
   * a resting dot cannot name a cause, and the activity clocks stand down —
   * with a dialog up, "last tool 3 s" counts nothing that can move — leaving
   * `total` and how long the dialog has been waiting.
   */
  waitingFor?: string | null;
}) {
  // The counter is re-rendered, not recomputed from a stored value: `elapsed`
  // reads the clock, so a tick a second is all it takes to keep it truthful.
  // Unconditional, because this row only exists while something is working.
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Where `total` counts from, and whether the turn was interrupted at all. The
   * whole rule lives in `turnClocks`, pure and beside the readings it weighs.
   *
   * The waiting mode reads only `total` out of it: there `since` is the moment
   * the DIALOG opened, not the reader's last word, so `input` — which turnClocks
   * derives from that same flip — would caption the dialog's own age as
   * "You answered". The flip still anchors `total` correctly, because a turn
   * blocked on a dialog is exactly the `unanswered` shape the adoption test
   * already covers.
   */
  const waiting = waitingFor !== undefined;
  const { total, input, inputTyped } = turnClocks(activity, since);

  /**
   * Only what landed AFTER the turn began. With no turn start there is nothing
   * to be "during" — a bare "last message 3 hr" would be the previous turn's
   * last word wearing this turn's clothes — so an unknown start hides both.
   *
   * Measured against the TURN and not against the last interruption, so that all
   * four figures belong to the same turn: gated on `input`, `last message` would
   * vanish the moment a question was answered, which is when it says the most —
   * "the last thing Claude wrote was the question" is the shape of that state.
   */
  const during = (at: number | null) => (at !== null && total !== null && at > total ? at : null);
  const messageAt = during(activity.lastMessageAt);
  const toolAt = during(activity.lastToolAt);

  // No margin of its own: it is spaced by whatever holds it — the turn's rail,
  // or the list itself when there is no turn to hang it on. It wraps rather than
  // overflows: a narrow column or a 150 % zoom must break the line instead of
  // pushing the seconds off the row.
  //
  // **`relative` is load-bearing**, and it is the one thing `Bubble` was giving
  // this row for free (a bubble is positioned for its tail). The sentence below
  // is `sr-only`, which means `position: absolute` — and with no positioned
  // ancestor inside the scroller its containing block became the conversation's
  // own wrapper, OUTSIDE it. From there the span is laid out at its flow
  // position PLUS the scroll offset, so at the foot of a long session it sat
  // 4,263 px down an 802 px window and the PAGE grew to hold it: a second
  // scrollbar into 3,462 px of empty screen, worse the further down you were.
  // Measured over CDP, where the same scan says nothing else in the scroller
  // escapes its way.
  return (
    <div
      role="status"
      className="relative flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5 text-[var(--text-dim)]"
    >
      {/* The ring the whole app turns — the follow pill, the update button,
          twice in Remote access — in the accent the three dots wore and in the
          pill's own 12 px box. It replaced a wave of dots that read as a chat's
          "someone is typing", which is exactly what this is not. Waiting, the
          ring rests into the amber pulse of the list badge, inside the same
          12 px slot so the row does not shift when the state flips. */}
      {waiting ? (
        <span aria-hidden="true" className="flex size-3 shrink-0 items-center justify-center">
          <span className="size-2 animate-pulse rounded-full bg-amber-400" />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="size-3 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
        />
      )}
      {/* Deliberately never "writing a response": `busy` covers the whole turn,
          tool calls included, and most of a turn is not prose being written.
          Claiming otherwise would be wrong for most of the time it shows.
          The waiting sentence is drawn by the `news` rule — a resting dot
          cannot name a cause — and plain amber, not the working shimmer: the
          shimmer's sweep says "going", which is the one thing this is not. */}
      {waiting ? (
        <span className="text-sm text-amber-300/90">{waitingSentence(waitingFor ?? null)}</span>
      ) : news ? (
        <span className="working-label text-sm">{news}</span>
      ) : (
        <span className="sr-only">{WORKING}</span>
      )}
      {total !== null && (
        // Out of the announced text: a screen reader repeating the seconds
        // every second would drown the one thing worth saying.
        //
        // Right where the spinner leaves off, and no longer anchored to the far
        // side of a bubble that no longer exists. That anchor bought one thing —
        // `total` growing from "59 s" to "1 min 0 s" pushed leftwards, so the
        // figure being watched never shifted under the eye — and it cost the row
        // an empty half and a `max()` against the follow pill's corner that
        // every call site had to know about. Held here, the width jump lands
        // once a minute on figures that are already `tabular-nums`, and the
        // pill's corner is nowhere near a row that starts at the left margin.
        <span aria-hidden="true" className="tabular-nums text-xs">
          {/* Labelled like the two beside it: bare, it was the only figure
              and could only be the turn, but next to "last message" a naked
              number is one of three and says nothing about which. */}
          <Figure label="total" at={total} hint={startHint} />
          {/* Waiting, the activity clocks stand down: with a dialog on screen
              nothing they count can move, and the one figure worth their place
              is how long the dialog has been standing there. */}
          {waiting && since !== null && (
            <>
              {' · '}
              <Figure label="waiting" at={since} hint="Waiting since" />
            </>
          )}
          {/* No figure can appear without the turn's own (all three are gated
              on a known start), so a separator never opens the row. Inline
              text with `nowrap` on each figure: the line breaks at a dot and
              never inside "1 min 4 s". */}
          {!waiting && input !== null && (
            <>
              {' · '}
              {/* Second because it re-anchors the reading of the two after
                  it: a `last message` older than `total`'s own start reads
                  as a hang until this says the turn was waiting on YOU.
                  The hover names the act, because the two stamps behind this
                  one figure are not the same thing: a queued prompt is timed
                  from when it was TYPED (nothing records the delivery), an
                  answer from the moment it woke the session back up. */}
              <Figure label="last input" at={input} hint={inputTyped ? 'You typed this' : 'You answered'} />
            </>
          )}
          {!waiting && messageAt !== null && (
            <>
              {' · '}
              <Figure label="last message" at={messageAt} hint="Last message landed" />
            </>
          )}
          {!waiting && toolAt !== null && (
            <>
              {' · '}
              <Figure label="last tool" at={toolAt} hint="Last tool called" />
            </>
          )}
        </span>
      )}
    </div>
  );
}
