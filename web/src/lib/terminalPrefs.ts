/**
 * What the embedded terminal remembers, and it is exactly two things: how tall
 * the panel is, and how big the text in it is.
 *
 * Same shape as `viewPrefs.ts`: read with a fallback, clamp, write, and the keys
 * live here so no two callers can disagree about them. In `localStorage` rather
 * than in settings because both are properties of this window — a phone and a 4K
 * monitor want different answers, and neither is the other's business.
 *
 * **And those two are ALL that is remembered about that panel, which is the
 * point.** Whether it was collapsed used to live here too — first as one switch
 * for every session, then as a capped list of the collapsed ones. Neither is
 * here any more, because that stopped being a state anybody sets: a session is
 * opened to be READ, so the terminal comes up as its own title bar, a click on
 * the bar opens it, and the focus leaving puts it away again
 * ([SessionTerminal]). There is nothing left to remember, and a key answering
 * "how did you leave this one?" was only ever read out as a panel that came up
 * hiding itself. The pin and full screen are not remembered either, for the same
 * reason. A `terminalMinimised` may still be sitting in a browser from before;
 * nothing reads it, and it is not worth a migration.
 *
 * The floor below is why collapsing has to exist at all: under
 * `TERMINAL_HEIGHT_MIN` there is no room for the CLI's status line and a prompt,
 * so "drag it small" was never the way to get the conversation back.
 */

import { useSyncExternalStore } from 'react';

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

export const FONT_SIZE_KEY = 'terminalFontSize';

/**
 * How big the text is — and unlike the height, ONE answer for every terminal
 * there is.
 *
 * That is what makes it a store rather than another `readHeight()` beside the
 * height's: the size of the type is not a property of the panel you happen to be
 * looking at, it is how this browser draws a console. So it is set once and
 * everything drawing one follows, in the same tick — the terminal in this tab,
 * the one in the tab beside it, and the next one to be opened. The height is the
 * opposite and stays as it was: dragging THIS panel's edge is a statement about
 * this panel, and there is only ever one of them mounted to hear it.
 *
 * Whole pixels only. xterm measures a cell from the font and rounds it, so a
 * fractional size buys nothing but a cell that no longer divides the panel — and
 * the CLI tiles its logo out of half-block glyphs that only line up when the
 * cell is a whole number of pixels ([SessionTerminal]).
 */
export const TERMINAL_FONT_MIN = 8;
/**
 * The ceiling is arithmetic, not taste. Measured at the two floors at once — a
 * panel dragged to `TERMINAL_HEIGHT_MIN` at 24 px asks for 62x5, and 5 rows is
 * still clear of the `TERMINAL_MIN_ROWS` the server clamps to. Any higher and
 * xterm would ask for fewer rows than the pseudo-terminal is allowed to have,
 * which is the one failure that does not look like one — the view and the pty
 * disagree, and the CLI draws its status line over its own prompt.
 */
export const TERMINAL_FONT_MAX = 24;
/** xterm's own default, and what every terminal here was before it could be changed. */
export const TERMINAL_FONT_DEFAULT = 12;

function clampFont(px: number): number {
  if (!Number.isFinite(px)) return TERMINAL_FONT_DEFAULT;
  return Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, Math.round(px)));
}

function readFontSize(): number {
  const stored = Number(localStorage.getItem(FONT_SIZE_KEY));
  return stored ? clampFont(stored) : TERMINAL_FONT_DEFAULT;
}

/**
 * The same shape `selectedMessage.ts` uses, and the only other one in the app: a
 * module variable, a set of listeners, and `useSyncExternalStore` for whoever has
 * to redraw. React state would be one copy per component, which is precisely the
 * bug — two terminals at two sizes, and a new one born at whatever the page last
 * happened to read.
 */
let fontSize = readFontSize();
const listeners = new Set<() => void>();

function announce(): void {
  for (const fn of listeners) fn();
}

/**
 * For the xterm constructor, which needs the CURRENT value and must not have it
 * as a dependency: the effect that builds the terminal disposes it on the way
 * out, so a size in its dependency list would rebuild the whole thing — and the
 * socket, whose own dependencies are different, would go on writing into a
 * disposed terminal ([SessionTerminal]).
 */
export function getTerminalFontSize(): number {
  return fontSize;
}

export function setTerminalFontSize(px: number): void {
  const next = clampFont(px);
  if (next === fontSize) return;
  fontSize = next;
  localStorage.setItem(FONT_SIZE_KEY, String(next));
  announce();
}

export function stepTerminalFontSize(dir: 1 | -1): void {
  setTerminalFontSize(fontSize + dir);
}

/**
 * Another tab changed it, so this one follows — which is what "one answer for
 * every terminal" has to mean once a second window exists.
 *
 * **Nothing is written back here.** The tab that pressed the button has already
 * stored the value, and storing it again from the event would be two tabs handing
 * one number back and forth. `key === null` is a `clear()`, which takes the size
 * with it, so it is read again rather than ignored.
 */
function adopt(e: StorageEvent): void {
  if (e.key !== null && e.key !== FONT_SIZE_KEY) return;
  const next = readFontSize();
  if (next === fontSize) return;
  fontSize = next;
  announce();
}

/**
 * The window listener is hung on the FIRST subscriber and dropped with the last:
 * this module is imported by the find bar and by the session page, neither of
 * which draws a terminal, and a listener attached at import time would be one
 * every page pays for so that a panel most of them never show can be in step.
 */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', adopt);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', adopt);
  };
}

export function useTerminalFontSize(): number {
  return useSyncExternalStore(subscribe, getTerminalFontSize, getTerminalFontSize);
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
