/**
 * The little round number that rides a control's top-right corner.
 *
 * Extracted because the same string of classes had been written twice — the
 * update button and the follow pill — and the bell would have been the third.
 * The two were not identical either, and the differences were the reasons this
 * is one component: the pill capped at `99+` where the button would have grown
 * its box, and the pill was `aria-hidden` where the button read its count out
 * twice (once here, once from the title it is already in).
 *
 * The caller owns the box: this is positioned absolutely against the nearest
 * positioned ancestor, so whatever holds it must be `relative`.
 *
 * Nothing is drawn for a count of zero, which is what lets every call site be
 * an unconditional `<CountBadge count={n} />`.
 */

/** Past this the box would grow wider than the control it sits on. */
const MAX = 99;

export function CountBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    // aria-hidden: every call site already carries the count in its `title`,
    // and a bare number floating in the accessibility tree beside a labelled
    // button says nothing about what it counts.
    <span
      aria-hidden="true"
      className={`absolute -top-1.5 -right-1.5 min-w-4 rounded-full border-2 border-[var(--bg)] px-1 text-[9px] leading-3 font-bold ${
        // The halo is `--bg` and not the control's own fill: it has to read as a
        // gap punched through the border, whatever the control is sitting on.
        className || 'bg-amber-400 text-black'
      }`}
    >
      {count > MAX ? `${MAX}+` : count}
    </span>
  );
}
