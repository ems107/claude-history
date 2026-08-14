import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { gitApi } from '../api/git.ts';
import { GitToolbar } from '../components/git/GitToolbar.tsx';
import { RefSidebar } from '../components/git/RefSidebar.tsx';
import { RepoStateBanner } from '../components/git/RepoStateBanner.tsx';
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
        />
        <RepoStateBanner status={status} />

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!repoId && (
            <p className="text-[var(--text-dim)]">
              No repository selected. Add a folder to scan from the picker above — one root covering where you keep
              your clones is usually all it takes.
            </p>
          )}

          {repoId && statusQ.isError && (
            <p className="text-red-400">Could not read this repository: {String(statusQ.error)}</p>
          )}

          {status && (
            <div className="max-w-3xl space-y-3 text-xs">
              <div className="rounded border border-[var(--border)] bg-[var(--bg-raised)]/50 p-3">
                <p className="text-[10px] tracking-wider text-[var(--text-dim)] uppercase">Head</p>
                {status.headSha ? (
                  <>
                    <p className="mt-1">
                      <span className="font-mono text-[var(--text-dim)]">{status.headSha.slice(0, 7)}</span>{' '}
                      <span>{status.headSubject}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                      read {relativeTime(status.readAt)}
                      <span title={formatDateTime(status.readAt)}> · {formatDateTime(status.readAt)}</span>
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[var(--text-dim)]">No commits yet.</p>
                )}
              </div>

              <p className="text-[var(--text-dim)]">
                The commit graph, the working tree and the diff viewer land in this pane next.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
