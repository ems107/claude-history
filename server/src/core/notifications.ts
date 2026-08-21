import { EventEmitter } from 'node:events';
import type {
  ChatState,
  LiveSessionEntry,
  StopKind,
  StoppedSession,
  StoppedSessionEntry,
} from '@claude-history/shared';
import { LIVE_BUSY, LIVE_STOPPED, LIVE_WAITING } from '@claude-history/shared';
import type { SessionIndex } from './index.ts';
import { createLogger } from './logger.ts';
import type { SessionChatService } from './sessionChat.ts';

const log = createLogger('notifications');

/**
 * Far above any real number — the bell is bounded by how many sessions one
 * person runs, and rows are withdrawn about as fast as they are raised. It is
 * here so a bug cannot grow a map without limit, not to trim anything anyone
 * would miss.
 */
const MAX = 100;

/** The `ChatState`s that mean the composer's process is mid-something. */
const CHAT_RUNNING: readonly ChatState[] = ['starting', 'working', 'asking'];

/**
 * The sessions that have STOPPED, and why — what the bell in the header counts.
 *
 * ## A stop is a transition, and nothing on disk records one
 *
 * `idle` is the resting state of every open session: a terminal nobody has
 * touched all day is `idle`. So "the stopped sessions" read off `/api/live` is
 * only "every terminal you have open", which is worth nothing. What is worth
 * something is a session seen to LEAVE `busy` — and no file, watcher or event
 * carries that. `live-changed` fires on every write under `~/.claude/sessions`
 * and its `ids` are the membership difference, deliberately so: a busy/idle flip
 * changes nobody's `blockedReason`, so it carries no ids at all.
 *
 * The memory therefore lives here. This service keeps the previous status of
 * every session it has seen and derives the transitions itself — which is also
 * why it leaves `live-changed` alone: that event goes on meaning what it has
 * always meant, and this re-reads the whole list on each one (a handful of
 * entries, and a map lookup each).
 *
 * **First sight is remembered, never announced.** A session already stopped when
 * this process started produces nothing, and neither does a session being born
 * (measured: the pid file appears with no `status` at all, then `idle` half a
 * second later, then `busy`). Only `busy`/`waiting` to a resting status counts,
 * which also rules out the dialogs the USER opens on an idle session: a `/model`
 * picker writes `waiting` too, and nobody needs telling about a menu they just
 * pulled up themselves.
 *
 * A restart therefore empties the bell. That is the price of "only what stopped
 * while I was watching", and it is why none of this is persisted — the
 * transitions that produced a row are gone too, so a saved row would outlive its
 * own evidence.
 *
 * ## Two sources, because a `--print` run has no status
 *
 * A CLI in a terminal — and the one inside an embedded terminal, which is a real
 * interactive `claude.exe` — writes `status`, and is read from the file. The
 * composer's own processes write none (see `util/chatLive.ts`), and are read
 * from `ChatState` instead, where `asking` and `idle` say the same two things.
 * Nothing is counted twice: a session has one or the other, never both.
 *
 * ## One row per session
 *
 * A later stop replaces an earlier one rather than stacking, so the panel is a
 * list of sessions and not a history. Four things withdraw a row: visiting the
 * session, dismissing it, the session going `busy` again, and — for a CLI — the
 * process exiting, because the bell is about sessions that are OPEN and have
 * stopped. A composer row survives its process exiting: a `--print` run ending
 * is not the session closing.
 */
export class NotificationsService {
  readonly events = new EventEmitter();

  /** The previous status of every live session — the memory no event carries. */
  private readonly lastLive = new Map<string, string>();
  /** The same, for the composer's processes. */
  private readonly lastChat = new Map<string, ChatState>();
  /** One row per session, the newest stop winning. */
  private readonly stopped = new Map<string, StoppedSession>();

  constructor(
    private readonly index: SessionIndex,
    private readonly chat: SessionChatService,
  ) {}

  start(): void {
    this.events.setMaxListeners(100); // one listener per SSE client
    // Seed from what is already running, so the first flip we see is a
    // transition rather than a first sight. Without it every session open at
    // startup would announce its next stop as though we had watched it happen —
    // which we had not, and watching is the whole claim this makes.
    for (const l of this.index.liveSessions) this.lastLive.set(l.sessionId, l.status);
    this.index.events.on('live-changed', () => this.observeLive());
    this.chat.events.on('chat-changed', (sessionId: string) => this.observeChat(sessionId));
  }

