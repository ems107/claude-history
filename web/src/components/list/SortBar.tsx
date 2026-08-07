import type { FilterState, GroupMode, SortField } from '../../lib/filters.ts';

const SORT_OPTIONS: Array<[SortField, string]> = [
  ['activity', 'Last activity'],
  ['created', 'Created'],
  ['messages', 'Prompts'],
  ['size', 'Size'],
];

const GROUP_OPTIONS: Array<[GroupMode, string]> = [
  ['none', 'None'],
  ['day', 'Day'],
  ['project', 'Project'],
];

export function SortBar({
  filters,
  onChange,
  resultCount,
  totalCount,
  children,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  resultCount: number;
  totalCount: number;
  children?: import('react').ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-sm">
      {children}
      <span className="text-[var(--text-dim)]">
        {resultCount === totalCount ? `${totalCount} sessions` : `${resultCount} of ${totalCount} sessions`}
      </span>
      <div className="ml-auto flex items-center gap-1.5 text-[var(--text-dim)]">
        <span className="text-xs">Group</span>
        <select
          value={filters.group}
          onChange={(e) => onChange({ ...filters, group: e.target.value as GroupMode })}
          title={
            filters.sort === 'activity' || filters.sort === 'created'
              ? 'Insert headers by day or by project'
              : 'Day grouping needs a date sort; project grouping always works'
          }
          className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs"
        >
          {GROUP_OPTIONS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <span className="ml-2 text-xs">Sort</span>
        <select
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as SortField })}
          className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs"
        >
          {SORT_OPTIONS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          title={filters.dir === 'desc' ? 'Newest / largest first' : 'Oldest / smallest first'}
          onClick={() => onChange({ ...filters, dir: filters.dir === 'desc' ? 'asc' : 'desc' })}
          className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs hover:border-[var(--text-dim)]"
        >
          {filters.dir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
    </div>
  );
}
