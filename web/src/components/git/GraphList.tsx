import { GIT_LOG_PAGE } from '@claude-history/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef } from 'react';
import { gitApi } from '../../api/git.ts';
import { ROW_H, graphWidth, layoutGraph } from '../../lib/gitGraph.ts';
import { btn } from '../../lib/ui.ts';
import { GraphRow } from './GraphRow.tsx';

/**
 * The commit list, virtualised, with the lane layout computed over everything
 * loaded so far.
 *
 * The layout is recomputed from the top on each page rather than resumed from
 * saved lane state. That is deliberate: it is a pure function of the commit
 * list, so it cannot drift out of step with what is on screen, and a few
 * thousand rows of it is microseconds. Resuming would mean carrying layout
 * state that has to stay correct across a refetch, which is the kind of state
 * that goes wrong quietly.
 */
export function GraphList({
  repoId,
  refFilter,
  selected,
  onSelect,
}: {
  repoId: string;
  refFilter: string | null;
  selected: string | null;
  onSelect: (sha: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const query = useInfiniteQuery({
    queryKey: ['git', 'log', repoId, refFilter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => gitApi.log(repoId, { offset: pageParam as number, ref: refFilter }),
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.commits.length : undefined),
  });

  const commits = useMemo(() => query.data?.pages.flatMap((p) => p.commits) ?? [], [query.data]);
  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const graphW = graphWidth(layout.maxLane);

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
  });

  if (query.isLoading) return <div className="p-4 text-xs text-[var(--text-dim)]">Reading the history…</div>;
  if (query.isError) {
    return <div className="p-4 text-xs text-red-400">Could not read the history: {String(query.error)}</div>;
  }
  if (commits.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--text-dim)]">
        {refFilter ? `Nothing on ${refFilter}.` : 'No commits yet.'}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const commit = commits[item.index];
          const row = layout.rows[item.index];
          if (!commit || !row) return null;
          return (
            <div
              key={commit.sha}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <GraphRow
                commit={commit}
                layout={row}
                graphW={graphW}
                selected={selected === commit.sha}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
      {query.hasNextPage && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            className={btn}
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : `Load ${GIT_LOG_PAGE} more`}
          </button>
        </div>
      )}
    </div>
  );
}
