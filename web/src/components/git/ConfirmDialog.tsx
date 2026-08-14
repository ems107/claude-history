import { useEffect, useRef, useState, type ReactNode } from 'react';
import { btn, dangerBtn, inputClass } from '../../lib/ui.ts';

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

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const ready = !requireTyped || typed === requireTyped;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-32"
      onClick={() => !busy && onCancel()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-w-[92vw] rounded-lg border border-red-500/40 bg-[var(--bg-raised)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">{title}</h2>
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

        <div className="mt-4 flex justify-end gap-1.5">
          <button ref={cancelRef} type="button" onClick={onCancel} className={btn} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={dangerBtn} disabled={!ready || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
