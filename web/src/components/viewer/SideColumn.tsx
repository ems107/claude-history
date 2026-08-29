import type { ReactNode } from 'react';

/**
 * A column beside the session — the file viewer, a subagent's transcript.
 *
 * `Inspector` under another name, and deliberately not the same component: that
 * one owns its panel's title bar, because its six panels are interchangeable
 * contents of one host. These two arrive with a header of their own — a path, a
 * size, four launcher buttons; an agent type, a clock, two jumps — so what is
 * shared is only the seam, the width and the box.
 *
 * The handle is the session list's, mirrored, exactly as the inspector's is:
 * `w-1`, `cursor-col-resize`, and the seam is what you drag rather than the
 * panel's edge.
 */
export function SideColumn({
  kind,
  width,
  onResizeStart,
  children,
}: {
  /** The measurement hook, like `data-inspector` and `data-inspector-rail`. */
  kind: 'file' | 'agent';
  /** What is DRAWN, which the layout may have squeezed below what was remembered. */
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <>
      <div
        className="h-full w-1 shrink-0 cursor-col-resize hover:bg-[var(--accent-dim)]"
        onMouseDown={onResizeStart}
        title="Drag to resize"
      />
      <div
        data-side-column={kind}
        style={{ width }}
        className="flex min-w-0 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg)]"
      >
        {children}
      </div>
    </>
  );
}
