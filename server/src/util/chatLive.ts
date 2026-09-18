import type { LiveInfo } from '@claude-history/shared';

/**
 * What one of OUR processes is doing in a session: the turn's start, and the
 * question standing in the reader's way when there is one. Shaped by
 * `SessionChatService.workingSessions()` and read by the two routes that
 * overlay it onto `LiveInfo`.
 */
export interface OurTurn {
  startedAt: number;
  /** Set while a question of ours is on screen — `askingFor`'s vocabulary, and when it went up. */
  asking: { waitingFor: string; since: number } | null;
}

/**
 * Mark a session as busy — or waiting — because OUR process is answering a
 * prompt in it.
 *
 * Claude Code writes `~/.claude/sessions/<pid>.json` for a `--print` run like
 * any other, but leaves out the `status` field it writes for interactive
 * sessions — so the badge's usual source answers `"unknown"` for exactly the
 * sessions the composer is working on, forever. Without this the list shows
 * them as merely `live` while Claude is mid-answer.
 *
 * A question of ours on screen is `waiting`, not `busy`: the SDK keeps the turn
 * open while `AskUserQuestion` (or a permission) stands, so `working` stays
 * true — but a session blocked on a person must not read as one that is
 * getting anywhere, which is the same rule the viewer's spinner follows.
 *
 * The pid is kept when there is a real entry: it is a real process, and
 * something may still want to check it. Synthesised entries carry pid 0, the
 * same convention the viewer uses.
 */
export function markOurs(live: LiveInfo | null, turn: OurTurn): LiveInfo {
  return {
    pid: live?.pid ?? 0,
    name: live?.name ?? null,
    startedAt: live?.startedAt ?? null,
    updatedAt: live?.updatedAt ?? null,
    status: turn.asking ? 'waiting' : 'busy',
    waitingFor: turn.asking?.waitingFor ?? null,
    // The flip's clock: when the question went up, or when the turn began —
    // the same two moments the CLI's own statusUpdatedAt names.
    statusUpdatedAt: turn.asking?.since ?? turn.startedAt,
    // Our own turns are the one case this is exact rather than remembered:
    // the composer stamped the click itself.
    busySince: turn.startedAt,
  };
}
