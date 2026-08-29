import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The column that opens to the RIGHT of the session, beside it rather than over
 * it: the file viewer or a subagent's transcript — one at a time, and one
 * remembered width for whichever it is.
 *
 * Both were `position: fixed` overlays anchored at `right: RAIL_PX` — 832 px and
 * 704 px of drop-shadow laid over the conversation AND over the app's own
 * header, since `inset-y-0` starts at the top of the WINDOW. The rail already
 * had the answer: a panel belongs beside what you are reading, at a width you
 * drag and the app remembers. This is that, for the two panels that never got it.
 *
 * They are siblings of the whole session view rather than of the conversation,
 * which is the whole of why they reach the top: the session's own header is
 * inside the column to their left. The rail and the inspector stay where they
 * are, so a session with nothing open is unchanged to the pixel.
 */

/**
 * The rail's width, and the seam between two columns. They live here rather
 * than with the inspector because they are the LAYOUT's, not one panel's: every
 * column is measured against them, and so is `--conv-box`.
 *
 * 72 px and not the 44 an icon needs, because every rail item carries its LABEL.
 * Six unlabelled glyphs down the side of the window is six things to learn and a
 * tooltip to wait for; the words cost 28 px once. The seam is `w-1`, the session
 * list's handle, and one value serves all three of them.
 */
export const RAIL_PX = 72;
export const GRIP_PX = 4;

/**
 * The narrowest either column may be dragged to.
 *
 * 240, and it started at 360 — which turned out to be a limit nobody had asked
 * for. The reasoning behind 360 was "below this the code stops being readable",
 * and that is a judgement about what somebody wants to READ; a column dragged
 * narrow is usually somebody keeping a file in the corner of their eye while
 * they read the conversation, which is a different thing to want. 240 still
 * shows the gutter, the name and a usable strip of code, and it is a floor
 * rather than a recommendation.
 */
export const SIDE_MIN = 240;
/** Wider than any screen this runs on, so the cap that bites is the window's. */
const SIDE_MAX = 1600;

/**
 * The narrowest the conversation is squeezed to before the columns stop taking,
 * and so also what caps how wide any of them can be dragged.
 *
 * It was `WIDTH_MIN` (480) on a "one home for the fact" argument, and that
 * argument was wrong: `WIDTH_MIN` is the narrowest READING column somebody can
 * choose in `View ▾`, a statement about line length, and this is the narrowest
 * the conversation PANE may be squeezed to by something the reader deliberately
 * opened beside it. Conflating the two made the split feel nailed down — at
 * 1426 px a column could not go past 870, so "put the file on half the screen"
 * was not reachable. They are different facts and they get different numbers.
 *
 * 320 — the same floor every panel in this app has, and the second number this
 * has had. It was 400, measured: 384 is where the conversation stops scrolling
 * SIDEWAYS (a content floor of 364, plus the 20 px of scrollbar gutter the
 * scroller reserves on both edges to keep the thread centred), and 400 was that
 * rounded up. Which is a fine number for a floor nobody chose and a bad one for
 * a floor that costs the reader the split they asked for: on a 1426 px window
 * with a panel open it left the column 626 px, six from its own default, so the
 * seam had nowhere to go and reads as stuck.
 *
 * A floor is protection against the layout squeezing the conversation on its
 * own. It is not a veto over what somebody deliberately drags. Below ~384 the
 * conversation grows a horizontal scrollbar of its own — the same one a window
 * narrowed that far has always given it — and that is a consequence of a
 * gesture, one Escape from being undone.
 *
 * (What made 384 that low in the first place is worth keeping: the content floor
 * was 524 until the turn's fold strip learned to wrap — `flex w-fit` with no
 * `flex-wrap` is drawn at `max-content` however little room it has. What holds
 * it at 364 now is the message header's trailing run, and that one stays: its
 * `actions` appear on HOVER, so a header that wrapped could grow a line under
 * the pointer, which is the one thing a hover toolbar may never do.)
 */
export const CONV_MIN = 320;

/**
 * ONE width for the column, whatever is in it — the inspector's rule, and it
 * became the right one here the moment only one column could be open at a time.
 *
 * The file and the subagent transcript had a key each, which described a split
 * that cannot exist: two panels side by side, each with its own share. What
 * there actually is is a SPLIT — how much of the window the reader wants to give
 * to the thing beside the conversation — and swapping what is in the column is
 * not a reason to change it. Two keys meant walking from a file into an agent's
 * transcript threw away the split you had just set and dropped you at the other
 * one's default.
 */
