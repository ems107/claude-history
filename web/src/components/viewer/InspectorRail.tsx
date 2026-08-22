import type { InspectorState, PanelKey } from '../../lib/inspector.ts';
import { RAIL_PX } from '../../lib/inspector.ts';

const base = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'size-4 shrink-0',
};

/**
 * Six shapes that have to be told apart at 16 px, so each one says what its
 * panel is ABOUT rather than what kind of thing it is: three bars for the
 * ledger, a pencil for what was edited, an arrow leaving a tray for what was
 * handed over, a link for a path merely named, a fork for the agents, a graph
 * for the lineage. Same stroke and same grid as `components/icons.tsx`.
 */
const ICONS: Record<PanelKey, () => import('react').ReactElement> = {
  tokens: () => (
    <svg {...base}>
      <path d="M3 13V7" />
      <path d="M8 13V3" />
      <path d="M13 13V9.5" />
    </svg>
  ),
  changed: () => (
    <svg {...base}>
      <path d="M11.1 2.6a1.6 1.6 0 0 1 2.3 2.3L5.7 12.5l-3.1.8.8-3.1Z" />
    </svg>
  ),
  sent: () => (
    <svg {...base}>
      <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
      <path d="M8 10.2V2.6" />
      <path d="M5 5.6 8 2.6l3 3" />
    </svg>
  ),
  mentioned: () => (
    <svg {...base}>
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M7.6 4.8 9 3.4a2.4 2.4 0 0 1 3.4 3.4l-1.4 1.4" />
      <path d="M8.4 11.2 7 12.6a2.4 2.4 0 0 1-3.4-3.4l1.4-1.4" />
    </svg>
  ),
  agents: () => (
    <svg {...base}>
      <path d="M8 13.5V9" />
      <path d="M8 9 4 6V2.5" />
      <path d="M8 9l4-3V2.5" />
    </svg>
  ),
  lineage: () => (
    <svg {...base}>
      <circle cx="4.5" cy="4" r="1.6" />
      <circle cx="4.5" cy="12" r="1.6" />
      <circle cx="11.5" cy="8" r="1.6" />
      <path d="M4.5 5.6v4.8" />
      <path d="M4.5 8h5.4" />
    </svg>
  ),
};

/**
 * The way into everything this session can be inspected with — down the right
 * edge of the page, where it stays whatever else is open.
 *
 * An item exists only if its panel has something in it, which is the rule the
 * six header buttons already followed: a session with no subagents never had a
 * `⑂ Subagents` button either. `Tokens` is the one that is always there.
 */
export function InspectorRail({ inspector }: { inspector: InspectorState }) {
  return (
    <div
      style={{ width: RAIL_PX }}
      className="flex shrink-0 flex-col gap-0.5 border-l border-[var(--border)] py-2"
    >
      {inspector.items.map((item) => {
        const active = inspector.open === item.key;
        const Icon = ICONS[item.key];
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => inspector.toggle(item.key)}
            title={item.hint}
            aria-pressed={active}
            className={`flex cursor-pointer flex-col items-center gap-1 px-1 py-1.5 text-[10px] leading-3 ${
              active
                ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
            }`}
            // The lit edge is the one ADJACENT to the panel it opened, which is
            // to the left of the rail. Inline because it is a colour from the
            // theme in a shadow, and there is exactly one of them.
            style={active ? { boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined}
          >
            <Icon />
            <span className="w-full truncate text-center">
              {item.short}
              {item.count !== null ? ` ${item.count}` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}
