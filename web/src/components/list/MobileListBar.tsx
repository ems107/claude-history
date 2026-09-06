import { useState } from 'react';
import type { FilterState, GroupMode, SortField } from '../../lib/filters.ts';
import { useBackDismiss } from '../../lib/mobile.ts';
import { SearchBox } from './SearchBox.tsx';

/**
 * The list's toolbar, on a phone: one line, and everything else behind it.
 *
 * The desktop bar is seven controls in a row — a filter toggle, the search box,
 * Advanced, a count, Group, Sort and a direction arrow — and at 360px it took
 * two lines, one of which was two unlabelled `<select>`s. Two lines of chrome
 * over a list is two rows of the list you cannot see, and an unlabelled dropdown
 * is a control you have to open to find out what it was.
 *
 * So: the search box, and three square buttons that each open the thing they
 * name. Square rather than a row of words because at this width a label is
 * bought with the search box's own room, and these three are icons a phone has
 * met everywhere else — a funnel filters, sliders tune, stacked lines with an
 * arrow sort.
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

const base = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'size-[18px] shrink-0',
};

/** Sliders: something to tune, which is what the advanced options are. */
function SlidersIcon() {
  return (
    <svg {...base}>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 11.5h11" />
      <circle cx="5.5" cy="4.5" r="1.5" fill="var(--bg)" />
      <circle cx="10.5" cy="8" r="1.5" fill="var(--bg)" />
      <circle cx="6.5" cy="11.5" r="1.5" fill="var(--bg)" />
    </svg>
  );
}

/** A funnel: the one shape that means "filter" without being read. */
function FunnelIcon() {
  return (
    <svg {...base}>
      <path d="M2.4 3.2h11.2L9.3 8.4v4.3l-2.6 1.1V8.4Z" />
    </svg>
  );
}

/** Lines of falling length beside an arrow: order. */
function SortIcon() {
  return (
    <svg {...base}>
      <path d="M2.5 4h6" />
      <path d="M2.5 8h4" />
      <path d="M2.5 12h2" />
      <path d="M11.5 3.5v9" />
      <path d="M9.5 10.5 11.5 12.5 13.5 10.5" />
    </svg>
  );
}

/**
 * A 40px square, with the tally of what it is holding in its corner.
 *
 * The badge is a circle centred on its own content. The bar it replaces
 * appended the number to the glyph, which sat it on the glyph's baseline and
 * left it looking dropped; `place-items-center` in a fixed 16px box is what
 * keeps a `1` and a `12` both centred rather than one of them nudged by its
 * own width.
 */
function SquareButton({
  label,
  count,
  active,
  onClick,
  children,
}: {
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`relative grid size-10 shrink-0 place-items-center rounded border ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--text-dim)]'
      }`}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full border-2 border-[var(--bg)] bg-[var(--accent)] px-[3px] text-[9px] leading-none font-bold text-black">
          {count}
        </span>
      )}
    </button>
  );
}

/** One tappable choice in the ordering sheet. */
function Choice({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center gap-2 rounded border px-3 text-left text-sm ${
        on
          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--text)]'
      }`}
    >
      <span className="flex-1">{label}</span>
      {on && <span aria-hidden>✓</span>}
    </button>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-4 mb-1.5 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
      {children}
    </h3>
  );
}

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
        <div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg)]">
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
            <h2 className="min-w-0 flex-1 text-sm font-semibold">Grouping and order</h2>
            <button
              type="button"
              onClick={() => setOrdering(false)}
              className="min-h-9 rounded border border-[var(--border)] px-3 text-sm text-[var(--text-dim)]"
            >
              Done
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
            <Heading>Sort by</Heading>
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
            <Heading>Direction</Heading>
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
            <Heading>Group into headers</Heading>
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
          </div>
        </div>
      )}
    </>
  );
}
