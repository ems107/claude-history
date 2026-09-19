import { useRef, useState } from 'react';
import { useIsMobile } from '../../lib/mobile.ts';
import { Popover } from '../Popover.tsx';
import { MenuButton, type SplitOption } from './SplitButton.tsx';

/**
 * What can be done to ONE ROW — a branch, a tag, a stash, a changed file.
 *
 * Its own module because two lists needed the same answer to the same question
 * and had each grown a different one: a strip of glyphs at the end of the row.
 * That is right on a desktop, where every glyph explains itself on hover. On
 * the DT50 the branch rows read `→ ⇥ ▾ ✕` and the file rows `+ ↺`, with
 * nothing anywhere to say what any of them did — visible, which the first pass
 * fixed, and still unreadable, which is what was actually wrong. Android has no
 * tooltips, so the words have to be drawn, and four labelled buttons do not fit
 * on a 450px row.
 *
 * So below 48rem the strip becomes one `⋮` and a sheet with room for the whole
 * sentence, the git command under it, and the reason a dead one is dead. Above
 * that line nothing changes at all.
 */
/**
 * The strip itself, on a desktop.
 *
 * Revealed on hover where there is a pointer, and **always drawn below 48rem**.
 * Tailwind v4 compiles `hover:` inside `@media (hover: hover)`, so on a phone
 * `group-hover:opacity-100` never fires at all: these were not hard to find
 * there, they did not exist — and with them went checking out a branch, merging
 * one, deleting one, publishing a tag and every stash verb this tab has.
 */
export const ROW_ACTIONS = 'flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 max-md:opacity-100';

/**
 * One action on a ref row. It always carries a title, and when it is disabled
 * that title is the server's reason rather than the action's name — a dead
 * control that cannot say why is the bug this whole pattern avoids.
 *
 * **On a phone there are no tooltips, so a disabled one is not disabled**: it
 * stays live and its tap puts that same reason where the rest of this
 * repository's refusals are read, under the sections. The alternative the
 * phone rules allow — not drawing it at all — would answer "why can I not check
 * this out" by removing the question, and the sentence is the useful half.
 *
 * 44px square below the fold line, from a 11×17 glyph: these run `git checkout`
 * and `git branch -D`, and a mis-tap between two of them is not a small thing.
 */
export const ACT_CLASS =
  'cursor-pointer px-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-30 max-md:inline-flex max-md:size-11 max-md:items-center max-md:justify-center max-md:px-0 max-md:text-base';

export function Act({
  label,
  title,
  onClick,
  disabled,
  reason,
  danger,
  say,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  reason?: string;
  danger?: boolean;
  /** Where a refusal goes on a screen with no tooltips. */
  say?: (message: string) => void;
}) {
  const mobile = useIsMobile();
  const blocked = !!disabled;
  // `busy` is not a reason anybody needs told — it is a moment, and it passes.
  const explainable = blocked && mobile && !!(reason ?? title) && !!say;
  return (
    <button
      type="button"
      onClick={explainable ? () => say(reason ?? title) : onClick}
      disabled={blocked && !explainable}
      title={blocked ? (reason ?? title) : title}
      aria-label={title}
      className={`${ACT_CLASS} ${danger ? 'hover:text-red-300' : ''} ${explainable ? 'opacity-30' : ''}`}
    >
      {label}
    </button>
  );
}

/**
 * One ref in a list: a branch, a tag, a stash, a worktree.
 *
 * 11px on a desktop, where the panel is a dense index you scan with your eyes.
 * 48 and 13px below 48rem — above the 44px floor rather than on it, because
 * every one of these rows has a `⋮` at the end of it that is itself 40, and a
 * target the exact height of its own row leaves nothing between one branch and
 * the next.
 *
 * **It carries no padding of its own, and `items-stretch` is not a detail.**
 * The padding used to be here and the tappable part was a button inside it,
 * sized to its own text: so the tap flash — which Android paints on the element
 * that was hit — was a 20px strip floating in the middle of a 48px row, inset
 * from both edges. It read as the wrong thing being pressed. The body below
 * takes the padding and the full height instead, so what lights up is exactly
 * what you pressed: everything up to the `⋮`.
 */
export const rowClass =
  'flex w-full items-stretch gap-1.5 pr-2 text-left text-[11px] hover:bg-[var(--bg-hover)]/60 max-md:min-h-12 max-md:gap-2 max-md:text-[13px]';

/** The part of a row that selects it — the whole of it except the `⋮`. */
export const rowBodyClass = 'flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-0.5 text-left';

