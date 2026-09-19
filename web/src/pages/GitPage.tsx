import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { gitApi } from '../api/git.ts';
import { CommandLogPanel } from '../components/git/CommandLogPanel.tsx';
import { CommitDetail } from '../components/git/CommitDetail.tsx';
import { GitToolbar } from '../components/git/GitToolbar.tsx';
import { GraphList } from '../components/git/GraphList.tsx';
import { RefSidebar } from '../components/git/RefSidebar.tsx';
import { RepoStateBanner } from '../components/git/RepoStateBanner.tsx';
import { WorkingTree } from '../components/git/WorkingTree.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { formatDateTime, relativeTime } from '../lib/format.ts';
import { useBackDismiss, useIsMobile } from '../lib/mobile.ts';
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
 *
 * **Two shapes, one page.** On a desktop it is four panes and three drag
 * handles: refs beside the work, and the graph above what the selected commit
 * changed. None of that survives 360px — the refs column alone has a 180px
 * floor and the working tree's file list another 220 — so on a phone the same
 * pieces are shown ONE AT A TIME, with the second one arriving as a sheet over
 * the first and Android's Back taking it away again. Nothing is dropped: every
 * pane is still reachable, it simply takes a tap instead of a glance.
 *
 * Which shape is drawn is `useIsMobile()`, a width and not a device, so a
 * narrow desktop window gets the phone's layout for the same reason a phone
 * does — the arithmetic does not fit either way.
 */
