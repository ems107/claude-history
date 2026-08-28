import { EventEmitter } from 'node:events';
import { messageTally } from '@claude-history/shared';
import type { SessionIndex } from './index.ts';

/**
 * Which sessions have been READ, and how much of each — what the count on a
 * list row is measured against.
 *
 * ## Why this is here and not in the browser
 *
 * It was a module store in the page first, and that was wrong for one plain
 * reason: **a reload lost it**. The bell it is meant to sit beside does not
 * behave that way — `/api/notifications` is served from this process, so F5
 * redraws every row it holds — and two marks side by side on the same row, one
 * surviving a refresh and one not, is not a design, it is a bug with a
 * rationalisation. So this lives exactly where the bell lives: in memory, in the
 * server, for as long as the server runs.
 *
 * It is also the truer place. "I have read this session" is a fact about the
 * PERSON, not about a browser tab: reading it here and coming back to the list
 * in another window is the same act, and a phone on the far end of
 * [remote access](../../../docs/AI_REMOTE_ACCESS.md) is the same person too. The
 * one thing that stays per window is the FOCUS test that decides when a reading
 * has happened (`web/src/lib/windowFocus.ts`), which is a fact about a window
 * and is answered there.
 *
 * ## And why it is still not persisted
 *
 * The bell's own argument, one layer along: a restart empties both. A mark
 * written to disk would claim, after a machine came back tomorrow, to know what
 * somebody had read — while the only thing that ever made the claim true was
 * this process watching it happen. Emptying is the honest behaviour, and it
 * costs nothing anybody can name: every session simply reads as "nothing new"
 * until it is opened again.
 *
 * ## The unit lives in `shared`
 *
 * `messageTally` is written once and used twice — here, to stamp a mark, and in
 * the browser, to subtract it from what a row is showing. A count measured with
 * one ruler and drawn with another is off by whatever the two disagree about.
 */
export class ReadMarksService {
  readonly events = new EventEmitter();

  /** sessionId → the tally that session held when it was last read. */
  private readonly marks = new Map<string, number>();

  constructor(private readonly index: SessionIndex) {
    this.events.setMaxListeners(100); // one listener per SSE client
  }

  /**
   * "I have read this session."
   *
   * The tally is taken HERE rather than sent by the caller: a browser posting a
   * number is a browser that can post any number, and the index already holds
   * the summary this would be read off. A session with no enrichment yet takes
   * no mark at all — there is no honest figure to stamp, and inventing one is
   * the exact mistake `messageTally` returns null to prevent.
   *
   * Silent when nothing moves: the session view says this on every growth of the
   * conversation it is showing, and an event per line would have every open
   * window refetch for nothing.
   */
  read(sessionId: string): boolean {
    const summary = this.index.get(sessionId);
    if (!summary) return false;
    const tally = messageTally(summary);
    if (tally === null || this.marks.get(sessionId) === tally) return false;
    this.marks.set(sessionId, tally);
    this.changed();
    return true;
  }

  /**
   * Every mark, as the browser wants them: an object keyed by session id.
   *
   * Sessions the index no longer knows are dropped on the way out — a transcript
   * swept by `cleanupPeriodDays` leaves a number behind that can never be read
   * again, and this is the one place that notices.
   */
  list(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [sessionId, tally] of this.marks) {
      if (!this.index.get(sessionId)) {
        this.marks.delete(sessionId);
        continue;
      }
      out[sessionId] = tally;
    }
    return out;
  }

  private changed(): void {
    this.events.emit('read-marks-changed');
  }
}