  /** Newest stop first. */
  list(): StoppedSessionEntry[] {
    const open = new Set(this.index.liveSessions.map((l) => l.sessionId));
    return [...this.stopped.values()]
      .sort((a, b) => b.at - a.at)
      .map((stop) => {
        const summary = this.index.get(stop.sessionId);
        return {
          ...stop,
          title: summary?.title ?? null,
          projectName: summary?.projectName ?? null,
          projectKey: summary?.projectKey ?? null,
          cwd: summary?.projectPath ?? null,
          stillOpen: open.has(stop.sessionId),
        };
      });
  }

  /** One row — the panel's ✕, and the viewer opening a session that had one. */
  dismiss(sessionId: string): boolean {
    if (!this.stopped.delete(sessionId)) return false;
    this.changed();
    return true;
  }

  /** "Clear all". Answers with how many went. */
  clear(): number {
    const n = this.stopped.size;
    if (n === 0) return 0;
    this.stopped.clear();
    this.changed();
    return n;
  }

  // ---- internals ----

  private observeLive(): void {
    const seen = new Set<string>();
    let changed = false;
    for (const l of this.index.liveSessions) {
      seen.add(l.sessionId);
      const before = this.lastLive.get(l.sessionId);
      this.lastLive.set(l.sessionId, l.status);
      if (before !== undefined && before !== l.status) changed = this.liveFlip(l, before) || changed;
    }
    for (const sessionId of [...this.lastLive.keys()]) {
      if (seen.has(sessionId)) continue;
      this.lastLive.delete(sessionId);
      // The CLI is gone, so the session is no longer open — but only its OWN row
      // goes. A composer row for the same session was raised by the other half
      // and does not answer to this one.
      if (this.stopped.get(sessionId)?.source === 'cli') {
        this.stopped.delete(sessionId);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  private liveFlip(l: LiveSessionEntry, before: string): boolean {
    if (l.status === LIVE_BUSY) return this.stopped.delete(l.sessionId);
    // Only a session that was RUNNING can have stopped. Everything else
    // reaching a resting status got there without doing any work: a session
    // being born, a shell opening over an idle one, a menu somebody pulled up.
    if (before !== LIVE_BUSY && before !== LIVE_WAITING) return false;
    const kind = stopKind(l.status);
    if (kind === null) return false;
    return this.raise({
      sessionId: l.sessionId,
      kind,
      waitingFor: kind === 'needs-you' ? l.waitingFor : null,
      // The instant the CLI stamped the flip, not the instant we noticed: the
      // watcher's debounce and this read both come after the fact.
      at: l.statusUpdatedAt ?? Date.now(),
      source: 'cli',
    });
  }

  private observeChat(sessionId: string): void {
    const status = this.chat.status(sessionId);
    const before = this.lastChat.get(sessionId);
    this.lastChat.set(sessionId, status.state);
    if (before === undefined || before === status.state) return;
    if (status.state === 'starting' || status.state === 'working') {
      if (this.stopped.delete(sessionId)) this.changed();
      return;
    }
    if (!CHAT_RUNNING.includes(before)) return;
    // `error` is a stop like any other: the turn is over, and what is at the
    // other end of the row is the message saying why. Not `needs-you`, which is
    // kept for something genuinely waiting to be answered.
    const raised =
      status.state === 'asking'
        ? this.raise({
            sessionId,
            kind: 'needs-you',
            waitingFor: askingFor(status.question?.toolName),
            at: Date.now(),
            source: 'app',
          })
        : this.raise({ sessionId, kind: 'finished', waitingFor: null, at: Date.now(), source: 'app' });
    if (raised) this.changed();
  }

  private raise(stop: StoppedSession): boolean {
    this.stopped.delete(stop.sessionId); // re-inserted, so the map stays in stop order
    this.stopped.set(stop.sessionId, stop);
    if (this.stopped.size > MAX) {
      const oldest = [...this.stopped.values()].sort((a, b) => a.at - b.at)[0];
      if (oldest) this.stopped.delete(oldest.sessionId);
    }
    log.info(`${stop.sessionId} stopped: ${stop.kind}${stop.waitingFor ? ` (${stop.waitingFor})` : ''}`);
    return true;
  }

  private changed(): void {
    this.events.emit('notifications-changed');
  }
}

/** Which of the two reasons a resting status is, or null when it is neither. */
function stopKind(status: string): StopKind | null {
  if (status === LIVE_WAITING) return 'needs-you';
  if (LIVE_STOPPED.includes(status)) return 'finished';
  // `unknown` — a `--print` run of ours, which the composer half answers for —
  // and anything a later CLI adds that we have not been taught to read.
  return null;
}

/**
 * The composer's answer to `waitingFor`, in the CLI's own vocabulary so a row
 * reads the same whichever half raised it.
 */
function askingFor(toolName: string | undefined): string {
  if (toolName === 'ExitPlanMode') return 'plan approval';
  if (toolName === 'AskUserQuestion') return 'input needed';
  return 'permission prompt';
}
