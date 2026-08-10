import { type ReactNode, useRef, useState } from 'react';

/** Matches `w-84` on the card: the anchor is computed in px, so it has to. */
const CARD_WIDTH = 336;
/** Below this much room underneath the pill, the card grows upward instead. */
const CARD_SPACE = 260;

type Anchor = { left: number; top: number } | { left: number; bottom: number };

/**
 * Spans, not divs: a card lives inside a span that can sit inside a button.
 * Every line of every card goes through here so the columns line up.
 */
export function CardLine({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <span className="flex justify-between gap-3">
      <span className="text-[var(--text-dim)]">{label}</span>
      <span className={`font-mono tabular-nums ${tone === 'warn' ? 'text-amber-400' : ''}`}>{value}</span>
    </span>
  );
}

/**
 * A small pill that reveals a panel on hover.
 *
 * The panel is `position: fixed` and placed from the pill's own rect rather than
 * with CSS alone: inside the conversation scroller an absolutely positioned card
 * is at the mercy of every ancestor, and the viewer has plenty. When there is no
 * room below, it anchors to the viewport BOTTOM instead of the top, so it grows
 * upward from the pill and cannot overflow whatever its height turns out to be.
 * It is `pointer-events-none` — nothing in a card is clickable, and it must
 * never eat a click meant for the conversation.
 */
export function HoverCard({
  pill,
  children,
  variant = 'inline',
  title,
}: {
  pill: ReactNode;
  children: ReactNode;
  variant?: 'inline' | 'badge';
  title?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.right - CARD_WIDTH), Math.max(8, window.innerWidth - CARD_WIDTH - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    setAnchor(
      spaceBelow < CARD_SPACE && r.top > spaceBelow
        ? { left, bottom: window.innerHeight - r.top + 6 }
        : { left, top: r.bottom + 6 },
    );
  };

  return (
    <span
      ref={ref}
      title={title}
      onMouseEnter={open}
      onMouseLeave={() => setAnchor(null)}
      className={
        variant === 'badge'
          ? 'shrink-0 cursor-default rounded border border-[var(--border)] px-1.5 py-px font-mono text-[10px] font-normal text-[var(--text-dim)] normal-case tabular-nums hover:border-[var(--text-dim)] hover:text-[var(--text)]'
          : 'shrink-0 cursor-default font-mono text-[10px] font-normal text-[var(--text-dim)] normal-case tabular-nums hover:text-[var(--text)]'
      }
    >
      {pill}
      {anchor && (
        <span
          className="pointer-events-none fixed z-50 block w-84 rounded border border-[var(--border)] bg-[var(--bg-raised)] p-2.5 text-left text-[11px] text-[var(--text)] shadow-2xl"
          style={anchor}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** The header row of a card: what it is on the left, the headline figure on the right. */
export function CardHead({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-[var(--border)] pb-1">
      <span className="min-w-0 truncate">{left}</span>
      <span className="shrink-0 font-mono tabular-nums">{right}</span>
    </span>
  );
}

/** The disclaimer every card ends with, in the one wording the app uses. */
export function CardFoot({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-[10px] text-[var(--text-dim)] opacity-70">{children}</span>;
}
