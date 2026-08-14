import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { gitApi } from '../api/git.ts';
import { CommandLogDock } from '../components/git/CommandLogDock.tsx';
import { CommitDetail } from '../components/git/CommitDetail.tsx';
import { GitToolbar } from '../components/git/GitToolbar.tsx';
import { GraphList } from '../components/git/GraphList.tsx';
import { RefSidebar } from '../components/git/RefSidebar.tsx';
import { RepoStateBanner } from '../components/git/RepoStateBanner.tsx';
import { WorkingTree } from '../components/git/WorkingTree.tsx';
import { formatDateTime, relativeTime } from '../lib/format.ts';
import { useDragSize } from '../lib/useDragSize.ts';

/** Which repository was last looked at. Not in the URL: it is where you were, not what you shared. */
const LAST_REPO_KEY = 'git.lastRepo';

/**
 * The GIT tab.
 *
 * What is SHOWN lives in the URL (`repo`, `ref`), so a link reproduces the
 * page; how it is laid out — pane sizes, which sections are folded — lives in
 * localStorage, because that belongs to the reader rather than to the link.
 * It is the same split the search panel's tuning already follows.
 */
export function GitPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sidebar = useDragSize({ key: 'git.sidebarWidth', axis: 'x', min: 180, max: 520, initial: 240 });
  const graph = useDragSize({ key: 'git.graphHeight', axis: 'y', min: 120, max: 900, initial: 340 });
  // Dragging the dock's top edge upwards makes it taller, so this one inverts.
  const dock = useDragSize({ key: 'git.logHeight', axis: 'y', min: 80, max: 600, initial: 200, invert: true });
  const [logOpen, setLogOpen] = useState(() => localStorage.getItem('git.logOpen') === '1');
  const toggleLog = useCallback(() => {
    setLogOpen((prev) => {
      localStorage.setItem('git.logOpen', prev ? '0' : '1');
      return !prev;
    });
  }, []);

  const overviewQ = useQuery({ queryKey: ['git', 'repos'], queryFn: () => gitApi.overview() });

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Shortcuts, guarded the way every other page in the app guards them, so
  // typing a path into the picker never toggles a panel behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'd') {
        e.preventDefault();
        toggleLog();
      }
      if (e.key === 'w') {
        e.preventDefault();
        setParam('tab', 'work');
      }
      if (e.key === 'g') {
        e.preventDefault();
        setParam('tab', null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleLog, setParam]);

  const repos = overviewQ.data?.repos.filter((r) => !r.hidden) ?? [];
  const urlRepo = searchParams.get('repo');
  // ?repo= wins, then wherever you were last, then the first repository there
  // is. Whichever it turns out to be is written back into the URL, so reloading
  // and going Back both land in the same place.
  const repoId = repos.some((r) => r.id === urlRepo)
    ? urlRepo
    : (repos.find((r) => r.id === localStorage.getItem(LAST_REPO_KEY))?.id ?? repos[0]?.id ?? null);

  useEffect(() => {
    if (repoId && repoId !== urlRepo) setParam('repo', repoId);
    if (repoId) localStorage.setItem(LAST_REPO_KEY, repoId);
  }, [repoId, urlRepo, setParam]);

  const selectedRef = searchParams.get('ref');
  // The full sha, not the short one: seven characters are not a safe anchor.
  const selectedSha = searchParams.get('c');
  const tab: 'commits' | 'work' = searchParams.get('tab') === 'work' ? 'work' : 'commits';

  const enabled = !!repoId;
  const statusQ = useQuery({
    queryKey: ['git', 'status', repoId],
    queryFn: () => gitApi.status(repoId as string),
    enabled,
  });
  const branchesQ = useQuery({
    queryKey: ['git', 'branches', repoId],
    queryFn: () => gitApi.branches(repoId as string),
    enabled,
  });
  const tagsQ = useQuery({ queryKey: ['git', 'tags', repoId], queryFn: () => gitApi.tags(repoId as string), enabled });
  const stashesQ = useQuery({
    queryKey: ['git', 'stashes', repoId],
    queryFn: () => gitApi.stashes(repoId as string),
    enabled,
  });
  const worktreesQ = useQuery({
    queryKey: ['git', 'worktrees', repoId],
    queryFn: () => gitApi.worktrees(repoId as string),
    enabled,
  });

  if (overviewQ.isLoading) {
    return <div className="p-8 text-[var(--text-dim)]">Looking for repositories…</div>;
  }
  if (overviewQ.isError) {
    return <div className="p-8 text-red-400">Could not read the repository list: {String(overviewQ.error)}</div>;
  }
  if (overviewQ.data && !overviewQ.data.available) {
    return <div className="p-8 text-red-400">{overviewQ.data.error}</div>;
  }

  const status = statusQ.data;

  return (
    <div className="flex h-full">
      <aside
        style={{ width: sidebar.size }}
        className="h-full shrink-0 overflow-hidden border-r border-[var(--border)]"
      >
        <RefSidebar
          branches={branchesQ.data}
          tags={tagsQ.data}
          stashes={stashesQ.data}
          worktrees={worktreesQ.data}
          selectedRef={selectedRef}
          onSelectRef={(ref) => setParam('ref', ref)}
        />
      </aside>
      <div
        onMouseDown={sidebar.onMouseDown}
        className="h-full w-1 shrink-0 cursor-col-resize hover:bg-[var(--accent-dim)]"
        title="Drag to resize"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <GitToolbar
          overview={overviewQ.data}
          repoId={repoId}
          status={status}
          onPick={(id) => setParam('repo', id)}
          onChanged={() => void overviewQ.refetch()}
          logOpen={logOpen}
          onToggleLog={toggleLog}
          tab={tab}
          onTab={(next) => setParam('tab', next === 'work' ? 'work' : null)}
        />
        <RepoStateBanner status={status} />

        {!repoId ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
            <p className="text-[var(--text-dim)]">
              No repository selected. Add a folder to scan from the picker above — one root covering where you keep
              your clones is usually all it takes.
            </p>
          </div>
        ) : tab === 'work' ? (
          status ? (
            <WorkingTree repoId={repoId} status={status} />
          ) : (
            <div className="min-h-0 flex-1 p-4 text-xs text-[var(--text-dim)]">Reading the working tree…</div>
          )
        ) : (
          <>
            {selectedRef && (
              <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1 text-[11px]">
                <span className="text-[var(--text-dim)]">Showing only</span>
                <span className="font-mono text-[var(--accent)]">{selectedRef}</span>
                <button
                  type="button"
                  onClick={() => setParam('ref', null)}
                  className="cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)]"
                >
                  show everything
                </button>
              </div>
            )}

            <div style={{ height: graph.size }} className="min-h-0 shrink-0 overflow-hidden">
              <GraphList
                repoId={repoId}
                refFilter={selectedRef}
                selected={selectedSha}
                onSelect={(sha) => {
                  // A file chosen inside one commit means nothing in the next.
                  setSearchParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      next.set('c', sha);
                      next.delete('f');
                      return next;
                    },
                    { replace: true },
                  );
                }}
              />
            </div>
            <div
              onMouseDown={graph.onMouseDown}
              className="h-1 w-full shrink-0 cursor-row-resize border-y border-[var(--border)] hover:bg-[var(--accent-dim)]"
              title="Drag to resize"
            />

            <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
              {statusQ.isError && <p className="text-red-400">Could not read this repository: {String(statusQ.error)}</p>}
              {selectedSha ? (
                <CommitDetail
                  repoId={repoId}
                  sha={selectedSha}
                  selectedPath={searchParams.get('f')}
                  onSelectPath={(path) => setParam('f', path)}
                />
              ) : (
                <p className="text-[var(--text-dim)]">
                  Pick a commit above to see what it changed.
                  {status?.headSha && (
                    <>
                      {' '}
                      HEAD is <span className="font-mono">{status.headSha.slice(0, 7)}</span>, read{' '}
                      <span title={formatDateTime(status.readAt)}>{relativeTime(status.readAt)}</span>.
                    </>
                  )}
                </p>
              )}
            </div>
          </>
        )}

        <CommandLogDock
          open={logOpen}
          onToggle={toggleLog}
          height={dock.size}
          onResizeStart={dock.onMouseDown}
        />
      </div>
    </div>
  );
}
