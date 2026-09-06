import { useState } from 'react';
import type { FilterState, GroupMode, SortField } from '../../lib/filters.ts';
import { useBackDismiss } from '../../lib/mobile.ts';
import { Choice, FunnelIcon, Sheet, SheetHeading, SlidersIcon, SortIcon, SquareButton } from './mobileBar.tsx';
import { SearchBox } from './SearchBox.tsx';

/**
 * The session list's toolbar, on a phone: one line, and everything else behind
 * it.
 *
 * The desktop bar is seven controls in a row — a filter toggle, the search box,
 * Advanced, a count, Group, Sort and a direction arrow — and at 360px it became
 * two, one of which was two unlabelled `<select>`s. Two rows of chrome over a
 * list is two rows of the list you cannot see, and an unlabelled dropdown is a
 * control you have to open to find out what it was.
 *
 * So: the search box, and three squares that each open the thing they name.
 * Square rather than a row of words because at this width a label is bought
 * with the search box's own room, and these three are icons a phone has met
 * everywhere else — a funnel filters, sliders tune, stacked lines with an arrow
 * sort. They are the app's one square ([squareClass]), so the row reads as the
 * same set of controls as the header above it.
 *
 * The count the desktop bar shows ("370 of 400 sessions") is in the search box's
 * placeholder instead, where it costs nothing: the box is empty exactly when
 * there is room to read it.
 */

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

export function MobileListBar({
  filters,
  onChange,
  resultCount,
  totalCount,
  q,
  onQ,
  filterCount,
  filtersOpen,
  onToggleFilters,
  tunedCount,
  optionsOpen,
  onToggleOptions,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  resultCount: number;
  totalCount: number;
  q: string;
  onQ: (v: string) => void;
  filterCount: number;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  tunedCount: number;
  optionsOpen: boolean;
  onToggleOptions: () => void;
}) {
  const [ordering, setOrdering] = useState(false);
  useBackDismiss(ordering, () => setOrdering(false));
  // Day grouping only means anything under a date sort. The desktop says so in
  // a tooltip, which is nothing at all here, so the option says it itself.
  const dayGroupable = filters.sort === 'activity' || filters.sort === 'created';
  const sortLabel = SORT_OPTIONS.find(([id]) => id === filters.sort)?.[1] ?? '';

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <SearchBox
          value={q}
          onChange={onQ}
          placeholder={
            resultCount === totalCount ? `Search ${totalCount} sessions…` : `Search — ${resultCount} of ${totalCount}`
          }
        />
        <SquareButton label="Advanced search options" count={tunedCount} active={optionsOpen} onClick={onToggleOptions}>
          <SlidersIcon />
        </SquareButton>
        <SquareButton label="Filters" count={filterCount} active={filtersOpen} onClick={onToggleFilters}>
          <FunnelIcon />
        </SquareButton>
        <SquareButton label="Grouping and order" active={ordering} onClick={() => setOrdering(true)}>
          <SortIcon />
        </SquareButton>
      </div>

      {ordering && (
        <Sheet title="Grouping and order" onClose={() => setOrdering(false)}>
          <SheetHeading>Sort by</SheetHeading>
          <div className="flex flex-col gap-1.5">
            {SORT_OPTIONS.map(([id, label]) => (
              <Choice
                key={id}
                on={filters.sort === id}
                label={label}
                onClick={() => {
                  // Leaving Day set under Cost would group by a header nobody
                  // can see, so it falls back rather than being refused.
                  const dated = id === 'activity' || id === 'created';
                  onChange({
                    ...filters,
                    sort: id,
                    group: filters.group === 'day' && !dated ? 'none' : filters.group,
                  });
                }}
              />
            ))}
          </div>
          <SheetHeading>Direction</SheetHeading>
          <div className="flex flex-col gap-1.5">
            <Choice
              on={filters.dir === 'desc'}
              label={`${sortLabel} — newest / largest first`}
              onClick={() => onChange({ ...filters, dir: 'desc' })}
            />
            <Choice
              on={filters.dir === 'asc'}
              label={`${sortLabel} — oldest / smallest first`}
              onClick={() => onChange({ ...filters, dir: 'asc' })}
            />
          </div>
          <SheetHeading>Group into headers</SheetHeading>
          <div className="flex flex-col gap-1.5">
            {GROUP_OPTIONS.map(([id, label]) => (
              <Choice
                key={id}
                on={filters.group === id}
                label={id === 'day' && !dayGroupable ? `${label} — needs a date sort` : label}
                onClick={() => {
                  if (id === 'day' && !dayGroupable) return;
                  onChange({ ...filters, group: id });
                }}
              />
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
