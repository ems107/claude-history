import type { PriceTable, SessionSummary } from '@claude-history/shared';
import { sessionCost } from './cost.ts';

export type SortField = 'activity' | 'created' | 'messages' | 'size' | 'cost';
export type BadgeFilter = 'pinned' | 'live' | 'pr' | 'subagents' | 'fork' | 'bg';
export type GroupMode = 'none' | 'day' | 'project';

export interface FilterState {
  projects: string[]; // projectKeys; empty = all
  from: string | null; // last-activity range, yyyy-mm-dd
  to: string | null; // last-activity range, yyyy-mm-dd (inclusive)
  createdFrom: string | null; // created range, yyyy-mm-dd
  createdTo: string | null; // created range, yyyy-mm-dd (inclusive)
  entrypoints: string[];
  models: string[];
  badges: BadgeFilter[];
  showEmpty: boolean;
  sort: SortField;
  dir: 'asc' | 'desc';
  group: GroupMode;
}

export const DEFAULT_FILTERS: FilterState = {
  projects: [],
  from: null,
  to: null,
  createdFrom: null,
  createdTo: null,
  entrypoints: [],
  models: [],
  badges: [],
  showEmpty: false,
  sort: 'activity',
  dir: 'desc',
  group: 'none',
};

function csv(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

export function parseFilters(sp: URLSearchParams): FilterState {
  const sort = sp.get('sort');
  const dir = sp.get('dir');
  const group = sp.get('group');
  return {
    group: group === 'day' || group === 'project' ? group : 'none',
    projects: csv(sp.get('projects')),
    from: sp.get('from'),
    to: sp.get('to'),
    createdFrom: sp.get('cfrom'),
    createdTo: sp.get('cto'),
    entrypoints: csv(sp.get('entry')),
    models: csv(sp.get('model')),
    badges: csv(sp.get('badges')) as BadgeFilter[],
    showEmpty: sp.get('empty') === '1',
    sort: sort === 'created' || sort === 'messages' || sort === 'size' || sort === 'cost' ? sort : 'activity',
    dir: dir === 'asc' ? 'asc' : 'desc',
  };
}

export function filtersToParams(f: FilterState): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.projects.length) sp.set('projects', f.projects.join(','));
  if (f.from) sp.set('from', f.from);
  if (f.to) sp.set('to', f.to);
  if (f.createdFrom) sp.set('cfrom', f.createdFrom);
  if (f.createdTo) sp.set('cto', f.createdTo);
  if (f.entrypoints.length) sp.set('entry', f.entrypoints.join(','));
  if (f.models.length) sp.set('model', f.models.join(','));
  if (f.badges.length) sp.set('badges', f.badges.join(','));
  if (f.showEmpty) sp.set('empty', '1');
  if (f.sort !== 'activity') sp.set('sort', f.sort);
  if (f.dir !== 'desc') sp.set('dir', f.dir);
  if (f.group !== 'none') sp.set('group', f.group);
  return sp;
}

function activityMs(s: SessionSummary): number {
  return s.lastActivityAt ? Date.parse(s.lastActivityAt) : s.mtimeMs;
}

function createdMs(s: SessionSummary): number {
  return s.createdAt ? Date.parse(s.createdAt) : s.mtimeMs;
}

function hasBadge(s: SessionSummary, badge: BadgeFilter): boolean {
  switch (badge) {
    case 'pinned':
      return s.pinned;
    case 'live':
      return s.live !== null;
    case 'pr':
      return (s.enrichment?.prLinks.length ?? 0) > 0;
    case 'subagents':
      return s.subagentCount > 0;
    case 'fork':
      return s.enrichment?.forkedFrom != null;
    case 'bg':
      return s.isBackground;
  }
}

