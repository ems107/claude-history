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
 * Collapsed to its own title bar, with the CLI still running behind it.
 *
 * The height has a floor (`TERMINAL_HEIGHT_MIN`) because below it there is no
 * room for the CLI's status line and a prompt — so "drag it small" was never the
 * way to get the conversation back, and this is.
 *
 * **Remembered per SESSION, unlike the height**, and the difference is what each
 * one is about: a height is a property of this window, which a phone and a 4K
 * monitor answer differently, while collapsing the panel is something you did to
 * one conversation — to read it without the terminal in the way — and coming
 * back to that conversation should find it as you left it. As one switch for all
 * of them, collapsing here made the next terminal you started anywhere else come
 * up collapsed as well, which is a panel hiding itself for a reason nobody can
 * see.
 *
 * A list of the sessions that are collapsed, most recent first — absence is the
 * default, so nothing accumulates for the ordinary case of a panel left open.
 * The cap is what stops one entry per session ever read: the tail of it is
 * terminals nobody will meet again, and the cost of forgetting one is a panel
 * that comes up expanded.
 */
export const MINIMISED_KEY = 'terminalMinimised';

/** Beyond this the oldest is forgotten, which costs one expanded panel. */
const MINIMISED_MAX = 100;

/**
 * Anything that is not our list reads as an empty one — including the plain
 * `true`/`false` this key held while the state was global, which is the very
 * setting whose memory has to go.
 */
function minimisedList(): string[] {
  try {
    const raw = localStorage.getItem(MINIMISED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function readMinimised(sessionId: string): boolean {
  return minimisedList().includes(sessionId);
}

export function writeMinimised(sessionId: string, minimised: boolean): void {
  const rest = minimisedList().filter((id) => id !== sessionId);
  const next = minimised ? [sessionId, ...rest].slice(0, MINIMISED_MAX) : rest;
  localStorage.setItem(MINIMISED_KEY, JSON.stringify(next));
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
