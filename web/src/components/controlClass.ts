/**
 * What a control looks like — the two shapes the app draws over and over.
 *
 * It lived under `viewer/` while `toggleClass` was the only thing in it, and
 * came up here when the settings page needed the other one: a look shared by
 * the viewer, the settings page and the log viewer belongs to none of them.
 */

/**
 * The look of every control in the session header, wherever it is rendered.
 *
 * Its own export because four files draw one of these — the header, the two
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

/**
 * The look of a plain action button — the ones that open a folder, take a copy,
 * restore something, refresh a reading.
 *
 * Its own export because five files had this exact string written out in full
 * (`SettingsPage`, the three panels it hosts, and `LogsPage`), which is four
 * chances for one of them to drift on a hover colour nobody would notice.
 *
 * Unlike `toggleClass` it carries the two `disabled:` variants: nothing here
 * reflects a state, but almost every one of them can be refused — by remote
 * access, by a request in flight, or by a Claude of ours still running.
 */
export const actionClass =
  'cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-40';
