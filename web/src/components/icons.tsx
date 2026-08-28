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
export function UpgradeIcon() {
  return (
    <svg {...base} className="h-3.5 w-3.5">
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
export function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M9.4 1.05c-.41-1.4-2.4-1.4-2.81 0l-.1.34a1.46 1.46 0 0 1-2.1.87l-.31-.17c-1.29-.7-2.69.71-1.99 1.99l.17.31a1.46 1.46 0 0 1-.87 2.1l-.34.1c-1.4.42-1.4 2.4 0 2.81l.34.1a1.46 1.46 0 0 1 .87 2.11l-.17.31c-.7 1.28.7 2.68 1.99 1.98l.31-.17a1.46 1.46 0 0 1 2.1.88l.1.34c.42 1.4 2.4 1.4 2.81 0l.1-.34a1.46 1.46 0 0 1 2.11-.88l.31.17c1.28.7 2.68-.7 1.98-1.98l-.17-.31a1.46 1.46 0 0 1 .88-2.11l.34-.1c1.4-.41 1.4-2.4 0-2.81l-.34-.1a1.46 1.46 0 0 1-.88-2.1l.17-.31c.7-1.29-.7-2.69-1.98-1.99l-.31.17a1.46 1.46 0 0 1-2.11-.87l-.1-.34ZM8 10.93a2.93 2.93 0 1 1 0-5.86 2.93 2.93 0 0 1 0 5.86Z" />
    </svg>
  );
}