/** One thing that can be done to a row, in both of its spellings. */
export interface RowAction {
  /** The glyph, for the strip. */
  label: string;
  /** The same thing in words, for the sheet. Never a repeat of the glyph. */
  words: string;
  hint?: string;
  disabled?: boolean;
  reason?: string;
  danger?: boolean;
  run?: () => void;
  /** A sub-menu rather than one action — the merge caret and its variants. */
  menu?: { options: SplitOption[]; mainKey: string };
  /**
   * Leave it out of the sheet, because the menu beside it already lists it.
   *
   * On a desktop the strip has both — one press for the usual thing, a caret
   * for the rest — and that is the right trade there. In a sheet they are two
   * rows saying the same thing, so the strip's shortcut goes and the menu's own
   * entry carries the mark instead.
   */
  coveredByMenu?: boolean;
  /**
   * Drawn as a WORD beside the `⋮` on a phone, rather than inside the sheet.
   *
   * For the one verb on a row that is pressed over and over — staging a file —
   * where a tap to open a sheet and a tap to choose is one tap too many for
   * something you do to six files in a row. At most one per row, and never
   * anything destructive: a word that stages is worth the width, a word that
   * discards is a mis-tap with no undo but the bin.
   */
  primary?: boolean;
}

export function RowActions({
  name,
  actions,
  say,
}: {
  name: string;
  actions: RowAction[];
  say: (message: string) => void;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (actions.length === 0) return null;

  if (!mobile) {
    return (
      <span className={ROW_ACTIONS}>
        {actions.map((a) =>
          a.menu ? (
            <MenuButton
              key={a.label}
              label={a.label}
              title={a.words}
              className={`${ACT_CLASS} px-0.5`}
              disabled={a.disabled}
              options={a.menu.options}
              mainKey={a.menu.mainKey}
            />
          ) : (
            <Act
              key={a.label}
              label={a.label}
              title={a.words}
              disabled={a.disabled}
              reason={a.reason}
              danger={a.danger}
              say={say}
              onClick={() => a.run?.()}
            />
          ),
        )}
      </span>
    );
  }

  const primary = actions.find((a) => a.primary);
  const rest = actions.filter((a) => a !== primary);
  return (
    <>
      {primary && (
        <button
          type="button"
          disabled={primary.disabled && !primary.reason}
          onClick={() => (primary.disabled ? say(primary.reason ?? primary.words) : primary.run?.())}
          className={`min-h-11 shrink-0 cursor-pointer rounded px-2 text-xs text-[var(--text-dim)] ${
            primary.disabled ? 'opacity-40' : ''
          }`}
        >
          {primary.words}
        </button>
      )}
      {/* **A box, not a glyph floating at the end of a row.** Three dots in
          `text-dim` on a dark row is the same weight as the text beside it and
          reads as punctuation; it is the only way to every verb this row has,
          so it is drawn as the button it is. */}
      {rest.length > 0 && (
        <button
          ref={trigger}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`What can be done to ${name}`}
          aria-haspopup="menu"
          className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded border border-[var(--border)] text-base text-[var(--text-dim)] active:bg-[var(--bg-hover)]"
        >
          ⋮
        </button>
      )}
      {open && (
        <Popover anchorRef={trigger} onClose={() => setOpen(false)} label={`What can be done to ${name}`}>
          <p className="truncate px-2 pt-1 pb-1.5 text-[11px] text-[var(--text-dim)]">{name}</p>
          {rest
            .filter((a) => !a.coveredByMenu)
            .flatMap((a) =>
            a.menu
              ? a.menu.options.map((o) => (
                  <RowActionRow
                    key={`${a.label}:${o.key}`}
                    label={o.label}
                    hint={o.blocked ?? o.command}
                    mark={o.key === a.menu?.mainKey ? 'what the button does' : undefined}
                    disabled={!!o.blocked}
                    danger={o.danger}
                    onClick={() => {
                      setOpen(false);
                      o.run();
                    }}
                  />
                ))
              : [
                  <RowActionRow
                    key={a.label}
                    label={a.words}
                    hint={a.disabled ? (a.reason ?? a.hint) : a.hint}
                    disabled={a.disabled}
                    danger={a.danger}
                    onClick={() => {
                      setOpen(false);
                      a.run?.();
                    }}
                  />,
                ],
          )}
        </Popover>
      )}
    </>
  );
}

function RowActionRow({
  label,
  hint,
  mark,
  disabled,
  danger,
  onClick,
}: {
  label: string;
  hint?: string;
  /** Which of several variants the button beside the row would have run. */
  mark?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-12 w-full cursor-pointer items-center gap-3 rounded border-b border-[var(--border)]/60 px-2 py-1.5 text-left last:border-b-0 hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-50 ${
        danger ? 'text-red-300' : ''
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block font-mono text-[11px] text-[var(--text-dim)]">{hint}</span>}
      </span>
      {mark && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{mark}</span>}
    </button>
  );
}


