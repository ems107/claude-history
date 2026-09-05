import type { FilterState, GroupMode, SortField } from '../../lib/filters.ts';

const SORT_OPTIONS: Array<[SortField, string]> = [
  ['activity', 'Last activity'],
  ['created', 'Created'],
  ['messages', 'Prompts'],
  ['size', 'Size'],
  ['cost', 'Cost'],
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
    // One row of seven controls, with a 192px floor on the search box alone,
    // needs about 600px. On a phone it becomes two: the filter button, the
    // search box and Advanced on the first, everything else on the second.
    //
    // The split is one wrapper and no duplicated markup. `display: contents`
    // makes the pair below vanish as a box on a desktop, so the count and the
    // controls stay direct children of this flex row and `ml-auto` still
    // measures against it; on a phone the same wrapper becomes a full-width
    // flex row, which is what makes it wrap as a unit rather than a control at
    // a time.
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-sm max-md:flex-wrap max-md:gap-2 max-md:px-3">
      {children}
      <div className="contents max-md:flex max-md:w-full max-md:items-center max-md:gap-2">
        {/* "370 of 400 sessions" wraps to two lines at 360px and takes the
            whole second row with it, so on a phone it is the same fact in the
            shape a phone has room for. */}
        <span className="whitespace-nowrap text-[var(--text-dim)] max-md:hidden">
          {resultCount === totalCount ? `${totalCount} sessions` : `${resultCount} of ${totalCount} sessions`}
        </span>
        <span className="hidden whitespace-nowrap text-xs text-[var(--text-dim)] max-md:inline">
          {resultCount === totalCount ? totalCount : `${resultCount}/${totalCount}`}
        </span>
        <div className="ml-auto flex items-center gap-1.5 text-[var(--text-dim)]">
          <span className="text-xs max-md:hidden">Group</span>
          <select
            value={filters.group}
            onChange={(e) => onChange({ ...filters, group: e.target.value as GroupMode })}
            title={
              filters.sort === 'activity' || filters.sort === 'created'
                ? 'Insert headers by day or by project'
                : 'Day grouping needs a date sort; project grouping always works'
            }
            className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs max-md:min-h-9 max-md:px-2"
          >
            {GROUP_OPTIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <span className="ml-2 text-xs max-md:hidden">Sort</span>
          <select
            value={filters.sort}
            onChange={(e) => onChange({ ...filters, sort: e.target.value as SortField })}
            className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs max-md:min-h-9 max-md:px-2"
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
            className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs hover:border-[var(--text-dim)] max-md:min-h-9 max-md:px-3"
          >
            {filters.dir === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}
