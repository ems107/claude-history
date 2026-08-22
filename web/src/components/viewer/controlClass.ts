/**
 * The look of every control in the session header, wherever it is rendered.
 *
 * Its own module because four files draw one of these — the header, the two
 * menus and the find button — and the header is not the right place to import
 * from when the header itself imports one of them.
 *
 * `inline-flex` because most of them now carry a 14 px icon beside their label,
 * and a text-only control looks the same either way.
 */
export function toggleClass(active: boolean, disabled = false): string {
  return `inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${
    disabled
      ? 'cursor-default border-[var(--border)] text-[var(--text-dim)]/50'
      : active
        ? 'cursor-pointer border-[var(--accent)] text-[var(--accent)]'
        : 'cursor-pointer border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
  }`;
}
