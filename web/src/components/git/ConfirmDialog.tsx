import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBackDismiss, useIsMobile } from '../../lib/mobile.ts';
import { actionClass, dangerClass, inputClass } from '../controlClass.ts';

/**
 * The confirmation for anything that cannot be undone.
 *
 * `window.confirm` is what the rest of the app uses, and it is the wrong tool
 * here: it shows one unstyled string and cannot show the command that is about
 * to run — which is exactly the information a git confirmation is made of.
 *
 * The shell is the one the settings page and the update popup already share,
 * plus the two things both of them lack and this one needs: **Escape cancels**,
 * and **the focus lands on Cancel**, so Enter is never the destructive answer.
 *
 * Below 48rem it is the whole screen instead, and that is not a preference: the
 * box had 128px of dead space above it, no `max-h` and no scroll of its own, so
 * the longest of these — the one listing the lines a discard is about to
 * destroy — ran off the bottom of the viewport with Cancel and Confirm past the
 * edge. The pieces are identical either way; only the box changes, and Android's
 * Back joins Escape as a way out.
 */
export function ConfirmDialog({
  title,
  body,
  command,
  requireTyped,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  body: ReactNode;
  /** Shown verbatim: what is about to run, in the words git will hear. */
  command?: string;
  /** Must be typed exactly before the button comes alive. */
  requireTyped?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mobile = useIsMobile();
  useBackDismiss(mobile && !busy, onCancel);

  useEffect(() => {
    cancelRef.current?.focus();
    // In the capture phase and stopping there: this is the innermost layer, and
    // on a narrow window it can be standing on a `Sheet` that answers Escape
    // too. One key closes one thing — the same rule `sheetStack` gives Back.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const ready = !requireTyped || typed === requireTyped;

  return (
    <div
      className={
        mobile
          ? 'fixed inset-0 z-50 flex flex-col bg-[var(--bg)]'
          : 'fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-32'
      }
      onClick={() => !mobile && !busy && onCancel()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={
          mobile
            ? 'flex min-h-0 flex-1 flex-col border-t-2 border-red-500/40 p-3'
            : 'w-[520px] max-w-[92vw] rounded-lg border border-red-500/40 bg-[var(--bg-raised)] p-4 shadow-xl'
        }
      >
        <h2 className="shrink-0 text-sm font-semibold">{title}</h2>
        {/* The body is what can run long — a discard lists every line it is
            about to destroy — so on a phone it is the only part that scrolls,
            and the answer buttons stay where a thumb left them. */}
        <div className={mobile ? 'min-h-0 flex-1 overflow-y-auto' : ''}>
        <div className="mt-2 text-xs text-[var(--text-dim)]">{body}</div>

        {command && (
          <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-[var(--text)]/80">
            {command}
          </pre>
        )}

        {requireTyped && (
          <label className="mt-3 block text-xs">
            <span className="text-[var(--text-dim)]">
              Type <span className="font-mono text-[var(--text)]">{requireTyped}</span> to confirm
            </span>
            <input
              type="text"
              value={typed}
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              className={`${inputClass} mt-1 font-mono text-[11px]`}
            />
          </label>
        )}

        </div>

        <div className="mt-4 flex shrink-0 justify-end gap-1.5">
          <button ref={cancelRef} type="button" onClick={onCancel} className={actionClass} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={dangerClass} disabled={!ready || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
