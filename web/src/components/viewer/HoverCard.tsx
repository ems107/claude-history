import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
 *
 * **On a touch screen it opens on a TAP**, because hover does not exist there
 * and this was the only way to the figures behind it: what a turn cost, how it
 * was split, what the context was made of. Not merely hard to reach — Tailwind
 * v4 compiles `hover:` inside `@media (hover: hover)`, so on a phone the pill
 * did not even light up. A tap toggles it and the next tap anywhere puts it
 * away; the card stays `pointer-events-none`, so that next tap can be on the
 * card itself and still dismisses it. Decided per POINTER rather than per
 * breakpoint: a touchscreen laptop at 1400px has the same problem.
 */
// A 10px pill is a fine target for a pointer and none at all for a thumb, and
// on a phone it is now the only door to the card behind it.
const PILL_BASE =
  'shrink-0 cursor-default font-mono text-[10px] font-normal normal-case tabular-nums max-md:text-[11px]';
const PILL_TONE = {
  default: {
    inline: 'text-[var(--text-dim)] hover:text-[var(--text)]',
    badge:
      'rounded border border-[var(--border)] px-1.5 py-px text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]',
  },
  // Amber, the colour this app already spends on "true, and you would not have
  // guessed": carried-over tokens, a rewound branch, a compaction.
  warn: {
    inline: 'text-amber-400/90 hover:text-amber-300',
    badge: 'rounded border border-amber-500/40 px-1.5 py-px text-amber-400/90 hover:border-amber-400 hover:text-amber-300',
  },
} as const;

export function HoverCard({
  pill,
  children,
  variant = 'inline',
  tone = 'default',
  title,
}: {
  pill: ReactNode;
  children: ReactNode;
  variant?: 'inline' | 'badge';
  /** `warn` marks a pill whose figure needs explaining, not merely reading. */
  tone?: 'default' | 'warn';
  title?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  /** Held open by a tap rather than by a pointer resting on it. */
  const [tapped, setTapped] = useState(false);

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

  // The tap that opens it must not also be the tap that closes it, so the
  // listener goes on in the next task — and in the CAPTURE phase, so a card
  // opened over a fold header is dismissed before the header sees the press.
  useEffect(() => {
    if (!tapped) return;
    const close = () => {
      setTapped(false);
      setAnchor(null);
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', close, true);
    };
  }, [tapped]);

  return (
    <span
      ref={ref}
      title={title}
      onMouseEnter={open}
      onMouseLeave={() => !tapped && setAnchor(null)}
      onPointerUp={(e) => {
        // A mouse already has hover; this is for the pointers that do not.
        if (e.pointerType === 'mouse') return;
        // The pill lives inside fold headers and inside a scroller that treats a
        // click as "select this message". Neither meant this one.
        e.stopPropagation();
        if (tapped) {
          setTapped(false);
          setAnchor(null);
        } else {
          open();
          setTapped(true);
        }
      }}
      className={`${PILL_BASE} ${PILL_TONE[tone][variant]}`}
    >
      {pill}
      {/* Portalled to the body, not rendered in place: the card is positioned
          from viewport coordinates, and the thread can carry a `zoom`, which
          rescales the coordinate system of every fixed descendant. Out here it
          answers to the viewport alone. */}
      {anchor &&
        createPortal(
          <span
            className="pointer-events-none fixed z-50 block w-84 rounded border border-[var(--border)] bg-[var(--bg-raised)] p-2.5 text-left text-[11px] text-[var(--text)] shadow-2xl"
            style={anchor}
          >
            {children}
          </span>,
          document.body,
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