export const COLUMN_KEY = 'sideColumnWidth';
export const COLUMN_DEFAULT = 620;

/**
 * The inspector's own floor, and it is not `SIDE_MIN`: every one of its six
 * panels was written to READ at 320 px, which is the work that turned the token
 * table into a stack of cards and made every file row wrap. A file viewer at 240
 * is still a file viewer; a token ledger at 240 is a broken table.
 *
 * Here rather than in `lib/inspector.ts` so the fit and the inspector's own drag
 * clamp cannot drift apart — that module imports it back.
 */
export const INSPECTOR_MIN = 320;
/** And its ceiling, here for the same reason: the fit and its own drag both cap against it. */
export const INSPECTOR_MAX = 900;

export interface ColumnWidth {
  /** The width the reader chose. What is DRAWN can be less — see `fitColumns`. */
  width: number;
  /** `max` is `SideLayout.maxColumn`: what is free with everything else where it is. */
  startResize: (e: React.MouseEvent, max: number) => void;
}

/**
 * The seam follows the pointer, and both halves of that are load-bearing.
 *
 * **The width is read off the pointer's position, not off a delta.** A drag used
 * to be `from + startX - clientX`, which is only the same thing while the width
 * it accumulates onto is the width being drawn. It was not: with two things open
 * beside the conversation their remembered widths rarely fit, so `fitColumns`
 * was scaling both, and 100 px of mouse became ~92 px of column — the seam
 * drifting away from the pointer, and the OTHER seam moving too. One thing open
 * felt right for exactly the same reason: nothing to scale.
 *
 * So the anchor is the panel's own right edge, which cannot move during the
 * drag, and the grab offset is kept so the pixel you took hold of stays under
 * the pointer. Nothing accumulates, so nothing can drift.
 *
 * **And a drag may never make the fit bite**, or the edge it is anchored to
 * would move underneath it. That is what `max` is for: what is free with
 * everything else exactly where it is. The trade is a hard stop instead of a
 * soft one — with a panel open, a column can no longer be dragged past what is
 * left by squeezing that panel; drag the panel first, or close it. A stop you
 * can feel beats a seam that lags.
 */
function trackPointer(
  e: React.MouseEvent,
  min: number,
  max: number,
  onWidth: (w: number) => void,
  onActive?: (active: boolean) => void,
): void {
  e.preventDefault();
  const panel = (e.currentTarget as HTMLElement).nextElementSibling;
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  // Where inside the seam it was grabbed, so the drag has no jump at the start.
  const grab = rect.left - e.clientX;
  onActive?.(true);
  const onMove = (ev: MouseEvent) => {
    onWidth(Math.min(max, Math.max(min, Math.round(rect.right - (ev.clientX + grab)))));
  };
  const onUp = () => {
    onActive?.(false);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

export { trackPointer };

function readWidth(): number {
  const n = Number(localStorage.getItem(COLUMN_KEY));
  return Number.isFinite(n) && n > 0 ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, n)) : COLUMN_DEFAULT;
}

/**
 * The column's remembered width, dragged from the seam on its LEFT — so the
 * sign is mirrored, exactly as in `useInspector`. The same `mousedown` →
 * document `mousemove`/`mouseup` shape as the session list's sidebar, which is
 * the original of all three.
 *
 * It takes no key: there is one width, and it belongs to the SLOT rather than to
 * whatever is currently in it. That is what makes walking from a file into a
 * subagent's transcript keep the split you set.
 */
export function useColumnWidth(): ColumnWidth {
  const [width, setWidth] = useState(readWidth);

  const startResize = useCallback((e: React.MouseEvent, max: number) => {
    trackPointer(e, SIDE_MIN, max, (w) => {
      setWidth(w);
      localStorage.setItem(COLUMN_KEY, String(w));
    });
  }, []);

  return useMemo(() => ({ width, startResize }), [width, startResize]);
}

/**
 * The window, in state.
 *
 * The inspector could read `window.innerWidth` once at the start of a drag and
 * never again — a window narrowed afterwards simply squeezed the conversation,
 * which is `flex-1 min-w-0` and shrinks to nothing without complaint. With two
 * `shrink-0` columns and the rail beside it that stops being true: the
 * conversation reaches zero and the ROW overflows, which grows the page a
 * horizontal scrollbar. So the fit is recomputed on resize, and this is the
 * value it is recomputed from.
 */
export function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    // The first paint can precede a resize the browser has already done.
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

/** Which of the two gets what it asks for when they cannot both have it. */
export type Priority = 'inspector' | 'column';

export interface Wanted {
  /** The remembered width, or `null` when it is closed. */
  inspector: number | null;
  column: number | null;
}

