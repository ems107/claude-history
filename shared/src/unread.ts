// What has arrived in a session since somebody read it, in the one unit both
// sides have to agree on.
//
// The server keeps the marks (`core/readMarks.ts`) and stamps one with the
// tally a session held at the moment it was read; the browser subtracts that
// from the tally the row is showing now. Two places, one function, or the count
// would be measured with one ruler and drawn with another.

import type { SessionSummary } from './types.ts';

/**
 * The unit, and the reason it is this one.
 *
 * Conversational messages: prompts the user typed plus distinct assistant
 * messages, which is as close as a summary gets to what the follow pill counts
 * inside a conversation (`turn.items`).
 *
 * NOT `summary.messageCount`, which is Claude Code's own `turn_duration` figure
 * and counts CONTEXT ENTRIES — tool results and streamed chunks — and is null
 * for a great many sessions besides (AI_TRANSCRIPTS.md says so where the field
 * is documented).
 *
 * **Null means "cannot say", and a null neither takes a mark nor counts against
 * one.** The enrichment is a background full parse, and a server that has just
 * started serves summaries out of its cache with `enrichment: null` until it
 * catches up — so a fallback to some other unit would read the enrichment
 * ARRIVING as four hundred messages landing at once.
 */
export function messageTally(s: SessionSummary): number | null {
  return s.enrichment ? s.enrichment.userMessageCount + s.enrichment.assistantMessageCount : null;
}

/**
 * What to draw on the row: a subtraction, never an accumulator.
 *
 * The mark stands still until the next reading, so nothing has to WATCH a
 * session for the figure to be right — one that grew by nine while the reader
 * was elsewhere says nine the moment its row is drawn again, with nobody having
 * observed the nine steps. A session nobody has read has no mark and therefore
 * no count, which is what keeps two thousand rows from lighting up with their
 * own history. A re-parse that shrinks a session reads 0 rather than a negative.
 */
export function unreadOf(s: SessionSummary, mark: number | undefined): number {
  if (mark === undefined) return 0;
  const tally = messageTally(s);
  if (tally === null) return 0;
  return Math.max(0, tally - mark);
}
