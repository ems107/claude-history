import type { ReactNode, RefObject } from 'react';

export type BubbleSide = 'user' | 'assistant';

/**
 * The tail is ONE element: a 12 px square rotated 45°, offset so a corner
 * pokes out, with only the two edges adjacent to that corner bordered — so it
 * continues the bubble's 1 px outline instead of drawing a second one. It is a
 * child of the bubble, which is what makes it paint over the parent's border
 * exactly where the two meet.
 */
const STYLES: Record<BubbleSide, { shell: string; tail: string }> = {
  user: {
    shell: 'border-[var(--bubble-user-border)] bg-[var(--bubble-user-bg)]',
    tail: '-right-1.5 border-t border-r border-[var(--bubble-user-border)] bg-[var(--bubble-user-bg)]',
  },
  assistant: {
    shell: 'border-[var(--bubble-assistant-border)] bg-[var(--bubble-assistant-bg)]',
    tail: '-left-1.5 border-b border-l border-[var(--bubble-assistant-border)] bg-[var(--bubble-assistant-bg)]',
  },
};

/**
 * A chat bubble: full width (the assistant's markdown carries tables and code
 * blocks that a 70 %-wide column would squeeze), with the speaker told by the
 * colour and by which side the tail comes out of.
 *
 * `group/bubble` is on the shell so a hover toolbar inside can use
 * `group-hover/bubble:` — the same convention as the rename/pin buttons in the
 * session header, named because the fold line runs its own group nearby.
 */
export function Bubble({
  side,
  id,
  header,
  children,
  bodyRef,
  onClick,
  title,
}: {
  side: BubbleSide;
  id?: string;
  /** The meta row (role, time, model, pills). Rendered above the content. */
  header?: ReactNode;
  children?: ReactNode;
  /** The content node, which the copy button reads back as HTML. */
  bodyRef?: RefObject<HTMLDivElement | null>;
  /**
   * Prompts-only mode: clicking the bubble expands its turn. Anything
   * interactive inside (the copy buttons) must stop propagation. This is
   * deliberately not a <button> — it would nest interactive elements — so the
   * keyboard route is the expand strip below the bubble, which is a real one.
   */
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div
      id={id}
      title={title}
      onClick={onClick}
      // A ring, deliberately not a `filter` (brightness/opacity): a filtered
      // ancestor becomes the containing block for `position: fixed`, and the
      // cost and context pills in the header open fixed hover cards that would
      // then anchor to the bubble instead of the viewport.
      className={`group/bubble relative w-full rounded-lg border px-3 py-2 ${STYLES[side].shell} ${
        onClick ? 'cursor-pointer hover:ring-1 hover:ring-[var(--text-dim)]/40' : ''
      }`}
    >
      <span aria-hidden className={`absolute top-4 size-3 rotate-45 ${STYLES[side].tail}`} />
      {header}
      <div ref={bodyRef} className="min-w-0">
        {children}
      </div>
    </div>
  );
}
