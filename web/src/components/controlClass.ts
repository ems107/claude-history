/**
 * What a control looks like — the shapes the app draws over and over.
 *
 * It lived under `viewer/` while `toggleClass` was the only thing in it, and
 * came up here when the settings page needed the other one: a look shared by
 * the viewer, the settings page and the log viewer belongs to none of them.
 * Four things live here now — two shapes with a label, the square without one,
 * and the row they sit in.
 *
 * **Every one of them carries its own touch size, in `max-md:` variants, and
 * that is why they are worth having.** At the desktop's 22 px and 26 px these
 * are fine targets for a pointer and impossible ones for a thumb; fifteen files
 * draw one of these, so the phone's floor is set here once rather than fifteen
 * times. `toggleClass` grows by a minimum height, because it is already
 * `inline-flex` and centres its own label; `actionClass` grows by padding,
 * because it is put on plain `<button>`s that would not centre a taller box.
 * Above 48rem none of the variants apply and the strings are the ones they
 * always were.
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
  return `inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs max-md:min-h-9 max-md:gap-2 max-md:px-2.5 max-md:text-[13px] ${
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
  'cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-40 max-md:px-3 max-md:py-2 max-md:text-sm';

/**
 * The one square control in the app, and the reason it is written here.
 *
 * A phone's chrome is icons in boxes — the bell, the update badge, the filter
 * funnel, the session's ⋮ — and they were five different boxes: two sized by
 * padding around a 14px glyph, two `size-10`, one `min-h-9`. Side by side in
 * the same header that reads as sloppiness, and there is nothing to decide per
 * control: a square is a square. **40px on a phone**, which is the touch floor
 * this work aims at, with the icon centred in it; above 48rem it keeps the
 * padded shape the desktop header has always had, so nothing up there moves.
 *
 * `relative`, because most of them carry a `CountBadge` in the corner.
 */
export function squareClass(active = false): string {
  return `relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded border px-2 py-1 max-md:size-10 max-md:p-0 ${
    active
      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
      : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]'
  }`;
}

/**
 * A row of those, with the one gap the app uses between controls.
 *
 * It was 6px in the app header and 8px everywhere else, which is invisible
 * until the two rows are stacked — the header above the list's toolbar — and
 * then it is the only thing you can see. 8px, because it is what the majority
 * of the rows already were and because at 40px squares a 6px gap reads as a
 * mistake rather than as tightness.
 */
export const controlRow = 'flex items-center gap-2';

/**
 * The size an icon is drawn at inside one of those. 14px reads well beside a
 * label on a desktop and is lost in the middle of a 40px square.
 */
export const squareIcon = 'h-3.5 w-3.5 max-md:size-[18px]';