export function applyFilters(sessions: SessionSummary[], f: FilterState, prices: PriceTable = {}): SessionSummary[] {
  const projects = f.projects.length ? new Set(f.projects) : null;
  const entrypoints = f.entrypoints.length ? new Set(f.entrypoints) : null;
  const models = f.models.length ? new Set(f.models) : null;
  const fromMs = f.from ? Date.parse(`${f.from}T00:00:00`) : null;
  const toMs = f.to ? Date.parse(`${f.to}T23:59:59.999`) : null;
  const cFromMs = f.createdFrom ? Date.parse(`${f.createdFrom}T00:00:00`) : null;
  const cToMs = f.createdTo ? Date.parse(`${f.createdTo}T23:59:59.999`) : null;

  const filtered = sessions.filter((s) => {
    if (!f.showEmpty && s.isEmpty) return false;
    if (projects && !projects.has(s.projectKey)) return false;
    if (entrypoints && !(s.entrypoint && entrypoints.has(s.entrypoint))) return false;
    if (models && !(s.model && models.has(s.model))) return false;
    const activity = activityMs(s);
    if (fromMs !== null && activity < fromMs) return false;
    if (toMs !== null && activity > toMs) return false;
    const created = createdMs(s);
    if (cFromMs !== null && created < cFromMs) return false;
    if (cToMs !== null && created > cToMs) return false;
    for (const b of f.badges) if (!hasBadge(s, b)) return false;
    return true;
  });

  // Sessions with no known cost sort as -1, below a genuine $0, so they land
  // at the far end descending instead of pretending to be the cheapest.
  const key: (s: SessionSummary) => number =
    f.sort === 'created'
      ? createdMs
      : f.sort === 'messages'
        ? (s) => s.enrichment?.userMessageCount ?? s.messageCount ?? -1
        : f.sort === 'size'
          ? (s) => s.sizeBytes
          : f.sort === 'cost'
            ? (s) => sessionCost(s, prices) ?? -1
            : activityMs;

  const mul = f.dir === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => mul * (key(a) - key(b)));
}

// ---- Grouping ----

export type ListRow =
  | { kind: 'header'; id: string; label: string; count: number; color?: string }
  | { kind: 'session'; id: string; session: SessionSummary };

const DAY_MS = 24 * 3600_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today" / "Yesterday" / "Monday 04/08/2026" for a day bucket. */
function dayLabel(dayMs: number): string {
  const today = startOfDay(Date.now());
  if (dayMs === today) return 'Today';
  if (dayMs === today - DAY_MS) return 'Yesterday';
  const d = new Date(dayMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
  return `${weekday} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Turn a sorted session list into rows with group headers interleaved. Day
 * grouping follows whichever date the list is sorted by, so the headers always
 * match the order on screen; any other sort falls back to no grouping (headers
 * would appear out of order and mean nothing).
 */
export function buildRows(
  sessions: SessionSummary[],
  group: GroupMode,
  sort: SortField,
  projectColors?: Map<string, string>,
): ListRow[] {
  const rows: ListRow[] = [];
  if (group === 'none' || (group === 'day' && sort !== 'activity' && sort !== 'created')) {
    return sessions.map((s) => ({ kind: 'session', id: s.id, session: s }));
  }

  // Bucket by group key. Insertion order follows the already-sorted list, so
  // groups come out ordered by their most relevant session and members keep
  // the chosen sort inside. Project buckets need this because a date-sorted
  // list interleaves projects.
  const buckets = new Map<string, SessionSummary[]>();
  const keyOf = (s: SessionSummary): string =>
    group === 'project' ? s.projectKey : String(startOfDay(sort === 'created' ? createdMs(s) : activityMs(s)));

  for (const s of sessions) {
    const key = keyOf(s);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
  }

  for (const [key, members] of buckets) {
    rows.push({
      kind: 'header',
      id: `h-${key}`,
      label: group === 'project' ? members[0].projectName : dayLabel(Number(key)),
      count: members.length,
      color: group === 'project' ? projectColors?.get(key) : undefined,
    });
    for (const s of members) rows.push({ kind: 'session', id: s.id, session: s });
  }
  return rows;
}
