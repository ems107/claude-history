import type { ReactNode } from 'react';

/**
 * A column beside the session — the file viewer, a subagent's transcript.
 *
 * `Inspector` under another name, and deliberately not the same component: that
 * one owns its panel's title bar, because its panels are interchangeable
 * contents of one host. These two arrive with a header of their own — a path, a
 * size, four launcher buttons; an agent type, a clock, two jumps — so what is
 * shared is only the seam, the width and the box.
 *
 * The handle is the inspector's, through the same `trackPointer`: `w-1`,
 * `cursor-col-resize`, and the seam is what you drag rather than the panel's
 * edge — it is also what that function looks for the panel next to, so the
 * seam must stay the sibling BEFORE it.
 *
 * **On a phone it is the window**, like the inspector: its floor is 240px and
 * the conversation's is 320, which do not fit in 360 together. The panels
 * inside are unchanged — both bring their own header, and the file viewer still
 * scrolls sideways on purpose — so what a phone loses is the split, not the
 * panel. Android's Back closes it, on top of the ✕ each of them already has.
 */
export function SideColumn({
  kind,
  mobile,
  width,
  onResizeStart,
  children,
}: {
  /** The measurement hook, like `data-inspector` and `data-inspector-rail`. */
  kind: 'file' | 'agent';
  /** Draw it over the conversation rather than beside it. */
  mobile: boolean;
  /** What is DRAWN, which the layout may have squeezed below what was remembered. */
  width: number;
  onResizeStart: (e: React.PointerEvent) => void;
  children: ReactNode;
}) {
  if (mobile) {
    return (
      <div data-side-column={kind} className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-[var(--bg)]">
        {children}
      </div>
    );
  }

  return (
    <>
      <div
        className="h-full w-1 shrink-0 cursor-col-resize touch-none hover:bg-[var(--accent-dim)]"
        onPointerDown={onResizeStart}
        title="Drag to resize"
      />
      {/* `overflow-hidden` is the structural half of the promise, and the rows
          inside truncate so it never has to be used: a column is a BOX, and
          nothing in it may grow the page. An overlay could overflow harmlessly —
          it was already floating over everything — but a column that overflows
          puts a horizontal scrollbar under the whole app, which is this
          layout's one way of failing badly. `position: fixed` descendants are
          unaffected, so the hover cards and the image overlay still escape. */}
      <div
        data-side-column={kind}
        style={{ width }}
        className="flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg)]"
      >
        {children}
      </div>
    </>
  );
}
