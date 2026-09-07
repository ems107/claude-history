import { LOGO_PRESETS, normalizeLogoColor } from '@claude-history/shared';
import { useEffect, useRef, useState } from 'react';
import { entryForField } from '../../lib/settingsCatalog.ts';
import { inputClass, DefaultBadge, Field, GroupCard, Hint } from './controls.tsx';
import { useSettingsPage } from './context.ts';

/**
 * How the app looks — one group, and for now one setting in it.
 *
 * It is the first area in the rail and the one `/settings` lands on, which is
 * where appearance belongs and is also the honest place for the emptiest area
 * on the page: what it holds is the first thing anybody would come here to
 * change, and the rest of the page is what a machine does rather than what it
 * looks like.
 */
export function ThemesArea() {
  return (
    <GroupCard id="logo">
      <LogoColour />
    </GroupCard>
  );
}

/**
 * The mark's colour: seven swatches, and a box for everything else.
 *
 * A row of its own rather than a `SelectField`, because a colour is the one
 * value that can be SHOWN — a dropdown of the words "Amber" and "Teal" is a
 * list of promises, and the swatch is the thing itself. And because there is no
 * closed list to choose from: the seventh option is "any colour", which a
 * `<select>` has no shape for.
 *
 * There is no preview panel, deliberately. A click saves, and the header above
 * this page is the mark at the size it is actually worn — a preview would be a
 * second, smaller copy of what is already on screen.
 */
function LogoColour() {
  const { settings, save } = useSettingsPage();
  const entry = entryForField('logoColor');
  const value = settings.logoColor;

  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const typed = normalizeLogoColor(draft);
  const commit = () => {
    if (typed && typed !== value) save({ logoColor: typed });
  };

  /**
   * The native picker commits on the `change` event, and React's `onChange` is
   * the `input` one — which fires for every pixel dragged through a colour
   * wheel. Bound by hand for the same reason `TextField` waits for a blur: one
   * save is one PUT and one `userdata.json` write, and a drag would be a
   * thousand. `onChange` below still runs, and only moves the draft, so the hex
   * beside the picker follows the wheel while nothing is written.
   */
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, save });
  latest.current = { value, save };
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const commitPicked = () => {
      const hex = normalizeLogoColor(el.value);
      if (hex && hex !== latest.current.value) latest.current.save({ logoColor: hex });
    };
    el.addEventListener('change', commitPicked);
    return () => el.removeEventListener('change', commitPicked);
  }, []);

  return (
    <Field id={entry?.id} badge={<DefaultBadge field="logoColor" />}>
      <span className="mb-2 block">{entry?.label ?? 'Logo colour'}</span>
      {/* Its own size rather than one of `controlClass.ts`'s shapes: those are
          chrome around an icon, and this is the colour itself with nothing in
          it. 36px is a comfortable pointer target and a legible patch of
          colour; 44 on a phone, which is the floor for a control that decides
          something rather than a toolbar chip. */}
      <div className="flex flex-wrap items-center gap-2">
        {LOGO_PRESETS.map((preset) => (
          <button
            key={preset.hex}
            type="button"
            aria-label={preset.label}
            aria-pressed={value === preset.hex}
            title={`${preset.label} · ${preset.hex}`}
            onClick={() => save({ logoColor: preset.hex })}
            style={{ background: preset.hex }}
            className={`h-9 w-9 shrink-0 cursor-pointer rounded-full max-md:h-11 max-md:w-11 ${
              value === preset.hex
                ? 'ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--bg-raised)]'
                : 'ring-1 ring-black/30 hover:ring-2 hover:ring-[var(--text-dim)] hover:ring-offset-2 hover:ring-offset-[var(--bg-raised)]'
            }`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-[var(--text-dim)]">Any other colour</span>
          <input
            ref={picker}
            type="color"
            // The saved value while the draft is unreadable: a colour input has
            // no way to hold "verde", and handed one it would silently show
            // black — a third state on screen that is nobody's choice.
            value={typed ?? value}
            onChange={(e) => setDraft(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5 max-md:h-11 max-md:w-14"
          />
        </label>
        <input
          type="text"
          value={draft}
          spellCheck={false}
          aria-label="Logo colour, as a hex value"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') setDraft(value);
          }}
          className={`w-28 font-mono text-[11px] ${inputClass} max-md:min-h-11`}
        />
      </div>
      <Hint>
        {typed === null && draft.trim() !== ''
          ? 'Not a colour: three or six hex digits, like #d97757 or #abc. Nothing is saved until it is one.'
          : 'The tab icon follows too; the pre-rendered ones — favicon.ico, the Windows shortcut, a phone’s home screen — keep the terracotta they shipped in.'}
      </Hint>
    </Field>
  );
}
