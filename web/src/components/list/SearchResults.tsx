import type { SearchResponse, SessionSummary } from '@claude-history/shared';
import { Link } from 'react-router';
import { SessionRow } from './SessionRow.tsx';

export function SearchResults({
  response,
  summaries,
  colorByProject,
  visibleIds,
  onProjectClick,
}: {
  response: SearchResponse;
  summaries: Map<string, SessionSummary>;
  colorByProject: Map<string, string>;
  /** Sessions surviving the active sidebar filters; hits outside are hidden. */
  visibleIds: Set<string>;
  onProjectClick?: (projectKey: string) => void;
}) {
  const hits = response.hits.filter((h) => visibleIds.has(h.sessionId) && summaries.has(h.sessionId));
  const totalMatches = hits.reduce((acc, h) => acc + h.matchCount, 0);

  return (
    <div>
      <div className="border-b border-[var(--border)] px-4 py-1.5 text-xs text-[var(--text-dim)]">
        {totalMatches} matches in {hits.length} sessions · {response.tookMs} ms
        {!response.indexComplete && <span className="ml-2 text-amber-400">(index still building — partial results)</span>}
      </div>
      {hits.length === 0 && <div className="p-8 text-center text-[var(--text-dim)]">No matches.</div>}
      {hits.map((hit) => {
        const session = summaries.get(hit.sessionId)!;
        return (
          <div key={hit.sessionId} className="border-b border-[var(--border)]">
            <div className="h-16">
              <SessionRow
                session={session}
                color={colorByProject.get(session.projectKey) ?? 'hsl(0 0% 55%)'}
                onProjectClick={onProjectClick}
              />
            </div>
            <div className="space-y-1 px-6 pt-1 pb-3">
              {hit.snippets.map((sn, i) => (
                <Link
                  key={i}
                  to={`/session/${hit.sessionId}${sn.uuid ? `?msg=${sn.uuid}` : ''}`}
                  className="block truncate rounded px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
                >
                  <span className="mr-2 inline-block w-14 shrink-0 text-right font-semibold text-[var(--text-dim)]/70 uppercase">
                    {sn.role}
                  </span>
                  {sn.before}
                  <mark className="rounded-sm bg-[var(--accent)]/30 px-0.5 text-[var(--text)]">{sn.match}</mark>
                  {sn.after}
                </Link>
              ))}
              {hit.matchCount > hit.snippets.length && (
                <div className="px-2 text-[11px] text-[var(--text-dim)]/70">
                  +{hit.matchCount - hit.snippets.length} more matches
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
