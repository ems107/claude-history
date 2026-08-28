// What has arrived in a session since the last time somebody read it.
//
// The list already says what a session is DOING — live, working, waiting, idle,
// each with its clock. This is the other question, and the two are not the same
// one: a session that has been idle for half an hour may hold twenty messages
// nobody has ever read, and the row drew it exactly like the one opened a minute
// ago. Inside a conversation that question is already answered — the follow
// pill counts what lands while the reader is not at the end
// (`viewer/FollowBottom.tsx`) — so this is that answer brought out to the list.
//
// ## Nothing here is persisted, and that is the design
//
// No `localStorage`, no `userdata.json`, no server. The same reasoning the bell
// is built on (`server/src/core/notifications.ts`, and the "Where state lives"
// table in AI_ARCHITECTURE.md): "what has arrived since you read it" is a
// TRANSITION this page watched happen, and a reload loses the watching along
// with it. A mark that outlived the page would go on claiming somebody had read
// a session at a moment nothing was there to see it.
//
// It is also per tab, like the focus it is written by (`lib/windowFocus.ts`
// argues why "seen" is not gossiped between tabs), and it is the shape the other
// stores in here use: a module variable, a set of listeners, and
// `useSyncExternalStore`.

import type { SessionSummary } from '@claude-history/shared';
import { useSyncExternalStore } from 'react';

/** sessionId → the tally the session held when it was last read. */
const readAt = new Map<string, number>();
const listeners = new Set<() => void>();

/**
 * The unit, and the reason it is this one.
 *
 * Conversational messages: prompts the user typed plus distinct assistant
 * messages, which is as close as a list row can get to what the follow pill
 * counts (`turn.items` — see AI_VIEWER.md, the end of the conversation).
 *
 * NOT `summary.messageCount`, which is Claude Code's own `turn_duration` figure
 * and counts CONTEXT ENTRIES — tool results and streamed chunks — and is null
 * for a great many sessions besides (AI_TRANSCRIPTS.md says so where the field
 * is documented).
 *
 * **Null means "cannot say", and a null neither seeds a mark nor counts against
 * one.** The enrichment is a background full parse, and a server that has just
 * started serves summaries out of its cache with `enrichment: null` until it
 * catches up — so a fallback to some other unit would read the enrichment
 * ARRIVING as four hundred messages landing at once.
 */
export function messageTally(s: SessionSummary): number | null {
  return s.enrichment ? s.enrichment.userMessageCount + s.enrichment.assistantMessageCount : null;
}

/**
 * "I have read this session, and it held this much."
 *
 * A no-op when the tally cannot be told, and silent when nothing moves: the
 * viewer calls this on every growth of the conversation it is showing, and a
 * notify per line would redraw every subscriber for nothing.
 */
export function markRead(id: string, tally: number | null): void {
  if (tally === null || readAt.get(id) === tally) return;
  readAt.set(id, tally);
  for (const fn of listeners) fn();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The mark this tab holds for a session, or null if it has never read it.
 *
 * A session nobody has opened has no mark and therefore no count — which is the
 * whole reason the baseline is a reading rather than a first sight. Seeding
 * every session the list has ever shown would light up two thousand rows with
 * their own history, and "unread" would mean "exists".
 */
export function useReadMark(id: string): number | null {
  return useSyncExternalStore(
    subscribe,
    () => readAt.get(id) ?? null,
    () => null,
  );
}

/**
 * What to draw on the row: a subtraction, never an accumulator.
 *
 * The baseline stands still until the next reading, so nothing has to WATCH the
 * list to keep the figure honest — a session that grew by nine while the reader
 * was inside another one says nine the moment the list comes back, with nobody
 * having observed the nine steps. A re-parse that shrinks a session reads 0
 * rather than a negative.
 */
export function unreadOf(s: SessionSummary, mark: number | null): number {
  if (mark === null) return 0;
  const tally = messageTally(s);
  if (tally === null) return 0;
  return Math.max(0, tally - mark);
}
