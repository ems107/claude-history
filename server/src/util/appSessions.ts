import type { ActiveAppSession, ActiveSessionsRefusal, GuardedAction } from '@claude-history/shared';
import { activeSessionsRefusal } from '@claude-history/shared';
import type { AppContext } from '../context.ts';
import { activeWriterSessions } from '../core/writerGuard.ts';

/**
 * Is Claude in the middle of an answer this process is responsible for?
 *
 * The narrow question, and by now only one endpoint still asks it: uninstalling
 * is refused mid-answer and nothing more, because it already stops to ask a
 * question of its own that nobody clicks through by accident.
 *
 * The answer is the WORDS, not a boolean, so the refusal can name what is
 * working. "Wait for the prompt you sent from the app" is no help at all to
 * somebody looking at a terminal they opened themselves.
 */
export function busyWith(ctx: AppContext): string | null {
  if (ctx.chat.busy) return 'answering a prompt sent from the app';
  if (ctx.terminals.busy) return 'working in a terminal open in the app';
  return null;
}

/**
 * Every `claude` this app has alive, named the way a person can find it again.
 *
 * The writers know the ids; the index knows what they ARE. Everything here is
 * looked up rather than remembered, and a session the index has never seen — one
 * being born, with no transcript yet — keeps its folder instead, which is the
 * only name it has.
 */
export function activeAppSessions(ctx: AppContext): ActiveAppSession[] {
  return activeWriterSessions().map((s) => {
    const summary = ctx.index.get(s.sessionId);
    return {
      sessionId: s.sessionId,
      kind: s.kind,
      what: s.what,
      projectName: summary?.projectName ?? null,
      title: summary?.title ?? null,
      cwd: summary?.projectPath ?? ctx.chat.cwdOf(s.sessionId),
      busy: s.busy,
      startedAt: s.startedAt,
    };
  });
}

/**
 * The 409 body for an action that may not happen while the app is running
 * Claude, or null when nothing is running and it may go ahead.
 *
 * ONE helper for all six, because the six are one rule: a CLI of ours is a
 * writer on somebody's transcript with a warm prompt cache behind it, and
 * stopping the server, restarting it, updating, clearing the cache, restoring
 * userdata or switching how prompts are sent all destroy it from a page that is
 * not looking at it. The sentence comes from `shared` and the list comes from
 * here, so the dialog can name what to go and close rather than only refusing.
 *
 * An IDLE session counts. That is the whole change from the older guard, which
 * only refused while a turn was in flight: silence is not permission — it is a
 * session somebody left open, still holding its transcript.
 */
export function refuseWhileActive(ctx: AppContext, action: GuardedAction): ActiveSessionsRefusal | null {
  const sessions = activeAppSessions(ctx);
  if (sessions.length === 0) return null;
  return { error: activeSessionsRefusal(action, sessions.length), activeSessions: sessions };
}

/**
 * Close every one of them, in whichever door holds it. What the dialog's "close
 * them all" does, and the reason the refusal is not a dead end: the alternative
 * was walking the user through six sessions by hand to press a button they had
 * already decided to press.
 */
export async function closeActiveAppSessions(ctx: AppContext): Promise<void> {
  for (const s of activeAppSessions(ctx)) {
    if (s.kind === 'terminal') ctx.terminals.close(s.sessionId);
    else await ctx.chat.stop(s.sessionId);
  }
}
