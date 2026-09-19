import {
  DEFAULT_SETTINGS,
  GIT_FETCH_MODES,
  GIT_PULL_MODES,
  type GitOverview,
  type GitStatus,
} from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { gitApi } from '../../api/git.ts';
import { useHideLocalOnly, useLocalOnly } from '../../api/useLocal.ts';
import { useIsMobile } from '../../lib/mobile.ts';
import {
  actionClass,
  BAR_H,
  controlRow,
  segmentClass,
  segmentedClass,
  squareClass,
  toggleClass,
} from '../controlClass.ts';
import { Popover } from '../Popover.tsx';
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
  onOpenRefs,
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
  /**
   * Open the refs sheet. Present on a phone only, where the column those refs
   * live in is not on screen — the button is drawn exactly when there is
   * something for it to open, so a desktop grows no control it does not need.
   */
  onOpenRefs?: () => void;
}) {
  const mobile = useIsMobile();
  /** Everything that is neither where you are nor what you are looking at. */
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
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

  // All three open a window on the machine the server runs on, so all three are
  // refused over remote access (409) — these only decide what is DRAWN. On a
  // desktop they grey with the reason; a phone is never that machine, so there
  // they are left out rather than left as a permanent apology.
  const terminalOnly = useLocalOnly('openTerminal');
  const vsCodeOnly = useLocalOnly('openVsCode');
  const folderOnly = useLocalOnly('openFolder');
  const hideLocal = useHideLocalOnly();

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

  /**
   * The three that reach the network, shared by both layouts.
   *
   * On a phone they are the whole of a row and divide it equally, so the
   * three targets are the same size and none of them is a 10px caret at the
   * end of a line that has already wrapped twice.
   */
  /**
   * What went wrong, and the ways out of it — shared, because a refusal is
   * the same fact on both layouts, and it is the one thing on this bar that
   * must never be a tooltip.
   */
  const dialogs = <>
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
  </>;
  const feedback = (
    <>
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
                  className={actionClass}
                  title="git pull --rebase"
                  onClick={() => void action.run(() => gitApi.pull(repoId, { mode: 'rebase' }))}
                >
                  Pull with rebase
                </button>
                <button
                  type="button"
                  className={actionClass}
                  title="git pull --no-rebase"
                  onClick={() => void action.run(() => gitApi.pull(repoId, { mode: 'merge' }))}
                >
                  Pull with merge
                </button>
              </>
            )}
            {/* The one place this button really matters: git asked for
                credentials and the answer is to run the command once by hand.
                Over remote access that cannot be done from here, and saying so
                is better than a button that opens a window somewhere else. */}
            {needsCredentials && repoId && !hideLocal && (
              <button
                type="button"
                className={actionClass}
                disabled={terminalOnly.disabled}
                title={terminalOnly.reason ?? undefined}
                onClick={() => open('terminal')}
              >
                ❯ Open a terminal here
              </button>
            )}
            <button type="button" className={actionClass} onClick={action.clear}>
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
    </>
  );
  const network = repoId ? (
    <span className="flex items-center gap-1.5 max-md:gap-1 max-md:[&>*]:flex-1 max-md:[&_button:first-child]:flex-1">
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
  ) : null;
  /**
   * The bar, on a phone: three rows with a shape instead of one that wraps.
   *
   * The wrapping version measured 259px of chrome above the first commit on a
   * 775px screen — a third of the window — with six bordered buttons of equal
   * weight, so switching what you are LOOKING at (Commits / Working tree) drew
   * the eye exactly as hard as opening the folder in Explorer. It also gave the
   * repository picker the whole of a row and then spent it on the front of a
   * path, leaving the name itself as `l…`.
   *
   * So: where you are, then what you are looking at, then what reaches the
   * network. Everything that is neither goes behind one `⋮` with words next to
   * it, which is the same answer the session's own actions take.
   */
  if (mobile) {
    const abnormal = [
      conflicted > 0 ? `${conflicted} conflicted` : null,
      status && !status.branch ? `detached at ${status.detachedAt?.slice(0, 7)}` : null,
      status?.truncated ? 'more changes than are listed' : null,
      status?.stale ? 'figures are from before the command now running' : null,
    ].filter(Boolean);
    const tab_ = (which: 'commits' | 'work', label: string, count?: number) => (
      <button
        type="button"
        onClick={() => onTab(which)}
        aria-pressed={tab === which}
        className={segmentClass(tab === which)}
      >
        <span className="truncate">{label}</span>
        {count ? (
          <span className="shrink-0 rounded bg-[var(--accent)]/20 px-1 text-[10px] tabular-nums text-[var(--accent)]">
            {count}
          </span>
        ) : null}
      </button>
    );
    return (
      <div className="shrink-0 border-b border-[var(--border)]">
        {/* 1. Which repository, and the branch as the way into everything else
               about it — tapping a branch name to see the branches is what a
               person means by it, and it saves the row a second button. */}
        {/* No page title here any more: `Git` is a tab of its own in the bottom
            bar and lights up for this page, so a heading saying it again was a
            word taken off the repository's name — the one thing on the row that
            cannot be guessed. */}
        <div className={controlRow + ' px-2 pt-1.5'}>
          <RepoPicker overview={overview} repoId={repoId} onPick={onPick} onChanged={onChanged} busy={false} compact />
          {onOpenRefs && (
            <button
              type="button"
              onClick={onOpenRefs}
              aria-label="Branches, remotes, tags and stashes"
              className={`ml-auto flex ${BAR_H} shrink-0 cursor-pointer items-center gap-1 rounded border border-[var(--border)] px-2 font-mono text-xs text-[var(--accent)]`}
            >
              <span aria-hidden>⎇</span>
              <span className="max-w-28 truncate">{status?.branch ?? 'HEAD'}</span>
              <span aria-hidden className="text-[var(--text-dim)]">▾</span>
            </button>
          )}
        </div>

        {/* 2. Which half of the repository, and everything that is neither. */}
        <div className={controlRow + ' px-2 pt-1'}>
          <span className={`${segmentedClass} flex-1`}>
            {tab_('commits', 'Commits')}
            {tab_('work', 'Working tree', changed)}
          </span>
          <button
            ref={moreRef}
            type="button"
            onClick={() => setMore(true)}
            className={squareClass(more)}
            aria-haspopup="menu"
            aria-label="More things to do in this repository"
          >
            ⋮
          </button>
        </div>

        {/* 3. The three that go out to a remote. */}
        {network && <div className="px-2 pt-1">{network}</div>}

        {/* Only when there is something abnormal to say: `clean` is the absence
            of a count on the tab above, and repeating it is a row spent on it. */}
        {abnormal.length > 0 && (
          <p className="px-2 pt-1 text-[11px] text-amber-400">{abnormal.join(' · ')}</p>
        )}

        <div className="px-2 pb-1.5">{feedback}</div>
        {dialogs}

        {/* A popover under the button rather than a screen of its own. Five
            rows do not need the window, and taking it meant the page you were
            working in vanished to be told that a command log exists. */}
        {more && (
          <Popover anchorRef={moreRef} onClose={() => setMore(false)} label="This repository">
            <MoreRow label="Command log" hint="Every git command this app has run" onClick={() => { setMore(false); onToggleLog(); }} />
            <MoreRow label="Look for repositories again" hint="Walk the scan roots" onClick={() => { setMore(false); onChanged(); }} />
            {!hideLocal && (
              <>
                <MoreRow
                  label="❯ Open a terminal here"
                  hint={terminalOnly.reason ?? 'Resolve a conflict, or store your credentials once'}
                  disabled={!repoId || terminalOnly.disabled}
                  onClick={() => { setMore(false); open('terminal'); }}
                />
                <MoreRow
                  label="{ } Open in VS Code"
                  hint={vsCodeOnly.reason ?? undefined}
                  disabled={!repoId || vsCodeOnly.disabled}
                  onClick={() => { setMore(false); open('vscode'); }}
                />
                <MoreRow
                  label="📁 Open in Explorer"
                  hint={folderOnly.reason ?? undefined}
                  disabled={!repoId || folderOnly.disabled}
                  onClick={() => { setMore(false); open('explorer'); }}
                />
              </>
            )}
          </Popover>
        )}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 max-md:gap-1.5 max-md:px-2">
      {/* The way into everything the refs column holds, and on a phone the only
          one: branches, remotes, tags, stashes and worktrees are a tap away
          rather than a column away. */}
      {onOpenRefs && (
        <button type="button" onClick={onOpenRefs} className={`${actionClass} shrink-0`} aria-label="Branches and tags">
          ⎇ Refs
        </button>
      )}
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

      {/* `ml-auto` only above the fold line: once this row wraps — which it
          always does at 360px — pushing a group right means pushing it onto a
          line of its own, which reads as a gap rather than as an alignment. */}
      <span className="ml-auto flex items-center gap-1.5 max-md:ml-0 max-md:flex-wrap">
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
        {!hideLocal && (
          <>
            <button
              type="button"
              disabled={!repoId || opening || terminalOnly.disabled}
              onClick={() => open('terminal')}
              className={actionClass}
              title={terminalOnly.reason ?? 'Open a terminal in this repository'}
            >
              {/* A glyph on a desktop, where a tooltip explains it; a word on a
                  phone, where nothing ever will. Same two-span rule the rest of
                  the app follows. */}
              <span className="max-md:hidden">❯</span>
              <span className="hidden max-md:inline">❯ Terminal</span>
            </button>
            <button
              type="button"
              disabled={!repoId || opening || vsCodeOnly.disabled}
              onClick={() => open('vscode')}
              className={actionClass}
              title={vsCodeOnly.reason ?? 'Open this repository in VS Code'}
            >
              <span className="max-md:hidden">{'{ }'}</span>
              <span className="hidden max-md:inline">{'{ } VS Code'}</span>
            </button>
            <button
              type="button"
              disabled={!repoId || opening || folderOnly.disabled}
              onClick={() => open('explorer')}
              className={actionClass}
              title={folderOnly.reason ?? 'Open this folder in Explorer'}
            >
              <span className="max-md:hidden">📁</span>
              <span className="hidden max-md:inline">📁 Explorer</span>
            </button>
          </>
        )}
      </span>

      {network}

      {feedback}

      {dialogs}
    </div>
  );
}

/**
 * One line of the `⋮` sheet: what it does, and why, in words.
 *
 * The bar these came from drew them as `❯`, `{ }` and `📁` with the meaning in
 * a `title` — which on Android is nowhere at all. A sheet has the room for the
 * sentence, which is the whole reason they moved into one.
 */
function MoreRow({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded border-b border-[var(--border)]/60 px-2 py-1.5 text-left last:border-b-0 hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-40"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-[var(--text-dim)]">{hint}</span>}
      </span>
      <span aria-hidden className="shrink-0 text-[var(--text-dim)]">
        ›
      </span>
    </button>
  );
}
