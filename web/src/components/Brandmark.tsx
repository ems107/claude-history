/**
 * The mark, without its tile.
 *
 * A terminal prompt and the trail it leaves behind: the solid chevron is now,
 * the two behind it are what already happened. The tile version — a terracotta
 * square with the same trail cut into it in warm black — is what Android
 * installs, what Windows pins to the Start Menu shortcut and what a browser tab
 * shows. Here there is already a surface, so the tile would be a badge sitting
 * on top of one; the glyph belongs to the type instead.
 *
 * The three steps are the theme's own accent rather than three opacities, so
 * the fade stays warm on the app's cool near-black ground instead of greying
 * out — and follows the accent if it is ever changed.
 */
export function Brandmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 44 40"
      className={className}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 13 L10.5 20 L4 27" stroke="var(--accent-dim)" strokeWidth="4.6" opacity="0.55" />
      <path d="M13 9.5 L22 20 L13 30.5" stroke="var(--accent-dim)" strokeWidth="5.4" />
      <path d="M23.5 6 L37 20 L23.5 34" stroke="var(--accent)" strokeWidth="6.2" />
    </svg>
  );
}
