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
  onClose,
  extra,
  closeLabel = 'Done',
  children,
}: {
  title: string;
  onClose: () => void;
  extra?: ReactNode;
  /** `Done` for something being tuned; `Close` for something merely being read. */
  closeLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
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
