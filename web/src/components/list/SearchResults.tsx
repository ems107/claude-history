import type { SearchQueryEcho, SearchResponse, SessionSummary } from '@claude-history/shared';
import { Link } from 'react-router';
import { SessionRow } from './SessionRow.tsx';

/**
 * What the server actually looked for. With several terms and a scope, "0
 * matches" on its own leaves the reason to guesswork — and a term dropped for
 * being one character long would otherwise vanish without a word.
 */
function describeQuery(query: SearchQueryEcho): string | null {
  if (query.mode === 'phrase') return query.wholeWord ? 'whole words' : null;
  const where = query.scope === 'session' ? 'anywhere in the session' : 'in the same message';
  const words = `${query.terms.length} ${query.terms.length === 1 ? 'term' : 'words'}, all ${where}`;
  return query.wholeWord ? `${words} · whole words` : words;
}

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
  const description = describeQuery(response.query);
  const nothingToLookFor = response.query.terms.length === 0;

  return (
    <div>
      <div className="border-b border-[var(--border)] px-4 py-1.5 text-xs text-[var(--text-dim)]">
        {description && <span className="mr-2 text-[var(--text)]">{description}</span>}
        {totalMatches} matches in {hits.length} sessions · {response.tookMs} ms
        {!response.indexComplete && (
          <span className="ml-2 text-amber-400">(index still building — partial results)</span>
        )}
      </div>
      {hits.length === 0 && (
        <div className="p-8 text-center text-[var(--text-dim)]">
          {nothingToLookFor ? 'Nothing to look for — a term needs at least two characters.' : 'No matches.'}
        </div>
      )}
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
                  {sn.parts.map((part, pi) =>
                    part.hit ? (
                      <mark key={pi} className="rounded-sm bg-[var(--accent)]/30 px-0.5 text-[var(--text)]">
                        {part.text}
                      </mark>
                    ) : (
                      <span key={pi}>{part.text}</span>
                    ),
                  )}
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
