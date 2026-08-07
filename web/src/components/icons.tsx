// Small inline icons for the header controls. Stroke-based so they inherit
// the current text colour, sized to sit next to each other in the header.

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
