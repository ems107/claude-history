import type { LiveInfo } from '@claude-history/shared';

/**
 * Mark a session as busy because OUR process is answering a prompt in it.
 *
 * Claude Code writes `~/.claude/sessions/<pid>.json` for a `--print` run like
 * any other, but leaves out the `status` field it writes for interactive
 * sessions — so the badge's usual source answers `"unknown"` for exactly the
 * sessions the composer is working on, forever. Without this the list shows
 * them as merely `live` while Claude is mid-answer.
 *
 * The pid is kept when there is a real entry: it is a real process, and
 * something may still want to check it. Synthesised entries carry pid 0, the
 * same convention the viewer uses.
 */
export function markBusy(live: LiveInfo | null, turnStartedAt: number): LiveInfo {
  return {
    pid: live?.pid ?? 0,
    name: live?.name ?? null,
    startedAt: live?.startedAt ?? null,
    updatedAt: live?.updatedAt ?? null,
    status: 'busy',
    // Nothing is being waited on: this is a turn in flight, by definition.
    waitingFor: null,
    statusUpdatedAt: turnStartedAt,
  };
}
