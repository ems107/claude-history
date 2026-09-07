import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { FilterSidebar } from '../components/list/FilterSidebar.tsx';
import { MobileListBar } from '../components/list/MobileListBar.tsx';
import { SearchBox } from '../components/list/SearchBox.tsx';
import { SearchOptions } from '../components/list/SearchOptions.tsx';
import { SearchResults } from '../components/list/SearchResults.tsx';
import { SessionRow } from '../components/list/SessionRow.tsx';
import { SortBar } from '../components/list/SortBar.tsx';
import { actionClass } from '../components/controlClass.ts';
import {
  activeFilterCount,
  applyFilters,
  buildRows,
  DEFAULT_FILTERS,
  filtersToParams,
  parseFilters,
  type FilterState,
} from '../lib/filters.ts';
import { saveListParams, saveListScroll, savedListScroll } from '../lib/listState.ts';
import { MOBILE_QUERY, useBackDismiss, useIsMobile } from '../lib/mobile.ts';
import {
  applyTuning,
  parseTuning,
  SEARCH_PARAMS,
  type SearchTuning,
  tuningChanges,
} from '../lib/searchTuning.ts';

const ROW_HEIGHT = 64;
/**
 * The same row on a phone, where it is three lines instead of one: the title,
 * the metadata wrapped under it, and the badges when there are any.
 *
 * Both of these are GUESSES rather than heights, and the difference matters:
 * **every row is measured** (`virtualizer.measureElement`), because a row's
 * height is decided by how much of it wraps, and that is decided by the width.
 * At 360px the tallest — a long project name, five metadata items and two
 * badges — is half again the shortest. At 1000px, which is this phone held
 * sideways, a desktop row wraps to two lines and overflowed the 64 it was
 * being told to be: rows drawn on top of each other. Above about 1200 nothing
 * wraps and the measurement comes back as exactly the estimate, so the wide
 * desktop pays a layout read per visible row and changes by nothing.
 *
 * The estimate still matters — it is what the scrollbar is sized from before a
 * row has been drawn — which is why there are two of them.
 */
const ROW_HEIGHT_MOBILE = 88;
const HEADER_HEIGHT = 30;
const FALLBACK_COLOR = 'hsl(0 0% 55%)';

