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

export function GearIcon() {
  return (
    <svg {...base} className="h-3.5 w-3.5">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4" />
    </svg>
  );
}
