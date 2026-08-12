import type { SearchSnippet } from '@claude-history/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import type { SearchTuning } from '../../lib/searchTuning.ts';
import { SnippetRow } from './SnippetRow.tsx';

/**
 * Places per click. A page of the indexed corpus is a few milliseconds, so it
 * stays small and reads like a list; a deep page re-streams the whole transcript
 * (seconds on the big ones), so it asks for four times as much per trip.
 */
const PAGE = 25;
const DEEP_PAGE = 100;

/**
 * Every place a query matched in one session, a page at a time — what the hit's
 * "+N more matches" opens. The search itself shows three snippets and counts the
 * rest, and that count used to be the end of the road: there was no way to reach
 * the matches it was talking about.
 *
 * Opening REPLACES those three rather than adding to them. They are picked one
 * per term so each word gets a slot, which is the right teaser and the wrong
 * beginning for a list: this one runs in the order the corpus is read, and the
 * count under it walks down to zero as the pages arrive.
 */
export function HitMatches({
  sessionId,
  q,
  tuning,
  deep,
  fallback,
  onCollapse,
}: {
  sessionId: string;
  q: string;
  tuning: SearchTuning;
  /** Must match how the results were obtained, or the count will not be reachable. */
  deep: boolean;
  /** The hit's own snippets, shown while the first page is on its way. */
  fallback: SearchSnippet[];
  onCollapse: () => void;
}) {
  const limit = deep ? DEEP_PAGE : PAGE;
  const query = useInfiniteQuery({
    queryKey: ['search-matches', sessionId, q, tuning.where, tuning.mode, tuning.scope, tuning.wholeWord, deep],
    queryFn: ({ pageParam, signal }) =>
      api.sessionMatches(sessionId, q, tuning, { offset: pageParam, limit, deep }, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const seen = last.offset + last.snippets.length;
      // An empty page ends it whatever the total says: a transcript that shrank
      // under us must not turn "show more" into a button that never finishes.
      return last.snippets.length > 0 && seen < last.total ? seen : undefined;
    },
    // A deep page costs seconds of transcript reading, so nothing but a click
    // may set one off — the same reason the deep search itself is pinned.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const pages = query.data?.pages ?? [];
  const last = pages[pages.length - 1];
  const snippets = pages.flatMap((p) => p.snippets);
  // Every occurrence belongs to exactly one place, so these add up to the total.
  const shown = pages.reduce((acc, p) => acc + p.pageMatches, 0);
  // The button counts ROWS, which is what the next click puts on the screen. A
  // count of matches there would overpromise: one row can carry several of them.
  const rowsLeft = last ? Math.max(0, last.total - snippets.length) : 0;
  const stoppedEarly = pages.some((p) => p.deep?.stoppedEarly);

  return (
    <div className="space-y-1">
      {(snippets.length > 0 ? snippets : fallback).map((sn, i) => (
        <SnippetRow key={i} sessionId={sessionId} snippet={sn} />
      ))}
      <div className="flex flex-wrap items-center gap-2 px-2 pt-0.5 text-[11px] text-[var(--text-dim)]/70">
        {query.isError ? (
          <span className="text-red-400">Could not read the matches: {String(query.error)}</span>
        ) : last ? (
          <span>
            {last.total === 0
              ? 'No matches left in this session — the transcript has changed.'
              : `${shown} of ${last.matchCount} matches`}
            {stoppedEarly && (
              <span className="text-amber-400"> — the scan stopped early, so this is partial</span>
            )}
          </span>
        ) : (
          <span className="text-[var(--accent)]">
            {deep ? 'reading the transcript…' : 'finding every match…'}
          </span>
        )}
        {query.isFetchingNextPage && <span className="text-[var(--accent)]">loading…</span>}
        {query.hasNextPage && !query.isFetchingNextPage && (
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            title={deep ? 'Reads the transcript again for the next batch' : 'The next batch of matches'}
            className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
          >
            Show {Math.min(rowsLeft, limit)} more
          </button>
        )}
        {query.isError && (
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
          >
            Try again
          </button>
        )}
        {/* A control, not a fold header: there is nothing inside it to copy. */}
        <button
          type="button"
          onClick={onCollapse}
          className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
        >
          Collapse
        </button>
      </div>
    </div>
  );
}
