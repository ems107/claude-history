import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The columns that open to the RIGHT of the session, beside it rather than over
 * it: the file viewer and a subagent's transcript.
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
 * 400, and the number is measured rather than chosen: it is where the
 * conversation stops scrolling SIDEWAYS. Its content floor was 524 px — the
 * turn's fold strip, a `w-fit` flex row with no `flex-wrap`, drawn at
 * `max-content` however little room it had — and wrapping that strip took it to
 * 364. What holds it there is the message header's trailing run (model, cost,
 * context), and that one stays: its `actions` appear on HOVER, so a header that
 * wrapped could grow a line under the pointer, which is the one thing a hover
 * toolbar may never do.
 *
 * The 36 px between 364 and 400 are not slack. The scroller reserves a scrollbar
 * gutter on BOTH edges — that is what keeps the thread centred — so a 400 px
 * column is a 380 px scroller, and the floor has to clear the content's 364 by
 * that much before it clears it at all.
 */
export const CONV_MIN = 400;

export const FILE_KEY = 'fileColumnWidth';
export const AGENT_KEY = 'agentColumnWidth';
export const FILE_DEFAULT = 620;
export const AGENT_DEFAULT = 560;

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

export interface ColumnWidth {
  /** The width the reader chose. What is DRAWN can be less — see `fitColumns`. */
  width: number;
  startResize: (e: React.MouseEvent) => void;
}

function readWidth(key: string, def: number): number {
  const n = Number(localStorage.getItem(key));
  return Number.isFinite(n) && n > 0 ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, n)) : def;
}

/**
 * One remembered width, dragged from the seam on its LEFT — so the sign is
 * mirrored, exactly as in `useInspector`. The same `mousedown` → document
 * `mousemove`/`mouseup` shape as the session list's sidebar, which is the
 * original of all three.
 */
export function useColumnWidth(key: string, def: number): ColumnWidth {
  const [width, setWidth] = useState(() => readWidth(key, def));

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const from = readWidth(key, def);
      // A cap for the DRAG, not for the layout: `fitColumns` is what keeps the
      // conversation alive when several columns are open at once, and it runs
      // on every render rather than once per gesture.
      const max = Math.max(SIDE_MIN, Math.min(SIDE_MAX, window.innerWidth - RAIL_PX - GRIP_PX - CONV_MIN));
      const onMove = (ev: MouseEvent) => {
        const w = Math.min(max, Math.max(SIDE_MIN, from + startX - ev.clientX));
        setWidth(w);
        localStorage.setItem(key, String(w));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [key, def],
  );

  return useMemo(() => ({ width, startResize }), [width, startResize]);
}

/**
 * The window, in state.
 *
 * The inspector could read `window.innerWidth` once at the start of a drag and
 * never again — a window narrowed afterwards simply squeezed the conversation,
 * which is `flex-1 min-w-0` and shrinks to nothing without complaint. With three
 * `shrink-0` columns beside it that stops being true: the conversation reaches
 * zero and the ROW overflows, which grows the page a horizontal scrollbar. So
 * the fit is recomputed on resize, and this is the value it is recomputed from.
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

export interface FitColumn {
  /** The remembered width — what the reader asked for. */
  width: number;
  /** The floor for this column. */
  min: number;
}

/**
 * How wide each column is actually DRAWN, given what is left for all of them.
 *
 * Proportional, with a floor per column: everything shrinks by the same factor
 * until a column would go under its own minimum, at which point that one stops
 * and gives the rest of the shortfall to the others. Pure, so it can be reasoned
 * about without a browser — like `fold.ts` and `match.ts`.
 *
 * It never writes back: closing one column must return the others to the size
 * they were dragged to, and a fit that edited the remembered width would have
 * quietly made every squeeze permanent.
 *
 * When not even the floors fit, the total returned is larger than `available`
 * and the conversation goes under its own floor. That is deliberate: it is the
 * only reader-visible thing left to give, and the alternative is a row wider
 * than the window — a horizontal scrollbar across the whole app, which is this
 * layout's one way of failing badly.
 */
export function fitColumns(available: number, columns: FitColumn[]): number[] {
  let widths = columns.map((c) => c.width);
  const floored = columns.map(() => false);

  // At most one pass per column can newly hit its floor, plus one to settle.
  for (let pass = 0; pass <= columns.length; pass++) {
    const fixed = widths.reduce((a, w, i) => a + (floored[i] ? w : 0), 0);
    const flex = widths.reduce((a, w, i) => a + (floored[i] ? 0 : w), 0);
    const room = Math.max(0, available - fixed);
    if (flex <= room) break;
    const k = flex === 0 ? 0 : room / flex;
    let hitFloor = false;
    widths = widths.map((w, i) => {
      if (floored[i]) return w;
      const next = w * k;
      if (next < columns[i].min) {
        floored[i] = true;
        hitFloor = true;
        return columns[i].min;
      }
      return next;
    });
    // Nothing newly floored means the scale above was enough.
    if (!hitFloor) break;
  }

  return widths.map(Math.round);
}

export interface SideLayout {
  /** Drawn widths. `0` where the column is closed. */
  inspector: number;
  agent: number;
  file: number;
  /** Everything the conversation does not get: the rail, the open columns and their seams. */
  gutter: number;
}

/**
 * The whole right-hand side of the session in one value.
 *
 * All three columns are fitted together — the inspector included, even though it
 * lives inside the session and the other two beside it. Fitting only the new two
 * would let an inspector dragged wide take the room they were about to yield,
 * and the reader would be left dragging one column to fix another.
 */
export function useSideLayout(stored: {
  inspector: number | null;
  agent: number | null;
  file: number | null;
}): SideLayout {
  const windowWidth = useWindowWidth();
  const { inspector, agent, file } = stored;

  return useMemo(() => {
    const open: Array<{ key: 'inspector' | 'agent' | 'file'; width: number; min: number }> = [];
    // Rail order, left to right — and the order `fitColumns` answers in.
    if (inspector !== null) open.push({ key: 'inspector', width: inspector, min: INSPECTOR_MIN });
    if (agent !== null) open.push({ key: 'agent', width: agent, min: SIDE_MIN });
    if (file !== null) open.push({ key: 'file', width: file, min: SIDE_MIN });

    const seams = RAIL_PX + open.length * GRIP_PX;
    const available = Math.max(0, windowWidth - seams - CONV_MIN);
    const drawn = fitColumns(available, open);

    const out: SideLayout = { inspector: 0, agent: 0, file: 0, gutter: seams };
    open.forEach((c, i) => {
      out[c.key] = drawn[i];
      out.gutter += drawn[i];
    });
    return out;
  }, [windowWidth, inspector, agent, file]);
}
