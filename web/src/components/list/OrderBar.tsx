import type { OrderGroup, OrderState } from '../../lib/order.ts';

const GROUP_OPTIONS: Array<[OrderGroup, string]> = [
  ['none', 'None'],
  ['session', 'Session'],
];

/**
 * Group and direction for a cross-session page. Same markup and classes as the
 * session list's `SortBar`, so the two read as the same control — but with one
 * date field instead of five, which is why the field is written rather than
 * offered: there is nothing to choose between.
 */
export function OrderBar({
  order,
  onChange,
  /** The date being sorted by, e.g. "Message date". */
  field,
  /** What a group holds, for the Group select's tooltip. */
  groupHint,
}: {
  order: OrderState;
  onChange: (next: OrderState) => void;
  field: string;
  groupHint: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[var(--text-dim)]">
      <span className="text-xs">Group</span>
      <select
        value={order.group}
        onChange={(e) => onChange({ ...order, group: e.target.value as OrderGroup })}
        title={groupHint}
        className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs"
      >
        {GROUP_OPTIONS.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <span className="ml-2 text-xs">{field}</span>
      <button
        type="button"
        title={
          order.dir === 'desc'
            ? 'Newest first' + (order.group === 'session' ? ' (groups by their newest)' : '')
            : 'Oldest first' + (order.group === 'session' ? ' (groups by their newest)' : '')
        }
        onClick={() => onChange({ ...order, dir: order.dir === 'desc' ? 'asc' : 'desc' })}
        className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs hover:border-[var(--text-dim)]"
      >
        {order.dir === 'desc' ? '↓' : '↑'}
      </button>
    </div>
  );
}