/**
 * How wide each is actually DRAWN. Pure, so it can be reasoned about without a
 * browser — like `fold.ts` and `match.ts`.
 *
 * **One of them has priority and the other yields**, rather than both shrinking
 * by the same factor. Proportional scaling was the first version and it made
 * every drag feel broken: with two things open their remembered widths rarely
 * fit, so both were being scaled, and 100 px of mouse became ~92 px of column
 * while the OTHER seam moved too. Neither can happen here — the one with
 * priority is drawn at exactly what it asks for (down to the other's floor), so
 * a drag on it moves pixel for pixel, and the one that yields is the only thing
 * that moves.
 *
 * **Priority follows the drag**: whichever seam is under the hand wins, and the
 * other gives way to its floor. That is the whole of "the pane you are dragging
 * is the one you mean". At rest it is the column's, because the column is the
 * thing just opened to be looked at.
 *
 * It never writes back: yielding changes what is DRAWN and never what is
 * remembered, so closing one returns the other to the size it was dragged to. A
 * layout that edited the remembered width would have made every squeeze
 * permanent.
 *
 * When not even the floors fit, the total returned is larger than `available`
 * and the conversation goes under its own floor. That is deliberate: it is the
 * only reader-visible thing left to give, and the alternative is a row wider
 * than the window — a horizontal scrollbar across the whole app, which is this
 * layout's one way of failing badly.
 */
export function layoutColumns(
  available: number,
  want: Wanted,
  priority: Priority,
): { inspector: number; column: number } {
  const min = { inspector: INSPECTOR_MIN, column: SIDE_MIN };
  const first = priority;
  const second: Priority = priority === 'inspector' ? 'column' : 'inspector';
  const out = { inspector: 0, column: 0 };

  const a = want[first];
  const b = want[second];
  if (a === null && b === null) return out;
  // Alone, it takes what it asks for and the conversation keeps the rest.
  if (b === null) return { ...out, [first]: Math.max(min[first], Math.min(a as number, available)) };
  if (a === null) return { ...out, [second]: Math.max(min[second], Math.min(b, available)) };

  out[first] = Math.max(min[first], Math.min(a, available - min[second]));
  out[second] = Math.max(min[second], Math.min(b, available - out[first]));
  return out;
}

export interface SideLayout {
  /** Drawn widths. `0` where the thing is closed. */
  inspector: number;
  column: number;
  /** Everything the conversation does not get: the rail, what is open, and their seams. */
  gutter: number;
  /**
   * How wide each may be DRAGGED right now — what is free with the other one
   * exactly where it is. A drag capped here can never make `fitColumns` bite,
   * which is what keeps the seam under the pointer (`trackPointer`).
   */
  maxInspector: number;
  maxColumn: number;
}

/**
 * The whole right-hand side of the session in one value.
 *
 * Both are fitted together — the inspector included, even though it lives inside
 * the session and the column beside it. Fitting only the column would let an
 * inspector dragged wide take the room it was about to yield, and the reader
 * would be left dragging one to fix the other.
 */
export function useSideLayout(stored: {
  inspector: number | null;
  /** The file or the subagent transcript, whichever is open — never both. */
  column: number | null;
  /** Which seam is under the hand right now. See `layoutColumns`. */
  priority: Priority;
}): SideLayout {
  const windowWidth = useWindowWidth();
  const { inspector, column, priority } = stored;

  return useMemo(() => {
    const openCount = (inspector === null ? 0 : 1) + (column === null ? 0 : 1);
    const seams = RAIL_PX + openCount * GRIP_PX;
    const available = Math.max(0, windowWidth - seams - CONV_MIN);
    const drawn = layoutColumns(available, { inspector, column }, priority);

    // The ceiling for a DRAG, and it is what the other one can be pushed to
    // rather than where it happens to be: dragging one is what makes it yield.
    // Its own floor is the stop, and it is the conversation's floor that puts
    // it there — which is a limit somebody can feel and act on.
    const maxInspector =
      column === null ? available : Math.max(INSPECTOR_MIN, available - SIDE_MIN);
    const maxColumn =
      inspector === null ? available : Math.max(SIDE_MIN, available - INSPECTOR_MIN);

    return {
      inspector: drawn.inspector,
      column: drawn.column,
      gutter: seams + drawn.inspector + drawn.column,
      maxInspector: Math.min(INSPECTOR_MAX, maxInspector),
      maxColumn: Math.min(SIDE_MAX, maxColumn),
    };
  }, [windowWidth, inspector, column, priority]);
}
