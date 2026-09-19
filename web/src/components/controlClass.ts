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
 * times. Above 48rem none of the variants apply and the strings are the ones
 * they always were.
 *
 * **And on a phone there is ONE number: 40.** `squareClass` is 40×40,
 * `toggleClass` and `actionClass` have a 40px floor, `segmentedClass` is 40
 * tall exactly, and `BAR_H` is there for anything that is none of those and
 * still shares their row. It used to be a range — 36 for a "dense toolbar
 * chip", 40 for a square — and a range is not a rule anybody can follow: what
 * it produced was a 46px segmented control beside a 40px `⋮` in the Git tab's
 * bar, and six pixels of difference on one line is the only thing anybody sees.
 * A floor rather than a fixed height on the two that carry a label, because a
 * label can wrap and a clipped word is worse than a tall button; the boxes with
 * nothing but an icon or a segment in them get the height itself.
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
  return `inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs max-md:min-h-10 max-md:gap-2 max-md:px-2.5 max-md:text-[13px] ${
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
  'cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-40 max-md:inline-flex max-md:min-h-10 max-md:items-center max-md:justify-center max-md:px-3 max-md:py-2 max-md:text-sm';

/**
 * The same button for something that cannot be undone.
 *
 * Its own export because it was written out twice in `DangerZone` and twice
 * more in the Git tab's two dialogs, which is four chances for one red to stop
 * matching the others. The tone is the whole of it: the shape is `actionClass`.
 */
export const dangerClass = `${actionClass} border-red-500/40 text-red-300 hover:border-red-400`;

/**
 * Classes three kinds of input share, so a rework touches one line.
 *
 * Up here rather than with the settings page that first needed them: the Git
 * tab draws text fields too, and a component under `components/git/` importing
 * from `components/settings/` would be a layer put on backwards.
 */
export const inputClass =
  'rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 disabled:opacity-40 focus:border-[var(--text-dim)] focus:outline-none';

/** The same, for a `<select>`, which draws its own arrow and needs a background. */
export const selectClass =
  'cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 disabled:opacity-40';

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
 * **The height of anything in a toolbar row on a phone, in one place.**
 *
 * 40px, which is `squareClass`'s own size, and the rule is that everything
 * standing beside one of those is exactly as tall. It reads as a rule nobody
 * would state until it is broken: the Git tab's bar had a segmented control of
 * 46px (a 40px button inside 2px of padding inside a 1px border) next to a 40px
 * `⋮`, and six pixels of difference between two boxes on the same line is the
 * only thing on that bar anybody noticed.
 *
 * It is a HEIGHT and not a min-height, because the things that use it are boxes
 * with something centred in them rather than text that may wrap — and a
 * min-height is how the 46px happened. Above 48rem nothing applies: a desktop
 * toolbar is sized by its padding, as it always was.
 */
export const BAR_H = 'max-md:h-10';

/**
 * A segmented control: two or three choices in one box, exactly one of them on.
 *
 * For a choice about WHAT YOU ARE LOOKING AT — commits or the working tree, a
 * commit's message or its files. Not for actions, which are buttons, and not
 * for a setting, which is `toggleClass`: the box around the group is the thing
 * that says these are alternatives, and drawing three separate bordered buttons
 * says instead that each is its own idea.
 *
 * The box carries the row's height and the segments fill it, so the whole
 * control is 40px on a phone however tall the label inside is.
 */
export const segmentedClass = `flex min-w-0 items-center rounded border border-[var(--border)] p-0.5 ${BAR_H}`;

export function segmentClass(active: boolean): string {
  return `flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded px-2 text-xs max-md:text-[13px] ${
    active ? 'bg-[var(--accent)]/15 font-medium text-[var(--accent)]' : 'text-[var(--text-dim)]'
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
