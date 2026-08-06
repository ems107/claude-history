import type { SessionSummary } from '@claude-history/shared';

export type SortField = 'activity' | 'created' | 'messages' | 'size';
export type BadgeFilter = 'pinned' | 'live' | 'pr' | 'subagents' | 'resumed' | 'bg';

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
};

function csv(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

export function parseFilters(sp: URLSearchParams): FilterState {
  const sort = sp.get('sort');
  const dir = sp.get('dir');
  return {
    projects: csv(sp.get('projects')),
    from: sp.get('from'),
    to: sp.get('to'),
    createdFrom: sp.get('cfrom'),
    createdTo: sp.get('cto'),
    entrypoints: csv(sp.get('entry')),
    models: csv(sp.get('model')),
    badges: csv(sp.get('badges')) as BadgeFilter[],
    showEmpty: sp.get('empty') === '1',
    sort: sort === 'created' || sort === 'messages' || sort === 'size' ? sort : 'activity',
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
    case 'resumed':
      return (s.enrichment?.resumedFrom.length ?? 0) > 0;
    case 'bg':
      return s.isBackground;
  }
}

export function applyFilters(sessions: SessionSummary[], f: FilterState): SessionSummary[] {
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

  const key: (s: SessionSummary) => number =
    f.sort === 'created'
      ? createdMs
      : f.sort === 'messages'
        ? (s) => s.enrichment?.userMessageCount ?? s.messageCount ?? -1
        : f.sort === 'size'
          ? (s) => s.sizeBytes
          : activityMs;

  const mul = f.dir === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => mul * (key(a) - key(b)));
}
