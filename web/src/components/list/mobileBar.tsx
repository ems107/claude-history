import { squareClass } from '../controlClass.ts';
import { CountBadge } from '../CountBadge.tsx';

/**
 * The pieces every browsing page's phone toolbar is built from.
 *
 * Four pages ask the same three questions — what am I looking for, which of
 * these do I want, in what order — and each of them had grown its own row of
 * controls: a search box with a 192px floor, one or two unlabelled `<select>`s,
 * a count, and on two of them an order bar. At 360px that is two lines of
 * chrome over a list, one of which is dropdowns you have to open to find out
 * what they were.
 *
 * So they share this: a square that opens a sheet, a sheet, and a choice inside
 * it. `MobileListBar` (the session list, which has a whole filter sidebar
 * behind its funnel) and `MobileToolbar` (Prompts, Plans, Starred, whose
 * filters are a handful of selects) are the two users, and what makes them look
 * like one app is that the square comes from `squareClass` — the same one the
 * header's bell and the session's ⋮ are.
 */

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
export function SlidersIcon() {
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
export function FunnelIcon() {
  return (
    <svg {...base}>
      <path d="M2.4 3.2h11.2L9.3 8.4v4.3l-2.6 1.1V8.4Z" />
    </svg>
  );
}

/** Lines of falling length beside an arrow: order. */
export function SortIcon() {
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

/** A 40px square, with the tally of what it is holding in its corner. */
export function SquareButton({
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
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className={squareClass(active)}>
      {children}
      <CountBadge count={count ?? 0} className="bg-[var(--accent)] text-black" />
    </button>
  );
}

/** One tappable choice in a sheet, and the ✓ that says it is the one. */
export function Choice({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
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

export function SheetHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-4 mb-1.5 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
      {children}
    </h3>
  );
}

/** A full-screen sheet with a title, an optional extra control, and Done. */
export function Sheet({
  title,
  onClose,
  extra,
  children,
}: {
  title: string;
  onClose: () => void;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
        {extra}
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 shrink-0 rounded border border-[var(--border)] px-3 text-sm text-[var(--text-dim)]"
        >
          Done
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">{children}</div>
    </div>
  );
}
