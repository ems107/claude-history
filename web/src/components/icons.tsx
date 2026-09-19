// Small inline icons for the header controls and for the marks a session row
// wears. Stroke-based so they inherit the current text colour, sized to sit next
// to each other in the header — and sizeable, because the same bell that reads
// well at 14 px beside a button has to fit a 10 px badge in the list.

const base = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Arrow rising out of a line — "upgrade", as opposed to a refresh circle. */
export function UpgradeIcon({ className = 'h-3.5 w-3.5' }: { className?: string } = {}) {
  return (
    <svg {...base} className={className}>
      <path d="M8 11V2.5" />
      <path d="M4.5 6 8 2.5 11.5 6" />
      <path d="M3 13.5h10" />
    </svg>
  );
}

/**
 * Bell. Two arcs and a clapper rather than a filled blob: at 14 px a solid
 * bell loses its shoulders and reads as a thumbprint, where the open outline
 * keeps the silhouette everyone recognises. Same stroke weight as the upgrade
 * arrow it sits next to, so the pair does not look like two different sets.
 */
export function BellIcon({ className = 'h-3.5 w-3.5' }: { className?: string } = {}) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6.8a4 4 0 0 1 8 0c0 2.4.5 3.6 1.2 4.4H2.8C3.5 10.4 4 9.2 4 6.8Z" />
      <path d="M6.6 13.2a1.5 1.5 0 0 0 2.8 0" />
    </svg>
  );
}

/**
 * Speech bubble, for the count of messages a session has grown by since it was
 * read. A rectangle with one corner drawn down into a tail: the tail is the
 * whole of what makes it a message rather than a note, so it is on the leading
 * edge where nothing crops it, and the box keeps square corners at 12 px where
 * rounded ones turn to mush.
 */
export function MessageIcon({ className = 'h-3.5 w-3.5' }: { className?: string } = {}) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5a1.5 1.5 0 0 1-1.5 1.5H6.5l-3 3v-3H4A1.5 1.5 0 0 1 2.5 9Z" />
    </svg>
  );
}

/**
 * Gear. Drawn as a filled silhouette on purpose: a stroked one with radial
 * ticks reads as a sun/brightness symbol at this size — the teeth have to be
 * solid shapes to be recognisable as a cog.
 */
export function GearIcon({ className = 'h-3.5 w-3.5' }: { className?: string } = {}) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M9.4 1.05c-.41-1.4-2.4-1.4-2.81 0l-.1.34a1.46 1.46 0 0 1-2.1.87l-.31-.17c-1.29-.7-2.69.71-1.99 1.99l.17.31a1.46 1.46 0 0 1-.87 2.1l-.34.1c-1.4.42-1.4 2.4 0 2.81l.34.1a1.46 1.46 0 0 1 .87 2.11l-.17.31c-.7 1.28.7 2.68 1.99 1.98l.31-.17a1.46 1.46 0 0 1 2.1.88l.1.34c.42 1.4 2.4 1.4 2.81 0l.1-.34a1.46 1.46 0 0 1 2.11-.88l.31.17c1.28.7 2.68-.7 1.98-1.98l-.17-.31a1.46 1.46 0 0 1 .88-2.11l.34-.1c1.4-.41 1.4-2.4 0-2.81l-.34-.1a1.46 1.46 0 0 1-.88-2.1l.17-.31c.7-1.29-.7-2.69-1.98-1.99l-.31.17a1.46 1.46 0 0 1-2.11-.87l-.1-.34ZM8 10.93a2.93 2.93 0 1 1 0-5.86 2.93 2.93 0 0 1 0 5.86Z" />
    </svg>
  );
}

/**
 * The three views of the Git tab, as one set.
 *
 * They are drawn here rather than in `components/git/` because this is where
 * the app's 16-unit, 1.6-stroke grid lives, and a second set on a different
 * grid is how two icons that sit 8 px apart stop looking like siblings.
 *
 * The set was chosen by rendering twelve candidates at 14 px — the size they
 * are actually drawn — beside the glyphs already on that toolbar row, rather
 * than by arguing about them. What survived is below; what did not is in
 * [AI_GIT.md](../../../docs/AI_GIT.md).
 */

/**
 * Commits: a lane with two nodes and a branch leaving it for a third.
 *
 * The same picture the pane underneath draws, which is the whole reason it
 * works — a plain timeline of three dots on one line is a vertical blob at
 * 14 px and says "list" rather than "history". The nodes are FILLED while
 * everything else in the set is stroked: a stroked circle of this radius at
 * 1.6 closes up into a smudge anyway, so it may as well be a deliberate dot.
 */
export function CommitsIcon({ className = 'h-3.5 w-3.5' }: { className?: string } = {}) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 4.6v6.8" />
      <path d="M4.5 8h3.2a3 3 0 0 0 3-3V4.4" />
      <circle cx="4.5" cy="3" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10.7" cy="3" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The working tree: a plus over a minus — lines added and lines taken away.
 *
 * **Both are centred on the box, in both axes, and the arithmetic is the
 * point.** The first draft staggered them the way a diff staggers its `+` and
 * `-` lines, and at 14 px that does not read as a diff, it reads as a mistake:
 * the plus sat left of centre and the minus right of it. So the ink — stroke
 * width included, which is what the eye sees and what `getBBox` leaves out —
 * runs 4.0 to 12.0 across (centre 8) and 2.3 to 13.7 down (centre 8). Change
 * one number here and the other three have to move with it.
 */
export function ChangesIcon({ className = 'h-3.5 w-3.5' }: { className?: string } = {}) {
  return (
    <svg {...base} className={className}>
      <path d="M4.8 6.3h6.4M8 3.1v6.4" />
      <path d="M4.8 12.9h6.4" />
    </svg>
  );
}

/**
 * The command log: three rules, each with its own stub in front of it.
 *
 * A list, and deliberately not a terminal `>_` — that one reads better on its
 * own and is already spoken for two controls along the same bar, where `❯`
 * opens a real terminal. The stubs are what keep it from being the generic
 * "menu" three-line glyph: they read as a column of times or exit codes, which
 * is what each row of that panel actually starts and ends with.
 */
export function CommandLogIcon({ className = 'h-3.5 w-3.5' }: { className?: string } = {}) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 4h2M2.5 8h2M2.5 12h2" />
      <path d="M7 4h6.5M7 8h6.5M7 12h4" />
    </svg>
  );
}
