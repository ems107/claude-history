import type { GitOverview, GitStatus } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { gitApi } from '../../api/git.ts';
import { btn } from '../../lib/ui.ts';
import { toggleClass } from '../viewer/SessionHeader.tsx';
import { PushDialog } from './PushDialog.tsx';
import { RepoPicker } from './RepoPicker.tsx';
import { useGitAction } from './useGitAction.ts';

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
  logOpen,
  onToggleLog,
  tab,
  onTab,
}: {
  overview: GitOverview | undefined;
  repoId: string | null;
  status: GitStatus | undefined;
  onPick: (id: string) => void;
  onChanged: () => void;
  logOpen: boolean;
  onToggleLog: () => void;
  tab: 'commits' | 'work';
  onTab: (tab: 'commits' | 'work') => void;
}) {
  const [opening, setOpening] = useState(false);
  const [pushing, setPushing] = useState(false);
  const action = useGitAction(repoId);
  const repo = overview?.repos.find((r) => r.id === repoId) ?? null;

  // Only fetched when the push dialog needs them.
  const remotesQ = useQuery({
    queryKey: ['git', 'remotes', repoId],
    queryFn: () => gitApi.remotes(repoId as string),
    enabled: !!repoId && pushing,
  });

  // The two failures worth answering in place rather than just reporting.
  const diverged = /fast-forward/i.test(action.error ?? '');
  const needsCredentials = /credentials/i.test(action.error ?? '');

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
        <span className="flex items-center gap-0.5">
          <button type="button" onClick={() => onTab('commits')} className={toggleClass(tab === 'commits')} title="The history">
            Commits
          </button>
          <button
            type="button"
            onClick={() => onTab('work')}
            className={toggleClass(tab === 'work')}
            title="What has changed and is not committed"
          >
            Working tree
            {changed > 0 && <span className="ml-1 tabular-nums text-[var(--accent)]">{changed}</span>}
          </button>
        </span>
        <button
          type="button"
          onClick={onToggleLog}
          className={toggleClass(logOpen)}
          title="Every git command this app runs"
        >
          ⌘ log
        </button>
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

      {repoId && (
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void action.run(() => gitApi.fetch(repoId))}
            disabled={action.busy || !!status?.blocked.fetch}
            title={status?.blocked.fetch ?? 'Update the remote-tracking branches (--all --prune)'}
            className={btn}
          >
            {action.busy ? '…' : 'Fetch'}
          </button>
          <button
            type="button"
            onClick={() => void action.run(() => gitApi.pull(repoId))}
            disabled={action.busy || !!status?.blocked.pull}
            title={status?.blocked.pull ?? 'Fast-forward onto the upstream'}
            className={btn}
          >
            Pull{status && status.behind > 0 ? ` ↓${status.behind}` : ''}
          </button>
          <button
            type="button"
            onClick={() => setPushing(true)}
            disabled={action.busy || !status}
            title={status?.blocked.push ?? status?.blocked.pushUpstream ?? 'Send commits to the remote'}
            className={btn}
          >
            Push{status && status.ahead > 0 ? ` ↑${status.ahead}` : ''}
          </button>
        </span>
      )}

      {repo?.error && <p className="w-full text-[11px] text-red-400">{repo.error}</p>}

      {/* A refusal here is a decision waiting to be made, so the two ways out
          sit next to it rather than in a menu somewhere else. */}
      {action.error && (
        <div className="w-full rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
          <p>{action.error}</p>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {diverged && repoId && (
              <>
                <button type="button" className={btn} onClick={() => void action.run(() => gitApi.pull(repoId, { rebase: true }))}>
                  Pull with rebase
                </button>
                <button type="button" className={btn} onClick={() => void action.run(() => gitApi.pull(repoId, { merge: true }))}>
                  Pull with merge
                </button>
              </>
            )}
            {needsCredentials && repoId && (
              <button type="button" className={btn} onClick={() => open('terminal')}>
                ❯ Open a terminal here
              </button>
            )}
            <button type="button" className={btn} onClick={action.clear}>
              Dismiss
            </button>
          </span>
        </div>
      )}
      {action.note && (
        <p className="w-full truncate text-[11px] text-emerald-400" title={action.note}>
          {action.note.split('\n')[0]}
        </p>
      )}

      {pushing && status && (
        <PushDialog
          status={status}
          remotes={remotesQ.data ?? []}
          busy={action.busy}
          onCancel={() => setPushing(false)}
          onPush={(body) => {
            setPushing(false);
            if (repoId) void action.run(() => gitApi.push(repoId, body));
          }}
        />
      )}
    </div>
  );
}
