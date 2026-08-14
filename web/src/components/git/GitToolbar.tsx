import type { GitOverview, GitStatus } from '@claude-history/shared';
import { useState } from 'react';
import { gitApi } from '../../api/git.ts';
import { btn } from '../../lib/ui.ts';
import { RepoPicker } from './RepoPicker.tsx';

/**
 * The repository's headline: which one, where its HEAD is, and how far it has
 * drifted from its upstream — plus the ways out of the app.
 *
 * Opening the repository elsewhere is not an afterthought here. Conflicts are
 * resolved outside this tab by design, and an authentication failure is
 * answered by running the command once by hand, so a terminal already in the
 * right folder is part of the feature rather than a convenience.
 */
export function GitToolbar({
  overview,
  repoId,
  status,
  onPick,
  onChanged,
}: {
  overview: GitOverview | undefined;
  repoId: string | null;
  status: GitStatus | undefined;
  onPick: (id: string) => void;
  onChanged: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const repo = overview?.repos.find((r) => r.id === repoId) ?? null;

  const changed = status ? status.entries.filter((e) => e.unstaged !== 'ignored').length : 0;
  const conflicted = status ? status.entries.filter((e) => e.conflicted).length : 0;

  const open = (target: 'explorer' | 'vscode' | 'terminal') => {
    if (!repoId) return;
    setOpening(true);
    void gitApi
      .open(repoId, target)
      .catch(() => undefined)
      .finally(() => setOpening(false));
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
      <RepoPicker overview={overview} repoId={repoId} onPick={onPick} onChanged={onChanged} busy={false} />

      {status && (
        <span className="flex items-center gap-2 text-xs">
          {status.branch ? (
            <span className="font-mono text-[var(--accent)]" title={status.upstream ?? 'No upstream'}>
              ⎇ {status.branch}
            </span>
          ) : (
            <span className="font-mono text-amber-400" title="HEAD is not on a branch">
              detached at {status.detachedAt?.slice(0, 7)}
            </span>
          )}
          {(status.ahead > 0 || status.behind > 0) && (
            <span
              className="tabular-nums text-[var(--text-dim)]"
              title={`${status.ahead} ahead of and ${status.behind} behind ${status.upstream}`}
            >
              {status.ahead > 0 && `↑${status.ahead}`}
              {status.behind > 0 && ` ↓${status.behind}`}
            </span>
          )}
          <span className="text-[var(--text-dim)]">·</span>
          <span className="text-[var(--text-dim)]">
            {changed === 0 ? 'clean' : `${changed} change${changed === 1 ? '' : 's'}`}
            {status.truncated && ' (list capped)'}
          </span>
          {conflicted > 0 && (
            <span className="text-amber-400">
              {conflicted} conflicted
            </span>
          )}
          {status.stale && (
            <span className="text-[var(--text-dim)]" title="Something is running in this repository; these are the last figures read">
              (stale)
            </span>
          )}
        </span>
      )}

      <span className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          disabled={!repoId || opening}
          onClick={() => open('terminal')}
          className={btn}
          title="Open a terminal in this repository"
        >
          ❯
        </button>
        <button
          type="button"
          disabled={!repoId || opening}
          onClick={() => open('vscode')}
          className={btn}
          title="Open this repository in VS Code"
        >
          {'{ }'}
        </button>
        <button
          type="button"
          disabled={!repoId || opening}
          onClick={() => open('explorer')}
          className={btn}
          title="Open this folder in Explorer"
        >
          📁
        </button>
      </span>

      {repo?.error && <p className="w-full text-[11px] text-red-400">{repo.error}</p>}
    </div>
  );
}
