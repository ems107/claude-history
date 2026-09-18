import { useState } from 'react';
import type { OrderGroup, OrderState } from '../../lib/order.ts';
import { useBackDismiss } from '../../lib/mobile.ts';
import { controlRow } from '../controlClass.ts';
import { Choice, FunnelIcon, Sheet, SheetHeading, SortIcon, SquareButton } from './mobileBar.tsx';
import { SearchBox } from './SearchBox.tsx';

/**
 * One line for the three cross-session pages — Prompts, Plans, Starred.
 *
 * They had the session list's old problem and no fix for it: a search box with
 * a 192px floor, one or two `<select>`s, a count and an order bar, in a row
 * that wrapped to two lines at 360px. Same answer as the list — the box, a
 * funnel for whatever narrows the page, a sort square where there is an order
 * to change — so the four browsing pages are one control set rather than four.
 *
 * **And the page says its own name above it.** Three of these are reached from
 * the bottom bar's `More` menu, which lights nothing while you are on them: the
 * footer can tell you where you are on Sessions, Stats and Settings and cannot
 * on these, so the title is the only thing that can.
 *
 * The count keeps its place in the placeholder, as it does on the list: the box
 * is empty exactly when there is room to read it.
 */

export interface ToolbarFilter {
  /** What the group of choices is called in the sheet. */
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** `[value, label]`, the first of which is normally the "all" option. */
  options: Array<[string, string]>;
}

export interface ToolbarOrder {
  order: OrderState;
  onChange: (o: OrderState) => void;
  /** The date being ordered by, e.g. "Asked". Written, not offered: there is one. */
  field: string;
  /** What a group holds, said in the sheet where the desktop says it in a tooltip. */
  groupHint: string;
}

const GROUP_OPTIONS: Array<[OrderGroup, string]> = [
  ['none', 'None'],
  ['session', 'Session'],
];

export function MobileToolbar({
  title,
  q,
  onQ,
  placeholder,
  filters,
  order,
}: {
  title: string;
  q: string;
  onQ: (v: string) => void;
  placeholder: string;
  filters: ToolbarFilter[];
  order?: ToolbarOrder;
}) {
  const [filtering, setFiltering] = useState(false);
  const [ordering, setOrdering] = useState(false);
  useBackDismiss(filtering, () => setFiltering(false));
  useBackDismiss(ordering, () => setOrdering(false));
  // Only the ones that are actually narrowing anything: an "all" option is the
  // first in every list and is what an unset filter holds.
  const active = filters.filter((f) => f.value !== '').length;

  return (
    <>
      <div className="border-b border-[var(--border)] px-3 pt-2 pb-2">
        <h1 className="mb-1.5 text-sm font-semibold">{title}</h1>
        <div className={controlRow}>
          <SearchBox value={q} onChange={onQ} placeholder={placeholder} />
          {filters.length > 0 && (
            <SquareButton label="Filters" count={active} active={filtering} onClick={() => setFiltering(true)}>
              <FunnelIcon />
            </SquareButton>
          )}
          {order && (
            <SquareButton label="Grouping and order" active={ordering} onClick={() => setOrdering(true)}>
              <SortIcon />
            </SquareButton>
          )}
        </div>
      </div>

      {filtering && (
        <Sheet
          title="Filters"
          onClose={() => setFiltering(false)}
          extra={
            active > 0 ? (
              <button
                type="button"
                onClick={() => {
                  for (const f of filters) f.onChange('');
                }}
                className="min-h-10 shrink-0 rounded border border-[var(--border)] px-3 text-sm text-[var(--text-dim)]"
              >
                Clear all
              </button>
            ) : undefined
          }
        >
          {filters.map((f) => (
            <div key={f.label}>
              <SheetHeading>{f.label}</SheetHeading>
              <div className="flex flex-col gap-1.5">
                {f.options.map(([value, label]) => (
                  <Choice key={value} on={f.value === value} label={label} onClick={() => f.onChange(value)} />
                ))}
              </div>
            </div>
          ))}
        </Sheet>
      )}

      {ordering && order && (
        <Sheet title="Grouping and order" onClose={() => setOrdering(false)}>
          <SheetHeading>Direction</SheetHeading>
          <div className="flex flex-col gap-1.5">
            <Choice
              on={order.order.dir === 'desc'}
              label={`${order.field} — newest first`}
              onClick={() => order.onChange({ ...order.order, dir: 'desc' })}
            />
            <Choice
              on={order.order.dir === 'asc'}
              label={`${order.field} — oldest first`}
              onClick={() => order.onChange({ ...order.order, dir: 'asc' })}
            />
          </div>
          <SheetHeading>Group into headers</SheetHeading>
          <div className="flex flex-col gap-1.5">
            {GROUP_OPTIONS.map(([id, label]) => (
              <Choice
                key={id}
                on={order.order.group === id}
                label={id === 'session' ? `${label} — ${order.groupHint}` : label}
                onClick={() => order.onChange({ ...order.order, group: id })}
              />
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