export function GitPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const sidebar = useDragSize({ key: 'git.sidebarWidth', axis: 'x', min: 180, max: 520, initial: 240 });
  const graph = useDragSize({ key: 'git.graphHeight', axis: 'y', min: 120, max: 900, initial: 340 });
  /**
   * Whether the command log is showing.
   *
   * Remembered on a desktop, where it is one of the three views this page has
   * and leaving it on is a way of working. NOT remembered on a phone, where it
   * is a sheet over everything: a diagnostic panel that reopens itself on top
   * of the page every time you come back is not a preference anybody expressed.
   */
  const [logOpen, setLogOpen] = useState(() => !mobile && localStorage.getItem('git.logOpen') === '1');
  const showLog = useCallback(
    (next: boolean) => {
      setLogOpen(next);
      if (!mobile) localStorage.setItem('git.logOpen', next ? '1' : '0');
    },
    [mobile],
  );
  const toggleLog = useCallback(() => showLog(!logOpen), [showLog, logOpen]);
  /** The refs sheet, which on a desktop is the column that is simply there. */
  const [refsOpen, setRefsOpen] = useState(false);
  useBackDismiss(mobile && refsOpen, () => setRefsOpen(false));

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
        // The entry's own state travels with it. A replace that dropped it
        // would take the `gitCommit` flag off the entry the commit sheet is
        // standing on, and Close would stop knowing it may simply go back —
        // read from `history` rather than from a hook so this keeps one
        // identity for the life of the page.
        { replace: true, state: (window.history.state as { usr?: unknown } | null)?.usr },
      );
    },
    [setSearchParams],
  );

  // This page has NO bare-key shortcuts, deliberately. Everything here can
  // change a repository, and a stray keypress that switches panes or runs
  // something is not a trade worth making for a keystroke saved: every action
  // has a control you can see, and that is the only way to reach it.

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
  /**
   * On a phone the commit's detail is a sheet over the graph, and **it is a
   * history entry of its own rather than a marker** — the one layer on this
   * page whose openness already lives in the URL, which is the case
   * `docs/AI_MOBILE.md` says to make a route instead of inventing Back for it.
   *
   * It was the other way round for one commit and produced the bug that names
   * this one: the sheet pushed a marker, and Close then did
   * `setSearchParams(replace)` on top of that marker — replacing the URL AND
   * the marker's state, while the entry underneath still carried `?c=`. So the
   * sheet closed, and the next Back re-opened the commit you had just closed.
   * Replacing a marker is not something `useBackDismiss` can defend against;
   * not needing one is.
   *
   * So: choosing a commit PUSHES, Back pops it, and Close does the same pop
   * itself — `openedHere` is how it knows it may. Arriving on a link straight
   * to `?c=` sets no flag, so there Close drops the parameter instead and Back
   * leaves the page, which is the only honest answer when the entry underneath
   * belongs to whoever sent the link.
   */
  const openedHere = (location.state as { gitCommit?: boolean } | null)?.gitCommit === true;
  const detailOpen = mobile && !!selectedSha;
  const closeDetail = useCallback(() => {
    if (openedHere) navigate(-1);
    else setParam('c', null);
  }, [openedHere, navigate, setParam]);

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
  // Only so the sheet's header can carry the subject. Same key as the one
  // `CommitDetail` uses, so TanStack serves both from one request.
  const openCommit = useQuery({
    queryKey: ['git', 'commit', repoId, selectedSha],
    queryFn: () => gitApi.commit(repoId as string, selectedSha as string),
    enabled: enabled && !!selectedSha,
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

  const refs = (
    <RefSidebar
      repoId={repoId}
      status={status}
      branches={branchesQ.data}
      tags={tagsQ.data}
      stashes={stashesQ.data}
      worktrees={worktreesQ.data}
      selectedRef={selectedRef}
      onSelectRef={(ref) => {
        setParam('ref', ref);
        setRefsOpen(false);
      }}
    />
  );

  const detail = repoId && selectedSha && (
    <CommitDetail repoId={repoId} sha={selectedSha} status={status} />
  );

  return (
    <div className="flex h-full">
      {/* The refs column, and on a phone the sheet the toolbar's branch chip opens. */}
      {!mobile && (
        <>
          <aside
            style={{ width: sidebar.size }}
            className="h-full shrink-0 overflow-hidden border-r border-[var(--border)]"
          >
            {refs}
          </aside>
          <div
            onMouseDown={sidebar.onMouseDown}
            className="h-full w-1 shrink-0 cursor-col-resize hover:bg-[var(--accent-dim)]"
            title="Drag to resize"
          />
        </>
      )}
      {mobile && refsOpen && (
        <Sheet title="Branches, remotes, tags, stashes" onClose={() => setRefsOpen(false)}>
          {/* The sheet already scrolls; the sidebar must not scroll inside it. */}
          <div className="-mx-3">{refs}</div>
        </Sheet>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* No heading row: the bottom bar's own Git tab lights for this page,
            which is where somebody looks to find out where they are. */}
        <GitToolbar
          overview={overviewQ.data}
          repoId={repoId}
          status={status}
          onPick={(id) => setParam('repo', id)}
          onChanged={() => void overviewQ.refetch()}
          logOpen={logOpen}
          onToggleLog={toggleLog}
          tab={tab}
          onTab={(next) => {
            // The three are one choice about what is on screen, so picking a
            // side of the repository is also how you leave the log.
            showLog(false);
            setParam('tab', next === 'work' ? 'work' : null);
          }}
          onOpenRefs={mobile ? () => setRefsOpen(true) : undefined}
        />
        <RepoStateBanner repoId={repoId} status={status} />

        {!mobile && logOpen ? (
          <CommandLogPanel open onClose={() => showLog(false)} repoId={repoId} />
        ) : !repoId ? (
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
                <span className="min-w-0 truncate font-mono text-[var(--accent)]">{selectedRef}</span>
                <button
                  type="button"
                  onClick={() => setParam('ref', null)}
                  className="shrink-0 cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)] max-md:min-h-10 max-md:px-2"
                >
                  show everything
                </button>
              </div>
            )}

            {/* On a phone the graph takes the whole page and the commit opens
                over it; on a desktop they share the column, split by a handle. */}
            <div
              style={mobile ? undefined : { height: graph.size }}
              className={mobile ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 shrink-0 overflow-hidden'}
            >
              <GraphList
                repoId={repoId}
                refFilter={selectedRef}
                selected={selectedSha}
                headSha={status?.headSha}
                onSelect={(sha) => {
                  setSearchParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      next.set('c', sha);
                      return next;
                    },
                    // On a phone this OPENS something over the page, so it is a
                    // step Back has to be able to undo; on a desktop it fills a
                    // pane that is already there, and a history entry per click
                    // down a graph would be a Back button that takes a minute to
                    // get out of the page.
                    mobile ? { state: { gitCommit: true } } : { replace: true },
                  );
                }}
              />
            </div>

            {!mobile && (
              <>
                <div
                  onMouseDown={graph.onMouseDown}
                  className="h-1 w-full shrink-0 cursor-row-resize border-y border-[var(--border)] hover:bg-[var(--accent-dim)]"
                  title="Drag to resize"
                />

                <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
                  {statusQ.isError && (
                    <p className="text-red-400">Could not read this repository: {String(statusQ.error)}</p>
                  )}
                  {detail ?? (
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

            {/* The subject is the header's second line, so the pane below it
                can lead with the buttons instead of repeating it. Read from the
                cache rather than passed down: `CommitDetail` asks for the same
                query key, so this costs no request. */}
            {detailOpen && (
              <Sheet
                title={`Commit ${selectedSha?.slice(0, 7)}`}
                subtitle={openCommit.data?.commit.subject}
                onClose={closeDetail}
              >
                <div className="pt-2 text-xs">{detail}</div>
              </Sheet>
            )}
          </>
        )}

        {/* On a phone it is a sheet over the page, so it is rendered beside the
            column rather than inside it; on a desktop it IS the column, above. */}
        {mobile && <CommandLogPanel open={logOpen} onClose={() => showLog(false)} repoId={repoId} />}
      </div>
    </div>
  );
}
