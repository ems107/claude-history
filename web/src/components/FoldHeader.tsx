import type { ReactNode } from 'react';
import { hasSelection } from '../lib/selection.ts';

/**
 * The header of anything that folds — and whose text can be selected.
 *
 * These headers are where the viewer writes the figures worth copying out: the
 * tool name and its arguments, a file path, the dates and cost of a compacted
 * stretch, token counts. A `<button>` lets a user select none of it (no browser
 * does), which made all of it unreachable without retyping — so this is a div
 * with a button role instead, keeping the keyboard route the real element gave
 * for free.
 *
 * Nothing interactive may be nested inside one: put the copy buttons, the cost
 * pills and the subagent link BESIDE it, as siblings in the header row.
 */
export function FoldHeader({
  open,
  onToggle,
  className = '',
  title,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      title={title}
      // Do not fight a selection the user just made in order to copy it.
      onClick={() => {
        if (hasSelection()) return;
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onToggle();
      }}
      className={`cursor-pointer select-text ${className}`}
    >
      {children}
    </div>
  );
}
