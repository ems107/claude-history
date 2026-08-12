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
}: {
  side: BubbleSide;
  id?: string;
  /** The meta row (role, time, model, pills). Rendered above the content. */
  header?: ReactNode;
  children?: ReactNode;
  /** The content node, which the copy button reads back as HTML. */
  bodyRef?: RefObject<HTMLDivElement | null>;
}) {
  // A bubble is text to read and copy, never a control: folding a turn is the
  // fold strip's job alone. Clicking a prompt used to fold it too, which meant
  // an accidental click — or a drag that a selection check let through — hid
  // the answer the user was reading.
  // `data-bubble` is how a deep link finds the box to flash: the anchor it was
  // given can be an alias uuid, which is a zero-sized <span> inside here, and a
  // ring on that is a ring on nothing. `data-bubble-body` keeps the marking off
  // the header, whose words (the role, the model) are not what was searched.
  return (
    <div
      id={id}
      data-bubble={side}
      className={`group/bubble relative w-full rounded-lg border px-3 py-2 ${STYLES[side].shell}`}
    >
      <span aria-hidden className={`absolute top-4 size-3 rotate-45 ${STYLES[side].tail}`} />
      {header}
      <div ref={bodyRef} data-bubble-body className="min-w-0">
        {children}
      </div>
    </div>
  );
}
