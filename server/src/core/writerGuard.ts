/**
 * Who is writing a transcript.
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
 */

/** Something in THIS process that can be holding a session's transcript open. */
export interface TranscriptWriter {
  /**
   * What it is, in the words a refusal is written in: "the composer", "the
   * embedded terminal". Read straight into a sentence the user sees.
   */
  readonly what: string;
  /** Is a `claude` we spawned for this session alive right now? */
  holds(sessionId: string): boolean;
  /** Is this pid one of the ones we spawned? */
  ownsPid(pid: number): boolean;
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
