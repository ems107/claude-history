import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { FilterSidebar } from '../components/list/FilterSidebar.tsx';
import { SessionRow } from '../components/list/SessionRow.tsx';
import { SortBar } from '../components/list/SortBar.tsx';
import { applyFilters, filtersToParams, parseFilters, type FilterState } from '../lib/filters.ts';

const ROW_HEIGHT = 64;
const FALLBACK_COLOR = 'hsl(0 0% 55%)';

export function SessionListPage() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const setFilters = useCallback(
    (f: FilterState) => setSearchParams(filtersToParams(f), { replace: true }),
    [setSearchParams],
  );

  const colorByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects.data ?? []) map.set(p.key, p.color);
    return map;
  }, [projects.data]);

  const rows = useMemo(() => applyFilters(sessions.data ?? [], filters), [sessions.data, filters]);

  const onProjectClick = useCallback(
    (projectKey: string) => setFilters({ ...filters, projects: [projectKey] }),
    [filters, setFilters],
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (sessions.isLoading) {
    return <div className="p-8 text-[var(--text-dim)]">Scanning sessions…</div>;
  }
  if (sessions.isError) {
    return <div className="p-8 text-red-400">Failed to load sessions: {String(sessions.error)}</div>;
  }

  return (
    <div className="flex h-full">
      {sidebarOpen && (
        <FilterSidebar
          sessions={sessions.data ?? []}
          projects={projects.data ?? []}
          filters={filters}
          onChange={setFilters}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <SortBar filters={filters} onChange={setFilters} resultCount={rows.length} totalCount={sessions.data?.length ?? 0}>
          <button
            type="button"
            title={sidebarOpen ? 'Hide filters' : 'Show filters'}
            onClick={() => setSidebarOpen((v) => !v)}
            className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
          >
            ☰
          </button>
        </SortBar>
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-dim)]">No sessions match the current filters.</div>
          ) : (
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const session = rows[vi.index];
                return (
                  <div
                    key={session.id}
                    className="absolute top-0 left-0 w-full"
                    style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                  >
                    <SessionRow
                      session={session}
                      color={colorByProject.get(session.projectKey) ?? FALLBACK_COLOR}
                      onProjectClick={onProjectClick}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