export function SessionListPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [searchParams, setSearchParams] = useSearchParams();
  const mobile = useIsMobile();
  // Open on a desktop, where it is a column beside the list; closed on a phone,
  // where it is a sheet over it and would otherwise be the first thing anybody
  // saw. Read once, from the media query rather than from `mobile`, because
  // this is an initial value and `useIsMobile` has not answered yet on the
  // first render.
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia(MOBILE_QUERY).matches);
  // Android's Back closes the sheet instead of leaving the list.
  useBackDismiss(mobile && sidebarOpen, () => setSidebarOpen(false));
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('sidebarWidth')) || 256);

  // Remember filters/search + scroll so navigating into a session and back
  // restores the list exactly as it was.
  useEffect(() => saveListParams(searchParams.toString()), [searchParams]);

  // Pointer events rather than mouse ones, for the same reason as the seams on
  // the other side of the app (`trackPointer`): one gesture covers a mouse, a
  // pen and a finger, and the capture keeps the drag alive when the pointer
  // wanders off a 4px target. This particular seam is never reachable on a
  // phone — the sidebar is a sheet there, not a column — but a narrow window on
  // a touchscreen laptop is the same handle, and it used to be dead.
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const seam = e.currentTarget as HTMLElement;
    const id = e.pointerId;
    const startX = e.clientX;
    const startWidth = Number(localStorage.getItem('sidebarWidth')) || 256;
    try {
      seam.setPointerCapture(id);
    } catch {
      // The pointer is already gone; the listeners below still tidy themselves.
    }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const w = Math.min(520, Math.max(180, startWidth + ev.clientX - startX));
      setSidebarWidth(w);
      localStorage.setItem('sidebarWidth', String(w));
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, []);

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const filterCount = activeFilterCount(filters);
  const q = searchParams.get('q') ?? '';
  const setFilters = useCallback(
    (f: FilterState) => {
      const sp = filtersToParams(f);
      const current = new URLSearchParams(window.location.search);
      // Filters are rebuilt from scratch, so everything the search owns has to
      // be carried across or changing a filter would quietly reset the search.
      for (const key of SEARCH_PARAMS) {
        const value = current.get(key);
        if (value) sp.set(key, value);
      }
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

  const tuning = useMemo(() => parseTuning(searchParams), [searchParams]);
  const setTuning = useCallback(
    (value: SearchTuning) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          applyTuning(sp, value);
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // A tuning restored from the URL opens the panel: it is already affecting the
  // results, so it has to be where the results are explained.
  const [optionsOpen, setOptionsOpen] = useState(() => tuningChanges(parseTuning(searchParams)) > 0);
  const tunedCount = tuningChanges(tuning);

  const searchActive = q.trim().length >= 2;
  const searchQuery = useQuery({
    queryKey: ['search', q, tuning.where, tuning.mode, tuning.scope, tuning.wholeWord],
    queryFn: () => api.search(q, tuning),
    enabled: searchActive,
  });

  // A deep scan belongs to one exact question, and the querystring is the whole
  // of it — query, tuning and filters alike. Change any of them and the deep
  // result steps aside for the plain one, offer included.
  const askedFor = searchParams.toString();
  const [deepAskedFor, setDeepAskedFor] = useState<string | null>(null);
  const deepAsked = deepAskedFor === askedFor;

  const colorByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects.data ?? []) map.set(p.key, p.color);
    return map;
  }, [projects.data]);

  // Same query the rows use for their own figure — sorting by cost has to see
  // the very prices they display.
  const prices = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  const matching = useMemo(
    () => applyFilters(sessions.data ?? [], filters, prices.data?.prices),
    [sessions.data, filters, prices.data],
  );
  const rows = useMemo(
    () => buildRows(matching, filters.group, filters.sort, colorByProject),
    [matching, filters.group, filters.sort, colorByProject],
  );
  const summaryMap = useMemo(() => new Map((sessions.data ?? []).map((s) => [s.id, s])), [sessions.data]);
  const visibleIds = useMemo(() => new Set(matching.map((s) => s.id)), [matching]);

  const deepQuery = useQuery({
    queryKey: ['search-deep', askedFor],
    // Only the sessions the filters left standing: the scan reads transcripts,
    // and reading the ones already hidden would be seconds spent on nothing.
    queryFn: ({ signal }) => api.deepSearch(q, tuning, [...visibleIds], signal),
    enabled: searchActive && deepAsked,
    // Four seconds of transcript reading must never happen behind the user's
    // back, so nothing but the button may set it off.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const deepResponse = deepAsked ? deepQuery.data : undefined;

  const onProjectClick = useCallback(
    (projectKey: string) => setFilters({ ...filters, projects: [projectKey] }),
    [filters, setFilters],
  );

  /**
   * Drop project filters that name nothing.
   *
   * A key in `?projects=` with no project behind it filters the list down to
   * nothing, and there is no checkbox left to untick it with — the desktop
   * column has no "Clear all", and `saveListParams` puts the dead filter back
   * every time you come out of a session, so it survives being navigated away
   * from. Hiding a project in Settings is the ordinary way to arrive there, and
   * a project whose transcripts `~/.claude` has swept is the other.
   *
   * **Gated on the query having ANSWERED**, or a deep link would wipe its own
   * filter on the render before the projects arrive. `replace: true` (which
   * `setFilters` uses) keeps it out of the history: nothing was navigated, a
   * URL was corrected.
   */
  useEffect(() => {
    if (!projects.isSuccess || filters.projects.length === 0) return;
    const known = new Set(projects.data.map((p) => p.key));
    const live = filters.projects.filter((key) => known.has(key));
    if (live.length !== filters.projects.length) setFilters({ ...filters, projects: live });
  }, [projects.isSuccess, projects.data, filters, setFilters]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? HEADER_HEIGHT : mobile ? ROW_HEIGHT_MOBILE : ROW_HEIGHT),
    overscan: 12,
  });

  // A row is a different height on a phone, and the virtualizer remembers the
  // one it was told: without this, a window dragged across the breakpoint keeps
  // the old offsets and every row after the first is drawn in the wrong place.
  // It also throws away the measurements taken on the other side of the line.
  useEffect(() => virtualizer.measure(), [mobile, virtualizer]);

  // Restore the scroll offset once, when data is first available.
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (scrollRestored.current || !sessions.data || !parentRef.current) return;
    scrollRestored.current = true;
    parentRef.current.scrollTop = savedListScroll();
  }, [sessions.data]);

  // Keyboard navigation: j/k or arrows move, Enter opens, / focuses search.
  const navigate = useNavigate();
  /**
   * The selection is a SESSION, not a position. It used to be the index, reset
   * to -1 whenever `rows` changed identity — which is every refetch, and with a
   * live session that is every couple of seconds: the highlight under the row
   * you had just moved to went out on its own while you looked at it. The index
   * is derived instead, so the row keeps its highlight through a refetch that
   * reordered it, and -1 comes back only when that session is genuinely no
   * longer in the list.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId === null ? -1 : rows.findIndex((r) => r.kind === 'session' && r.id === selectedId);
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
        // Group headers are rows too, but never selectable.
        let next = selected + step;
        while (next >= 0 && next < rows.length && rows[next].kind === 'header') next += step;
        if (next < 0 || next >= rows.length) return;
        virtualizer.scrollToIndex(next);
        const row = rows[next];
        if (row.kind === 'session') setSelectedId(row.id);
      } else if (e.key === 'Enter') {
        const row = rows[selected];
        if (row?.kind === 'session') navigate(`/session/${row.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, searchActive, navigate, virtualizer, selected]);

  if (sessions.isLoading) {
    return <div className="p-8 text-[var(--text-dim)]">Scanning sessions…</div>;
  }
  if (sessions.isError) {
    return <div className="p-8 text-red-400">Failed to load sessions: {String(sessions.error)}</div>;
  }

  const sidebar = (
    <FilterSidebar
      sessions={sessions.data ?? []}
      projects={projects.data ?? []}
      filters={filters}
      onChange={setFilters}
    />
  );

  return (
    <div className="flex h-full">
      {sidebarOpen &&
        (mobile ? (
          /* A 256px column is 70% of a 360px screen, so on a phone the filters
             are a sheet OVER the list rather than a slice of it — full screen,
             because there are six sections in here and every one of them wants
             the width. It closes with Done or with Android's Back. */
          <div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg)]">
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
              <h2 className="min-w-0 flex-1 text-sm font-semibold">Filters</h2>
              {filterCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir, group: filters.group })}
                  className={actionClass}
                >
                  Clear all
                </button>
              )}
              <button type="button" onClick={() => setSidebarOpen(false)} className={actionClass}>
                Done
              </button>
            </div>
            <div className="min-h-0 flex-1">{sidebar}</div>
          </div>
        ) : (
          <>
            <div style={{ width: sidebarWidth }} className="h-full shrink-0">
              {sidebar}
            </div>
            <div
              className="h-full w-1 shrink-0 cursor-col-resize touch-none hover:bg-[var(--accent-dim)]"
              onPointerDown={startResize}
              title="Drag to resize"
            />
          </>
        ))}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* One line and three square buttons on a phone, seven controls in a
            row on a desktop. A branch rather than one markup restyled: the
            phone's bar puts the count in the search placeholder and the
            grouping behind a sheet, which is not the same row narrower. */}
        {mobile ? (
          <MobileListBar
            filters={filters}
            onChange={setFilters}
            resultCount={matching.length}
            totalCount={sessions.data?.length ?? 0}
            q={q}
            onQ={setQ}
            filterCount={filterCount}
            filtersOpen={sidebarOpen}
            onToggleFilters={() => setSidebarOpen((v) => !v)}
            tunedCount={tunedCount}
            optionsOpen={optionsOpen}
            onToggleOptions={() => setOptionsOpen((v) => !v)}
          />
        ) : (
          <SortBar
            filters={filters}
            onChange={setFilters}
            resultCount={matching.length}
            totalCount={sessions.data?.length ?? 0}
          >
            <button
              type="button"
              title={sidebarOpen ? 'Hide filters' : 'Show filters'}
              aria-label={sidebarOpen ? 'Hide filters' : 'Show filters'}
              onClick={() => setSidebarOpen((v) => !v)}
              className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-xs hover:border-[var(--text-dim)] ${
                filterCount > 0
                  ? 'border-[var(--accent-dim)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-dim)]'
              }`}
            >
              ☰
              {filterCount > 0 && <span className="font-mono text-[11px]">{filterCount}</span>}
            </button>
            <SearchBox value={q} onChange={setQ} />
            <button
              type="button"
              onClick={() => setOptionsOpen((v) => !v)}
              title={
                tunedCount > 0 ? 'Advanced search — options are changing these results' : 'Advanced search options'
              }
              className={`cursor-pointer rounded border px-1.5 py-1 text-xs whitespace-nowrap ${
                tunedCount > 0
                  ? 'border-[var(--accent-dim)] text-[var(--text)]'
                  : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
              }`}
            >
              {/* The count is what keeps a collapsed panel from changing results in silence. */}
              Advanced{tunedCount > 0 && ` · ${tunedCount}`} {optionsOpen ? '▴' : '▾'}
            </button>
          </SortBar>
        )}
        {optionsOpen && <SearchOptions tuning={tuning} onChange={setTuning} />}
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
                response={deepResponse ?? searchQuery.data!}
                q={q}
                tuning={tuning}
                summaries={summaryMap}
                colorByProject={colorByProject}
                visibleIds={visibleIds}
                onProjectClick={onProjectClick}
                onDeepSearch={
                  deepResponse
                    ? undefined
                    : () => {
                        // Asking again after a failure leaves the signature
                        // unchanged, so the state alone would refetch nothing and
                        // the button would sit there doing exactly that.
                        if (deepAsked) void deepQuery.refetch();
                        else setDeepAskedFor(askedFor);
                      }
                }
                onDeepCancel={() => {
                  // Aborts the fetch, which is what the server watches to stop
                  // reading; forgetting the signature puts the offer back.
                  void queryClient.cancelQueries({ queryKey: ['search-deep', askedFor] });
                  setDeepAskedFor(null);
                }}
                deepPending={deepAsked && deepQuery.isFetching}
                deepError={deepAsked && deepQuery.isError ? String(deepQuery.error) : undefined}
              />
            )
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-dim)]">No sessions match the current filters.</div>
          ) : (
            <div
              // Remounted across the breakpoint, and it has to be. A measured
              // row keeps its ResizeObserver until the ELEMENT leaves the DOM —
              // `measureElement(null)` only releases nodes that are already
              // disconnected — so merely dropping the ref left every row still
              // observed. On the desktop side the wrapper is then given an
              // inline height from the cache, the observer reads that height
              // back and writes it in again, and the mobile measurements pin
              // themselves in place: a 1440px window drawing 114px rows.
              // Remounting disconnects them, which is what makes the cleanup
              // fire and `virtualizer.measure()` stick.
              key={mobile ? 'phone' : 'desktop'}
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const row = rows[vi.index];
                return (
                  <div
                    key={row.id}
                    // Measured, always — see ROW_HEIGHT_MOBILE. `data-index` is
                    // what the measurer reads to know which row it just
                    // measured, and there must be no height on the box for
                    // there to be anything to measure.
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    className={`absolute top-0 left-0 w-full ${vi.index === selected ? 'bg-[var(--bg-hover)]' : ''}`}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    {row.kind === 'header' ? (
                      // `min-h` and not `h-full`: the box around this no longer
                      // carries a height for a percentage to resolve against,
                      // which is what makes it measurable.
                      <div className="flex min-h-[30px] items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-raised)] px-4 text-xs font-semibold tracking-wide text-[var(--text-dim)] uppercase max-md:min-h-8 max-md:px-3 max-md:py-1.5">
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
