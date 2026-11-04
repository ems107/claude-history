import type { PriceTable, SessionSummary } from '@claude-history/shared';
import { LIVE_BUSY, LIVE_STOPPED, LIVE_WAITING } from '@claude-history/shared';
import { sessionCost } from './cost.ts';
import { stateSinceOf } from './liveClock.ts';

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
  // By day unless asked otherwise: the list reads as a diary, and the live
  // sections that open it (`buildRows`) are what "now" looks like above it.
  group: 'day',
};

/**
 * How many facets are currently narrowing the list — nothing to do with sort,
 * direction or grouping, which change the order and never the contents.
 *
 * It exists for the phone, where the sidebar is a sheet rather than a column:
 * with the filters out of sight, a list showing 3 of 400 sessions and no
 * explanation is the kind of thing somebody restarts the app over. The button
 * that opens the sheet wears this number.
 */
export function activeFilterCount(f: FilterState): number {
  return (
    (f.projects.length > 0 ? 1 : 0) +
    (f.from !== null || f.to !== null ? 1 : 0) +
    (f.createdFrom !== null || f.createdTo !== null ? 1 : 0) +
    (f.entrypoints.length > 0 ? 1 : 0) +
    (f.models.length > 0 ? 1 : 0) +
    f.badges.length +
    (f.showEmpty ? 1 : 0)
  );
}

function csv(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

export function parseFilters(sp: URLSearchParams): FilterState {
  const sort = sp.get('sort');
  const dir = sp.get('dir');
  const group = sp.get('group');
  return {
    // Absent means the default, which is `day`; `none` has to be spelled out.
    group: group === 'none' || group === 'project' ? group : 'day',
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
  if (f.group !== DEFAULT_FILTERS.group) sp.set('group', f.group);
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

// ---- The live sections ----

export type LiveSection = 'attention' | 'open';

/**
 * The two sections that open the list, in order. The dots are the badges' own
 * colours: amber is this app's "there is something here for you" (WAITING, the
 * bell), green is LIVE — a process has this session open.
 */
const LIVE_SECTIONS: ReadonlyArray<{ id: LiveSection; label: string; color: string }> = [
  { id: 'attention', label: 'Needs attention', color: 'var(--color-amber-400)' },
  { id: 'open', label: 'Open sessions', color: 'var(--color-green-400)' },
];

/**
 * Which live section a session is listed in, or null for the ordinary list.
 *
 * The question is **whose turn it is**, not what the process is doing:
 * - `attention` — the session is waiting on you. Every `waiting` one, bell or
 *   no bell, because having looked at a dialog and not answered it leaves the
 *   turn exactly as blocked; and every resting one (`idle`/`shell`) that is
 *   still in the bell, i.e. finished and not seen yet.
 * - `open` — open and owing you nothing: working, or resting and already seen.
 *
 * `belled` is the bell's own list of session ids, never the unread count: that
 * one climbs all through a turn somebody is watching, the bell is precisely
 * "stopped and not seen", and dismissing a row in its panel is then a way to
 * clear a session out of `attention` without opening it.
 *
 * Any other status — `unknown` (a `--print` run writes none) or one a later CLI
 * adds — has no state to show, so it stays where its dates put it.
 */
export function liveSectionOf(s: SessionSummary, belled: ReadonlySet<string>): LiveSection | null {
  const status = s.live?.status;
  if (status === undefined) return null;
  if (status === LIVE_WAITING) return 'attention';
  if (LIVE_STOPPED.includes(status)) return belled.has(s.id) ? 'attention' : 'open';
  if (status === LIVE_BUSY) return 'open';
  return null;
}

/** Newest stamp first, by the clock the row's state badge draws (`stateSinceOf`); none goes last. */
function byStateSinceDesc(a: SessionSummary, b: SessionSummary): number {
  return (stateSinceOf(b.live) ?? 0) - (stateSinceOf(a.live) ?? 0);
}

const busyRank = (s: SessionSummary): number => (s.live?.status === LIVE_BUSY ? 0 : 1);

function workingFirst(a: SessionSummary, b: SessionSummary): number {
  return busyRank(a) - busyRank(b) || byStateSinceDesc(a, b);
}

/**
 * Turn a sorted session list into rows with group headers interleaved.
 *
 * **Live sessions come first, in their own sections** (`liveSectionOf`), in
 * every mode: they ignore the chosen sort, direction and grouping, and keep
 * only the filters. They are MOVED there, never copied, so a day's header
 * counts what is left under it and no session is two rows — which would also
 * leave the keyboard's selection, kept by session id, not knowing which one to
 * light. The order inside each section, and why: AI_VIEWER.md, "The list opens
 * with the live sessions". With no live session, the rows are exactly what they
 * were before these sections existed.
 *
 * Below them, day grouping follows whichever date the list is sorted by, so the
 * headers always match the order on screen; any other sort falls back to no
 * grouping (headers would appear out of order and mean nothing). A list drawn
 * flat under live sections gets an `Other sessions` header of its own, or it
 * would read as the last section's tail.
 */
export function buildRows(
  sessions: SessionSummary[],
  group: GroupMode,
  sort: SortField,
  belled: ReadonlySet<string>,
  projectColors?: Map<string, string>,
): ListRow[] {
  const rows: ListRow[] = [];
  const live: Record<LiveSection, SessionSummary[]> = { attention: [], open: [] };
  const rest: SessionSummary[] = [];
  for (const s of sessions) {
    const section = liveSectionOf(s, belled);
    if (section) live[section].push(s);
    else rest.push(s);
  }
  live.attention.sort(byStateSinceDesc);
  live.open.sort(workingFirst);
  for (const { id, label, color } of LIVE_SECTIONS) {
    const members = live[id];
    if (members.length === 0) continue;
    rows.push({ kind: 'header', id: `h-live-${id}`, label, count: members.length, color });
    for (const s of members) rows.push({ kind: 'session', id: s.id, session: s });
  }

  if (group === 'none' || (group === 'day' && sort !== 'activity' && sort !== 'created')) {
    if (rows.length > 0 && rest.length > 0) {
      rows.push({ kind: 'header', id: 'h-others', label: 'Other sessions', count: rest.length });
    }
    for (const s of rest) rows.push({ kind: 'session', id: s.id, session: s });
    return rows;
  }

  // Bucket by group key. Insertion order follows the already-sorted list, so
  // groups come out ordered by their most relevant session and members keep
  // the chosen sort inside. Project buckets need this because a date-sorted
  // list interleaves projects.
  const buckets = new Map<string, SessionSummary[]>();
  const keyOf = (s: SessionSummary): string =>
    group === 'project' ? s.projectKey : String(startOfDay(sort === 'created' ? createdMs(s) : activityMs(s)));

  for (const s of rest) {
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
