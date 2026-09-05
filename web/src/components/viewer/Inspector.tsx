import type { ReactNode } from 'react';
import type { InspectorState } from '../../lib/inspector.ts';

/**
 * The column a panel is drawn in, beside the conversation rather than above it.
 *
 * It owns the three things the panels used to each own a version of: the
 * background, the scroll and the height. That is why every one of them lost its
 * `border-b`, its `bg-[var(--bg-raised)]/50` and — the one that mattered — its
 * `max-h-[45vh] overflow-y-auto`, which inside here would have been a second
 * scroller inside a scroller.
 *
 * The handle is the session list's, turned around: `w-1`, `cursor-col-resize`,
 * and the width it drags is remembered for every panel rather than per panel.
 * One width is what keeps the panels honest — each of them has to read at 320
 * px, which is the work that made the token panel a list of cards instead of a
 * six-column table.
 *
 * **On a phone it is a sheet over the conversation instead**, and the 320px
 * floor is why: with a 72px rail beside it there is not room for both on a
 * 360px screen, and the arithmetic that tried left the conversation four pixels
 * wide. Nothing about the panels changes — they were already written to read at
 * 320 — only the box they are in, which is now the window, with a title bar of
 * its own and Android's Back as a second way out.
 */
export function Inspector({
  inspector,
  mobile,
  width,
  maxWidth,
  children,
}: {
  inspector: InspectorState;
  /** Draw it over the conversation rather than beside it. */
  mobile: boolean;
  /**
   * What it is DRAWN at, which is not always what it was dragged to: it gives
   * way to a column being dragged beside it. The remembered width
   * (`inspector.width`) is never rewritten by that, so closing the column brings
   * this one back to the size it was left at.
   */
  width: number;
  /**
   * The widest a drag may take it right now — `SideLayout.maxInspector`, what
   * is free once the column beside it has given way to its own floor. The stop
   * is the conversation's floor.
   */
  maxWidth: number;
  children: ReactNode;
}) {
  const item = inspector.items.find((i) => i.key === inspector.open);
  if (!item) return null;

  const head = (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-1.5 max-md:px-3 max-md:py-2">
      <span className="text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase max-md:text-sm max-md:normal-case">
        {item.title}
      </span>
      {item.count !== null && (
        <span className="text-[11px] tabular-nums text-[var(--text-dim)]/70 max-md:text-sm">{item.count}</span>
      )}
      <span className="flex-1" />
      <button
        type="button"
        onClick={inspector.close}
        title="Close (Esc)"
        aria-label="Close"
        className="cursor-pointer rounded px-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] max-md:min-h-10 max-md:px-3 max-md:text-lg"
      >
        ✕
      </button>
    </div>
  );

  if (mobile) {
    return (
      <div data-inspector className="fixed inset-0 z-40 flex flex-col bg-[var(--bg)]">
        {head}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    );
  }

  return (
    <>
      <div
        className="h-full w-1 shrink-0 cursor-col-resize touch-none hover:bg-[var(--accent-dim)]"
        onPointerDown={(e) => inspector.startResize(e, maxWidth)}
        title="Drag to resize"
      />
      <div
        data-inspector
        style={{ width }}
        className="flex min-w-0 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-raised)]/50"
      >
        {head}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
