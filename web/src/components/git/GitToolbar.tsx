import {
  DEFAULT_SETTINGS,
  GIT_FETCH_MODES,
  GIT_PULL_MODES,
  type GitOverview,
  type GitStatus,
} from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { gitApi } from '../../api/git.ts';
import { btn } from '../../lib/ui.ts';
import { toggleClass } from '../viewer/SessionHeader.tsx';
import { PushDialog } from './PushDialog.tsx';
import { RepoPicker } from './RepoPicker.tsx';
import { SplitButton, type SplitOption } from './SplitButton.tsx';
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
  const [pushing, setPushing] = useState<null | { force: boolean }>(null);
  const action = useGitAction(repoId);
  const repo = overview?.repos.find((r) => r.id === repoId) ?? null;

  // Only fetched when the push dialog needs them.
  const remotesQ = useQuery({
    queryKey: ['git', 'remotes', repoId],
    queryFn: () => gitApi.remotes(repoId as string),
    enabled: !!repoId && !!pushing,
  });

  // What each button's main click does. The server applies the same settings
  // when a request names no mode, so this only decides which entry is on the
  // outside of the menu — the two can never disagree about what runs.
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const s = settings.data?.settings ?? DEFAULT_SETTINGS;

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

  // The remote of the branch's upstream, for the labels only — `origin/main`
  // splits at the first slash, and the server resolves the real one anyway.
  const remote = status?.upstream?.split('/')[0] ?? 'origin';
  const branch = status?.branch ?? 'HEAD';
  // The buttons these belong to are only rendered with a repository open, so
  // the closures below cannot run without one.
  const id = repoId as string;

  const fetchOptions: SplitOption[] = [
    {
      key: GIT_FETCH_MODES[0],
      label: 'Fetch every remote',
      command: 'git fetch --prune --all',
      hint: 'Pruning drops the origin/x entries whose branch is gone. No local branch is touched.',
      short: 'all, pruned',
      blocked: status?.blocked.fetch ?? null,
      run: () => void action.run(() => gitApi.fetch(id, { mode: 'all-prune' })),
    },
    {
      key: 'all',
      label: 'Fetch every remote, keeping stale branches',
      command: 'git fetch --all',
      hint: 'The list of remote branches grows for ever, including ones deleted months ago.',
      short: 'no prune',
      blocked: status?.blocked.fetch ?? null,
      run: () => void action.run(() => gitApi.fetch(id, { mode: 'all' })),
    },
    {
      key: 'current',
      label: `Fetch only ${remote}`,
      command: `git fetch --prune ${remote}`,
      hint: 'Quicker where there are several remotes; the others stay behind without saying so.',
      short: remote,
      blocked: status?.blocked.fetch ?? null,
      run: () => void action.run(() => gitApi.fetch(id, { mode: 'current' })),
    },
  ];

  const pullOptions: SplitOption[] = [
    {
      key: GIT_PULL_MODES[0],
      label: 'Pull, fast-forward only',
      command: 'git pull --ff-only',
      hint: 'Refuses if both sides have moved, and offers the other two here rather than choosing for you.',
      short: 'ff-only',
      blocked: status?.blocked.pull ?? null,
      run: () => void action.run(() => gitApi.pull(id, { mode: 'ff-only' })),
    },
    {
      key: 'rebase',
      label: 'Pull with rebase',
      command: 'git pull --rebase',
      hint: 'Replays your commits on top of theirs. A conflict stops mid-rebase, which you then have to finish.',
      short: 'rebase',
      blocked: status?.blocked.pull ?? null,
      run: () => void action.run(() => gitApi.pull(id, { mode: 'rebase' })),
    },
    {
      key: 'merge',
      label: 'Pull with merge',
      command: 'git pull --no-rebase',
      hint: 'Never fails, but leaves a “Merge branch…” commit every time the two sides have both moved.',
      short: 'merge',
      blocked: status?.blocked.pull ?? null,
      run: () => void action.run(() => gitApi.pull(id, { mode: 'merge' })),
    },
  ];

  const needsUpstream = !!status && !status.upstream;
  const pushOptions: SplitOption[] = [
    {
      key: 'push',
      label: needsUpstream ? 'Push and set the upstream' : 'Push this branch',
      command: `git push${needsUpstream ? ' --set-upstream' : ''} ${remote} ${branch}`,
      hint: needsUpstream ? 'This branch is not on the remote yet; this is what puts it there.' : undefined,
      short: 'direct',
      // A branch with no upstream is not blocked, it is the case --set-upstream
      // exists for; the two refusals are different and so are their reasons.
      blocked: (needsUpstream ? status?.blocked.pushUpstream : status?.blocked.push) ?? null,
      run: () =>
        void action.run(() =>
          gitApi.push(id, { setUpstream: needsUpstream, forceWithLease: false, tags: false, confirm: false }),
        ),
    },
    {
      key: 'dialog',
      label: 'Push with options…',
      command: 'git push …',
      hint: 'Choose the remote, the tags and the force, and read the exact command before it runs.',
      short: 'dialog',
      run: () => setPushing({ force: false }),
    },
    {
      key: 'tags',
      label: 'Push, tags included',
      command: `git push --tags ${remote} ${branch}`,
      hint: 'Publishes every local tag, not only the ones on this branch.',
      blocked: status?.blocked.push ?? null,
      run: () =>
        void action.run(() =>
          gitApi.push(id, { setUpstream: false, forceWithLease: false, tags: true, confirm: false }),
        ),
    },
    {
      key: 'force',
      label: 'Force push, with lease…',
      command: `git push --force-with-lease ${remote} ${branch}`,
      hint: 'Refused if the remote moved since your last fetch. Asks for confirmation, and for the name on shared branches.',
      danger: true,
      blocked: status?.blocked.pushForce ?? null,
      run: () => setPushing({ force: true }),
    },
  ];

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
          <SplitButton
            label="Fetch"
            busy={action.busy}
            defaultKey={s.gitFetchDefault}
            options={fetchOptions}
            title="Update the remote-tracking branches"
          />
          <SplitButton
            label={`Pull${status && status.behind > 0 ? ` ↓${status.behind}` : ''}`}
            busy={action.busy}
            defaultKey={s.gitPullDefault}
            options={pullOptions}
            title="Bring the upstream's commits in"
          />
          <SplitButton
            label={`Push${status && status.ahead > 0 ? ` ↑${status.ahead}` : ''}`}
            busy={action.busy}
            defaultKey={s.gitPushDefault}
            options={pushOptions}
            title="Send commits to the remote"
          />
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
                <button
                  type="button"
                  className={btn}
                  title="git pull --rebase"
                  onClick={() => void action.run(() => gitApi.pull(repoId, { mode: 'rebase' }))}
                >
                  Pull with rebase
                </button>
                <button
                  type="button"
                  className={btn}
                  title="git pull --no-rebase"
                  onClick={() => void action.run(() => gitApi.pull(repoId, { mode: 'merge' }))}
                >
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
          initialForce={pushing.force}
          onCancel={() => setPushing(null)}
          onPush={(body) => {
            setPushing(null);
            if (repoId) void action.run(() => gitApi.push(repoId, body));
          }}
        />
      )}
    </div>
  );
}
