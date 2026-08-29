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
 */
export function Inspector({
  inspector,
  width,
  children,
}: {
  inspector: InspectorState;
  /**
   * What it is DRAWN at, which is not always what it was dragged to: the page
   * fits all three columns beside the conversation together, and this one gives
   * way like the others when a file or a subagent is open beside it. The
   * remembered width (`inspector.width`) is never rewritten by that, so closing
   * the other column brings this one back to the size it was left at.
   */
  width: number;
  children: ReactNode;
}) {
  const item = inspector.items.find((i) => i.key === inspector.open);
  if (!item) return null;

  return (
    <>
      <div
        className="h-full w-1 shrink-0 cursor-col-resize hover:bg-[var(--accent-dim)]"
        onMouseDown={inspector.startResize}
        title="Drag to resize"
      />
      <div
        data-inspector
        style={{ width }}
        className="flex min-w-0 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-raised)]/50"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-1.5">
          <span className="text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
            {item.title}
          </span>
          {item.count !== null && (
            <span className="text-[11px] tabular-nums text-[var(--text-dim)]/70">{item.count}</span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={inspector.close}
            title="Close (Esc)"
            aria-label="Close"
            className="cursor-pointer rounded px-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
