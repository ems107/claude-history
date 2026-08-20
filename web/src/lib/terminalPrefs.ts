/**
 * How tall the embedded terminal is, remembered per browser.
 *
 * Same shape as `viewPrefs.ts`: read with a fallback, clamp, write, and the key
 * lives here so the component and the drag handle cannot disagree about it. In
 * `localStorage` rather than in settings because it is a property of this
 * window — a phone and a 4K monitor want different answers, and neither is the
 * other's business.
 */

export const HEIGHT_KEY = 'terminalHeight';

/** Below this there is no room for the CLI's own status line plus a prompt. */
export const TERMINAL_HEIGHT_MIN = 180;
/** Above this the conversation it is supposed to be part of has gone. */
export const TERMINAL_HEIGHT_MAX = 900;

export const TERMINAL_HEIGHT_DEFAULT = 380;

export function clamp(px: number): number {
  if (!Number.isFinite(px)) return TERMINAL_HEIGHT_DEFAULT;
  return Math.min(TERMINAL_HEIGHT_MAX, Math.max(TERMINAL_HEIGHT_MIN, Math.round(px)));
}

export function readHeight(): number {
  const stored = Number(localStorage.getItem(HEIGHT_KEY));
  return stored ? clamp(stored) : TERMINAL_HEIGHT_DEFAULT;
}

/**
 * Did this event come from inside an embedded terminal?
 *
 * With the focus in one, every key belongs to the CLI: Ctrl+F is its search,
 * Escape closes its menus, Ctrl+C interrupts it. So the page's own global
 * shortcuts stand aside rather than taking keys out of a program the user is
 * typing into — which is what a terminal in a web page has to get right before
 * anything else about it matters.
 *
 * Asked of the DOM rather than tracked in state: xterm moves focus between a
 * helper textarea and its own elements as it pleases, and a boolean kept beside
 * that would be wrong exactly when it mattered.
 */
export function isFromTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-terminal]') !== null;
}
