import { useEffect, useRef, useState } from 'react';
import {
  WIDTH_FULL,
  WIDTH_MAX,
  WIDTH_MIN,
  widthLabel,
  ZOOM_MAX,
  ZOOM_MIN,
  type ViewPrefs,
} from '../../lib/viewPrefs.ts';
import { toggleClass } from './SessionHeader.tsx';

/**
 * A number you can both step and type. The draft is local so a half-typed "12"
 * is not clamped up to the minimum under the cursor; it commits on Enter or on
 * blur, and Escape puts back what was there.
 */
function NumberField({
  value,
  min,
  max,
  disabled,
  onCommit,
  title,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
  title?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && draft.trim() !== '') onCommit(Math.min(max, Math.max(min, Math.round(n))));
    else setDraft(String(value));
  };

  return (
    <input
      value={disabled ? '' : draft}
      disabled={disabled}
      placeholder={disabled ? '—' : undefined}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') setDraft(String(value));
      }}
      className="w-12 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-right font-mono text-xs tabular-nums focus:border-[var(--accent-dim)] focus:outline-none disabled:opacity-50"
    />
  );
}

function Stepper({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-5 shrink-0 cursor-pointer rounded border border-[var(--border)] text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/**
 * Zoom and width for the conversation thread only — not the page, not the
 * browser. One button rather than four: the header already carries eight.
 */
export function ViewButton({ view }: { view: ViewPrefs }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const full = view.width === WIDTH_FULL;

  return (
    <div ref={ref} className="relative inline-block">
      {/* Lit when something is off its default: a panel nobody can see must
          never change what is on screen in silence. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={toggleClass(!view.isDefault)}
        title="Zoom and width of the conversation thread"
      >
        View{view.isDefault ? '' : ` (${view.zoom}%${full ? ' · full' : ''})`}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded border border-[var(--border)] bg-[var(--bg-raised)] p-2 text-xs shadow-xl">
          <div className="flex items-center gap-1.5 py-1">
            <span className="w-12 shrink-0 text-[var(--text-dim)]">Zoom</span>
            <Stepper label="−" onClick={() => view.stepZoomBy(-1)} disabled={view.zoom <= ZOOM_MIN} />
            <NumberField
              value={view.zoom}
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              onCommit={view.setZoom}
              title={`${ZOOM_MIN}–${ZOOM_MAX}%`}
            />
            <span className="text-[var(--text-dim)]">%</span>
            <Stepper label="+" onClick={() => view.stepZoomBy(1)} disabled={view.zoom >= ZOOM_MAX} />
          </div>

          <div className="flex items-center gap-1.5 py-1">
            <span className="w-12 shrink-0 text-[var(--text-dim)]">Width</span>
            <Stepper label="−" onClick={() => view.stepWidthBy(-1)} disabled={!full && view.width <= WIDTH_MIN} />
            <NumberField
              value={view.width}
              min={WIDTH_MIN}
              max={WIDTH_MAX}
              disabled={full}
              onCommit={view.setWidth}
              title={`${WIDTH_MIN}–${WIDTH_MAX} px`}
            />
            <span className="text-[var(--text-dim)]">px</span>
            <Stepper label="+" onClick={() => view.stepWidthBy(1)} disabled={full} />
            <span className="ml-auto shrink-0 font-semibold text-[var(--text-dim)]">{widthLabel(view.width)}</span>
          </div>

          <button
            type="button"
            onClick={view.reset}
            disabled={view.isDefault}
            className="mt-1 w-full cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-40"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
