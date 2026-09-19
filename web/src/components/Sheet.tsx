import type { ReactNode } from 'react';

/**
 * A panel that becomes the whole screen on a phone.
 *
 * The one shape this app has for "something opened on top of what you were
 * reading, on a screen with no room beside it": a title row that does not
 * scroll, a body that does, and a Done big enough for a thumb. Every phone
 * layer in the app is this shape — the list's filters, the session's actions,
 * the inspector, the Git tab's refs and its dialogs — and it lives up here
 * rather than under `list/`, where it started, because by now four different
 * areas draw one and none of them owns it.
 *
 * Whoever opens it owns Android's Back: `useBackDismiss(open, close)` in the
 * caller, because only the caller knows what "close" means for it.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  extra,
  closeLabel = 'Done',
  children,
}: {
  title: string;
  /** A second line under it — what this layer is ABOUT, where the title is what it is. */
  subtitle?: ReactNode;
  onClose: () => void;
  extra?: ReactNode;
  /** `Done` for something being tuned; `Close` for something merely being read. */
  closeLabel?: string;
  children: ReactNode;
}) {
  return (
    /**
     * **It covers the page, not the app.** `inset-0` took the app header with
     * it — the mark, the usage, the bell and the gear — so opening the branches
     * on a phone meant losing every way out of the Git tab until you found
     * Close. It now sits between the two `usePublishedHeight` variables, which
     * are `0px` whenever the frame is not drawn (a session in landscape, the
     * bar hiding itself while you type), so nothing has to know which case it
     * is in.
     */
    <div
      // A hook for the device harness, which used to find these by their class
      // and lost them the day the class stopped being `inset-0`.
      data-sheet={title}
      className="fixed inset-x-0 top-[var(--app-header-h,0px)] bottom-[var(--app-bar-h,0px)] z-40 flex flex-col bg-[var(--bg)]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
          {subtitle && <span className="min-w-0 truncate text-xs text-[var(--text-dim)]">{subtitle}</span>}
        </span>
        {extra}
        <button
          type="button"
          onClick={onClose}
          className="min-h-10 shrink-0 rounded border border-[var(--border)] px-3 text-sm text-[var(--text-dim)]"
        >
          {closeLabel}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">{children}</div>
    </div>
  );
}
