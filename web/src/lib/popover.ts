import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A menu that closes when you click away or press Escape.
 *
 * Written once because the header has two of them and they must behave
 * identically, and because of the second half, which neither of the popovers
 * this replaces ever did: **Escape closes the menu instead of leaving the
 * page.** `SessionViewPage` listens for Escape on `window` to unwind the file
 * viewer, the drawer, the inspector and the find bar before going back to the
 * list, so a menu that ignored the key was a menu whose Escape navigated away
 * with it still open — harmless with a pair of checkboxes in it, not with the
 * session's actions.
 *
 * The listener is on `document` in the CAPTURE phase, which is what makes
 * stopping it work wherever the focus happens to be: capture on the document
 * runs before a bubble-phase listener on the window, so the page never sees the
 * key at all.
 */
export function usePopover<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close, ref };
}
