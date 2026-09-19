/**
 * The small verb beside a section's title — `+ New`, `stage all`, `discard all`.
 *
 * Its own module because the refs panel and the working tree had each grown one
 * and they had grown differently: a 10px word with 4px of padding in one, an
 * 11px one with a `min-h-11` in the other. Both are the only way to the thing
 * they do, and neither looked like a control at all — on the DT50 they read as
 * a caption to the heading beside them.
 *
 * So: the words stay small, because a section heading is not the place for a
 * button the size of the row below it, and the TARGET is 40 with a background
 * under the finger. The danger tone is a hover colour only — `discard all` asks
 * before it does anything, and a red word at the top of a list is a warning
 * about a list rather than about a button.
 */
export function SectionAction({
  label,
  hint,
  disabled,
  danger,
  onClick,
}: {
  label: string;
  /** What it does, in a sentence. The `aria-label` too: a phone has no tooltip. */
  hint: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      aria-label={hint}
      className={`shrink-0 cursor-pointer rounded px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-30 max-md:inline-flex max-md:min-h-10 max-md:items-center max-md:px-2.5 max-md:text-xs ${
        danger ? 'text-[var(--text-dim)] hover:text-red-300' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The ▾/▸ at the head of a fold, big enough to be one on a phone.
 *
 * 8px wide and 10px tall is a mark rather than a control: it was the only thing
 * saying whether a section was open, at a size you have to look for.
 */
export const CHEVRON = 'w-2 shrink-0 text-center max-md:w-3 max-md:text-sm';
