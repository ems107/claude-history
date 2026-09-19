import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useBackDismiss } from '../lib/mobile.ts';

/**
 * A panel that opens NEXT TO the thing you pressed, wherever that thing is.
 *
 * The app's dropdowns were `absolute top-full right-0` inside whatever box
 * drew the button, which works right up until that box scrolls or clips — and
 * two of them do. The refs column is `overflow-hidden` around an
 * `overflow-y-auto`, so the merge menu on a branch row was cut off at the
 * column's edge; the answer at the time was to pin the menu to the bottom of
 * the window below 48rem, which fixed the clipping by moving the menu to the
 * other end of the screen from the finger that opened it.
 *
 * This is the other answer: a portal to `document.body`, positioned in `fixed`
 * coordinates from the trigger's own rectangle. Nothing can clip it, it is
 * where you pressed, and the desktop keeps the placement it always had — under
 * the button, right edges aligned — while quietly gaining the same fix.
 *
 * **It closes on scroll**, because a panel anchored to a rectangle that has
 * moved is worse than no panel: it would sit over a row it no longer belongs
 * to, and the next tap would run the wrong thing.
 */

/** How far from the trigger, and how close to the window's edge it may come. */
const GAP = 6;
const MARGIN = 8;

export function Popover({
  anchorRef,
  onClose,
  width = 320,
  label,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** The panel's width. It is clamped to the window, so this is a preference. */
  width?: number;
  /** What the panel IS, for a screen reader — it has no title row of its own. */
  label?: string;
  children: ReactNode;
}) {
  const [box, setBox] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);
  useBackDismiss(true, onClose);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const at = anchor.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - MARGIN * 2);
      // Right edges aligned, which is where these have always opened, then
      // pulled back inside the window rather than allowed to hang off it.
      const left = Math.max(MARGIN, Math.min(at.right - w, window.innerWidth - w - MARGIN));
      const below = window.innerHeight - at.bottom - GAP - MARGIN;
      const above = at.top - GAP - MARGIN;
      // Below unless there is meaningfully more room above: flipping for the
      // sake of twenty pixels puts the panel over the thing you just pressed.
      const flip = below < 200 && above > below;
      /**
       * **Its height is never measured, and that is deliberate.** Reading
       * `scrollHeight` and setting that as the height needs the panel laid out
       * first, which is a frame where it exists at the wrong size — and it came
       * back a few pixels short of the content, so a five-row menu grew a
       * scrollbar and clipped the last line of the last row. Anchoring the
       * edge that touches the trigger and capping the OTHER one lets the panel
       * be exactly as tall as what is in it, up to the room there is.
       */
      const room = Math.min(flip ? above : below, window.innerHeight * 0.7);
      setBox(
        flip
          ? { bottom: window.innerHeight - at.top + GAP, left, maxHeight: room }
          : { top: at.bottom + GAP, left, maxHeight: room },
      );
    };
    place();
    /**
     * Anything that moves the trigger closes this rather than chasing it — but
     * not for the first quarter of a second. The tap that opened it can still
     * be carrying momentum from the flick before it, and a menu that closes
     * itself the instant it appears is indistinguishable from one that never
     * opened.
     */
    const away = () => onClose();
    const arm = setTimeout(() => {
      window.addEventListener('scroll', away, true);
      window.addEventListener('resize', away);
    }, 250);
    return () => {
      clearTimeout(arm);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [anchorRef, onClose, width]);

  return createPortal(
    <>
      {/* Under the panel and over everything else, so a tap anywhere else
          closes it — `mousedown` on the document is not a gesture a thumb
          makes, and it never fired for a touch at all. */}
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div
        role="menu"
        data-popover={label ?? ''}
        aria-label={label}
        style={{
          top: box?.top,
          bottom: box?.bottom,
          left: box?.left ?? -9999,
          width: Math.min(width, window.innerWidth - MARGIN * 2),
          maxHeight: box?.maxHeight,
          // Placed in the same layout pass as the first paint, so this is only
          // a guard against a trigger that has gone away.
          visibility: box ? 'visible' : 'hidden',
        }}
        className="fixed z-[60] overflow-y-auto overscroll-contain rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-1 text-xs shadow-2xl"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
