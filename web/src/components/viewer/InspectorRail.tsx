import type { InspectorState, PanelKey } from '../../lib/inspector.ts';
import { RAIL_PX } from '../../lib/sideColumns.ts';

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
 * Ten shapes that have to be told apart at 16 px, so each one says what its
 * panel is ABOUT rather than what kind of thing it is: three bars for the
 * ledger, a checklist for the plan, a tree of files for the project it ran in,
 * two commits diverging for the branch review, a pencil for what was edited,
 * an arrow leaving a tray for what was handed over, a link for a path merely
 * named, an open folder for the workspace it wrote in, a fork for the agents,
 * a plug for what was plugged in, a graph for the lineage. Same stroke and
 * same grid as `components/icons.tsx`.
 *
 * Three pairs could be confused and are drawn apart on purpose. `scratchpad`
 * is an open FOLDER, the workspace the session wrote into, where `files` is a
 * TREE — branches with leaves, because that panel is something you walk. And
 * `revision` is two commits parting from one, where `agents` is a fork of
 * three lines meeting: one is history dividing, the other is work sent out.
 */
export const PANEL_ICONS: Record<PanelKey, () => import('react').ReactElement> = {
  tokens: () => (
    <svg {...base}>
      <path d="M3 13V7" />
      <path d="M8 13V3" />
      <path d="M13 13V9.5" />
    </svg>
  ),
  // A checklist with its first line ticked: what was proposed, and the one
  // thing that happened to it. Not a document outline — that is every panel.
  plan: () => (
    <svg {...base}>
      <path d="m2.5 4.1 1.4 1.4 2.4-2.6" />
      <path d="M8.8 4.3h4.7" />
      <path d="M2.8 8h3" />
      <path d="M8.8 8h4.7" />
      <path d="M2.8 11.8h3" />
      <path d="M8.8 11.8h4.7" />
    </svg>
  ),
  // A tree: a trunk down the left with two branches off it, each ending in a
  // leaf. Not a folder — the scratchpad already has one, and at 16 px two
  // folders are one shape.
  files: () => (
    <svg {...base}>
      <path d="M3.5 2.5v9.5" />
      <path d="M3.5 5.5h3.2" />
      <path d="M3.5 9.5h3.2" />
      <rect x="7.2" y="3.9" width="5.6" height="3.2" rx="0.8" />
      <rect x="7.2" y="7.9" width="5.6" height="3.2" rx="0.8" />
    </svg>
  ),
  // Two commits diverging from one, which is what a comparison IS here: the
  // point they parted, and the branch that went its own way.
  revision: () => (
    <svg {...base}>
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="12" cy="4" r="1.5" />
      <path d="M4 10.5V5.5" />
      <path d="M4.4 7.2C6.5 6.2 8.6 5.2 10.6 4.4" />
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
  scratchpad: () => (
    <svg {...base}>
      <path d="M2 12.5V4a1 1 0 0 1 1-1h3.2l1.4 1.6H13a1 1 0 0 1 1 1v1.4" />
      <path d="m2 12.5 1.9-4.3a1 1 0 0 1 .92-.6h9.4a.6.6 0 0 1 .55.84L13 12.5Z" />
    </svg>
  ),
  agents: () => (
    <svg {...base}>
      <path d="M8 13.5V9" />
      <path d="M8 9 4 6V2.5" />
      <path d="M8 9l4-3V2.5" />
    </svg>
  ),
  // A plug: two pins going into a socket. What an MCP server IS to a session —
  // something outside it, plugged in — rather than a server or a network.
  mcp: () => (
    <svg {...base}>
      <path d="M6 2v3" />
      <path d="M10 2v3" />
      <path d="M3.5 5h9v2.5a4.5 4.5 0 0 1-9 0Z" />
      <path d="M8 12v2" />
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
 *
 * **Not drawn at all on a phone.** It was a strip of chips under the header
 * there, and a strip that scrolls sideways is a list you cannot see the end of:
 * with seven panels, two of them were always off the right edge. The same items
 * are a section of the session sheet instead ([SessionSheetSections]), where
 * they are all visible at once and cost no permanent room.
 */
export function InspectorRail({ inspector }: { inspector: InspectorState }) {
  return (
    <div
      // Measured from checks, like the scroller and the sticky footer are: the
      // rail is where "which panels does this session have" is answered.
      data-inspector-rail
      style={{ width: RAIL_PX }}
      className="flex shrink-0 flex-col gap-0.5 border-l border-[var(--border)] py-2"
    >
      {inspector.items.map((item) => {
        const active = inspector.open === item.key;
        const Icon = PANEL_ICONS[item.key];
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => inspector.toggle(item.key)}
            title={item.hint}
            aria-pressed={active}
            className={`relative flex cursor-pointer flex-col items-center gap-1 px-1 py-1.5 text-[10px] leading-3 ${
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
            {/* Something in there is wrong, and the point is to know it without
                opening anything.

                In the corner, and INSIDE it — every row of this rail is the
                same height whether or not anything went wrong, because a
                column of buttons that changes shape is harder to read than one
                that does not. `CountBadge` was the obvious reuse and is the one
                thing that cannot work here: it hangs off the top-right corner
                by 6 px, and this rail's right edge is the WINDOW's, so the page
                clipped the circle in half and it read as a stray dot. Placed
                within the padding box instead, beside the icon, where 72 px
                wide leaves ~28 px free either side of a 16 px glyph.

                Amber rather than red, per `BlockedBar`: the session ran, it
                just ran without something it expected. The words are in
                `item.hint`, which is this button's `title`, so this stays
                `aria-hidden` and nothing is announced twice. */}
            {item.alert > 0 && (
              <span
                aria-hidden
                className="absolute top-0.5 right-0.5 px-1 text-[10px] leading-none font-semibold text-amber-400"
              >
                ⚠ {item.alert}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
