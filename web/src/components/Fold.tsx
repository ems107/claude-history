import type { ReactNode } from 'react';
import { useState } from 'react';
import { FoldHeader } from './FoldHeader.tsx';

/**
 * A one-line disclosure with a box under it — a brief, a report, an explanation
 * of a figure nobody would guess at.
 *
 * It was private to `SubagentsPanel` until the token panel needed the same
 * thing: its four notes about re-cached context, subagent spend, carried-over
 * tokens and compactions are paragraphs, and paragraphs in a 400 px inspector
 * are a wall. Here rather than duplicated there, so the two cannot drift.
 *
 * A `FoldHeader` and not a `<button>`, per the viewer's rule: what is inside one
 * of these is text worth copying out.
 */
export function Fold({
  label,
  className = 'text-[var(--text-dim)] hover:text-[var(--text)]',
  children,
}: {
  label: string;
  /** The colour of the line, for a note that belongs to an amber or sky figure. */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FoldHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        className={`rounded px-1 py-0.5 text-[11px] hover:bg-[var(--bg-hover)] ${className}`}
      >
        {open ? '▾' : '▸'} {label}
      </FoldHeader>
      {open && (
        <div className="mt-1 mb-1 ml-4 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">{children}</div>
      )}
    </>
  );
}
