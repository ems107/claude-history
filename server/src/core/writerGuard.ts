/**
 * Who is writing a transcript, and what the app has alive right now.
 *
 * Two writers on one transcript is the corruption the parser has to undo
 * afterwards -- duplicated uuids, replayed segments -- so every door that can
 * start a `claude` against an existing session asks here first. There are three
 * of them now: the composer, the embedded terminal and "Resume in terminal".
 *
 * The guard is a registry rather than a field on either service because the
 * question is symmetric and the answer must not depend on which one is asking.
 * When only the composer existed it could keep its own pid set; with two, each
 * would have had to learn about the other, and the day one of them forgot, the
 * app would have blocked itself and blamed a terminal that does not exist.
 *
 * The same registry answers the second question this file grew for: not "who
 * holds THIS session" but "what is this app running at all". One slot cap is
 * shared between the doors, and six actions -- stop, restart, update, the two
 * chat settings, the cache and a userdata restore -- are refused while any slot
 * is filled. Both need the union across writers, and neither could have got it
 * from one service's memory.
 */

import type { ChatUiMode } from '@claude-history/shared';

/** One live `claude` of ours, as its writer sees it. */
export interface WriterSession {
  sessionId: string;
  /** A turn in flight right now. */
  busy: boolean;
  /** Local ISO-8601 with offset. */
  startedAt: string | null;
}

/** Something in THIS process that can be holding a session's transcript open. */
export interface TranscriptWriter {
  /**
   * What it is, in the words a refusal is written in: "the composer", "the
   * embedded terminal". Read straight into a sentence the user sees.
   */
  readonly what: string;
  /** Which door this is, for a UI that draws them differently. */
  readonly kind: ChatUiMode;
  /** Is a `claude` we spawned for this session alive right now? */
  holds(sessionId: string): boolean;
  /** Is this pid one of the ones we spawned? */
  ownsPid(pid: number): boolean;
  /**
   * Every session this writer has a LIVE CLI for. A terminal holding a dead
   * process's last screen is not one of them: it is a screen, not a writer, and
   * it costs nothing to keep.
   */
  activeSessions(): WriterSession[];
}

const writers = new Set<TranscriptWriter>();

/** Called once per service, at construction. */
export function registerWriter(writer: TranscriptWriter): void {
  writers.add(writer);
}

/**
 * Is this pid one of ours?
 *
 * The CLIs we spawn register themselves in `~/.claude/sessions/<pid>.json`
 * exactly like one started in a terminal, so without this the feature blocks
 * itself the moment it starts working.
 */
export function pidOwnedByApp(pid: number): boolean {
  for (const w of writers) if (w.ownsPid(pid)) return true;
  return false;
}

/**
 * Is some OTHER part of this app already running Claude in this session? Answers
 * with that part's name, or null.
 *
 * `except` is the caller, which must never find itself: a composer asking
 * whether it may send has to be allowed to see its own process.
 */
export function appHolderOf(sessionId: string, except?: TranscriptWriter): string | null {
  for (const w of writers) {
    if (w === except) continue;
    if (w.holds(sessionId)) return w.what;
  }
  return null;
}

/** One live CLI, with the writer that owns it named. */
export type ActiveWriterSession = WriterSession & { what: string; kind: ChatUiMode };

/**
 * Everything this app is running, across both doors, oldest first.
 *
 * Oldest first because that is the order somebody closing them works in, and
 * because the newest one is the likeliest to be the tab they are looking at.
 */
export function activeWriterSessions(): ActiveWriterSession[] {
  const out: ActiveWriterSession[] = [];
  for (const w of writers) {
    for (const s of w.activeSessions()) out.push({ ...s, what: w.what, kind: w.kind });
  }
  return out.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
}

/**
 * Would starting one for this session go over the cap?
 *
 * A session that is already running is never counted against itself -- asking
 * again about one we hold is not asking for a new slot -- and the tally is the
 * union of both doors, since the cap is one number for the machine.
 */
export function atActiveSessionLimit(sessionId: string, max: number): boolean {
  const ids = new Set(activeWriterSessions().map((s) => s.sessionId));
  return !ids.has(sessionId) && ids.size >= max;
}
