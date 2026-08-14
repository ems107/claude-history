import { useCallback, useState } from 'react';

/**
 * A pane the user can drag to resize, remembered in localStorage.
 *
 * Lifted from the session list's sidebar, which has done exactly this since the
 * beginning; the git tab wants four of them and copying the same fifteen lines
 * four times is how they start to disagree. The size is read from storage at
 * the START of each drag rather than from state, so a drag always continues
 * from where the last one left off even if something re-rendered in between.
 *
 * Listeners go on `document`, not on the handle: the pointer leaves a 4px strip
 * immediately and a handle-scoped mousemove would drop the drag.
 */
export function useDragSize(options: {
  key: string;
  axis: 'x' | 'y';
  min: number;
  max: number;
  initial: number;
  /** Dragging left/up grows the pane (a handle on its leading edge). */
  invert?: boolean;
}): { size: number; onMouseDown: (e: React.MouseEvent) => void } {
  const { key, axis, min, max, initial, invert } = options;
  const stored = () => {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : initial;
  };
  const [size, setSize] = useState(stored);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const start = axis === 'x' ? e.clientX : e.clientY;
      const startSize = stored();
      const onMove = (ev: MouseEvent) => {
        const now = axis === 'x' ? ev.clientX : ev.clientY;
        const delta = invert ? start - now : now - start;
        const next = Math.min(max, Math.max(min, startSize + delta));
        setSize(next);
        localStorage.setItem(key, String(next));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, axis, min, max, invert],
  );

  return { size, onMouseDown };
}
