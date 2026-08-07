import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { FilterSidebar } from '../components/list/FilterSidebar.tsx';
import { SearchBox } from '../components/list/SearchBox.tsx';
import { SearchResults } from '../components/list/SearchResults.tsx';
import { SessionRow } from '../components/list/SessionRow.tsx';
import { SortBar } from '../components/list/SortBar.tsx';
import { applyFilters, buildRows, filtersToParams, parseFilters, type FilterState } from '../lib/filters.ts';
import { saveListParams, saveListScroll, savedListScroll } from '../lib/listState.ts';

const ROW_HEIGHT = 64;
const HEADER_HEIGHT = 30;
const FALLBACK_COLOR = 'hsl(0 0% 55%)';

const SEARCH_SCOPES: Array<[string, string]> = [
  ['', 'Everywhere'],
  ['title', 'Titles'],
  ['user', 'My prompts'],
  ['assistant', 'Responses'],
];

export function SessionListPage() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('sidebarWidth')) || 256);

  // Remember filters/search + scroll so navigating into a session and back
  // restores the list exactly as it was.
  useEffect(() => saveListParams(searchParams.toString()), [searchParams]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = Number(localStorage.getItem('sidebarWidth')) || 256;
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(520, Math.max(180, startWidth + ev.clientX - startX));
      setSidebarWidth(w);
      localStorage.setItem('sidebarWidth', String(w));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const q = searchParams.get('q') ?? '';
  const setFilters = useCallback(
    (f: FilterState) => {
      const sp = filtersToParams(f);
      const current = new URLSearchParams(window.location.search);
      if (current.get('q')) sp.set('q', current.get('q')!);
      if (current.get('in')) sp.set('in', current.get('in')!);
      setSearchParams(sp, { replace: true });
    },
    [setSearchParams],
  );
  const setQ = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          if (value) sp.set('q', value);
          else sp.delete('q');
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const scope = searchParams.get('in') ?? '';
  const setScope = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          if (value) sp.set('in', value);
          else sp.delete('in');
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const searchActive = q.trim().length >= 2;
  const searchQuery = useQuery({
    queryKey: ['search', q, scope],
    queryFn: () => api.search(q, scope),
    enabled: searchActive,
  });

  const colorByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects.data ?? []) map.set(p.key, p.color);
    return map;
  }, [projects.data]);

  const matching = useMemo(() => applyFilters(sessions.data ?? [], filters), [sessions.data, filters]);
  const rows = useMemo(
    () => buildRows(matching, filters.group, filters.sort, colorByProject),
    [matching, filters.group, filters.sort, colorByProject],
  );
  const summaryMap = useMemo(() => new Map((sessions.data ?? []).map((s) => [s.id, s])), [sessions.data]);
  const visibleIds = useMemo(() => new Set(matching.map((s) => s.id)), [matching]);

  const onProjectClick = useCallback(
    (projectKey: string) => setFilters({ ...filters, projects: [projectKey] }),
    [filters, setFilters],
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 12,
  });

  // Restore the scroll offset once, when data is first available.
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (scrollRestored.current || !sessions.data || !parentRef.current) return;
    scrollRestored.current = true;
    parentRef.current.scrollTop = savedListScroll();
  }, [sessions.data]);

  // Keyboard navigation: j/k or arrows move, Enter opens, / focuses search.
  const navigate = useNavigate();
  const [selected, setSelected] = useState(-1);
  useEffect(() => setSelected(-1), [rows]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
        return;
      }
      if (searchActive) return;
      if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1;
        setSelected((prev) => {
          // Group headers are rows too, but never selectable.
          let next = prev + step;
          while (next >= 0 && next < rows.length && rows[next].kind === 'header') next += step;
          if (next < 0 || next >= rows.length) return prev;
          virtualizer.scrollToIndex(next);
          return next;
        });
      } else if (e.key === 'Enter') {
        setSelected((prev) => {
          const row = rows[prev];
          if (row?.kind === 'session') navigate(`/session/${row.id}`);
          return prev;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, searchActive, navigate, virtualizer]);

  if (sessions.isLoading) {
    return <div className="p-8 text-[var(--text-dim)]">Scanning sessions…</div>;
  }
  if (sessions.isError) {
    return <div className="p-8 text-red-400">Failed to load sessions: {String(sessions.error)}</div>;
  }

  return (
    <div className="flex h-full">
      {sidebarOpen && (
        <>
          <div style={{ width: sidebarWidth }} className="h-full shrink-0">
            <FilterSidebar
              sessions={sessions.data ?? []}
              projects={projects.data ?? []}
              filters={filters}
              onChange={setFilters}
            />
          </div>
          <div
            className="h-full w-1 shrink-0 cursor-col-resize hover:bg-[var(--accent-dim)]"
            onMouseDown={startResize}
            title="Drag to resize"
          />
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <SortBar
          filters={filters}
          onChange={setFilters}
          resultCount={matching.length}
          totalCount={sessions.data?.length ?? 0}
        >
          <button
            type="button"
            title={sidebarOpen ? 'Hide filters' : 'Show filters'}
            onClick={() => setSidebarOpen((v) => !v)}
            className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
          >
            ☰
          </button>
          <SearchBox value={q} onChange={setQ} />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            title="Where to search"
            className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-1 text-xs text-[var(--text-dim)]"
          >
            {SEARCH_SCOPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </SortBar>
        <div
          ref={parentRef}
          onScroll={(e) => saveListScroll(e.currentTarget.scrollTop)}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {searchActive ? (
            searchQuery.isLoading ? (
              <div className="p-8 text-center text-[var(--text-dim)]">Searching…</div>
            ) : searchQuery.isError ? (
              <div className="p-8 text-center text-red-400">Search failed: {String(searchQuery.error)}</div>
            ) : (
              <SearchResults
                response={searchQuery.data!}
                summaries={summaryMap}
                colorByProject={colorByProject}
                visibleIds={visibleIds}
                onProjectClick={onProjectClick}
              />
            )
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-dim)]">No sessions match the current filters.</div>
          ) : (
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const row = rows[vi.index];
                return (
                  <div
                    key={row.id}
                    className={`absolute top-0 left-0 w-full ${vi.index === selected ? 'bg-[var(--bg-hover)]' : ''}`}
                    style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                  >
                    {row.kind === 'header' ? (
                      <div className="flex h-full items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-raised)] px-4 text-xs font-semibold tracking-wide text-[var(--text-dim)] uppercase">
                        {row.color && (
                          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                        )}
                        <span className="truncate">{row.label}</span>
                        <span className="font-normal opacity-60">{row.count}</span>
                      </div>
                    ) : (
                      <SessionRow
                        session={row.session}
                        color={colorByProject.get(row.session.projectKey) ?? FALLBACK_COLOR}
                        onProjectClick={onProjectClick}
                      />
                    )}
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
