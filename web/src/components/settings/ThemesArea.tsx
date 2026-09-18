import { APP_NAME, LOGO_PRESETS, normalizeLogoColor } from '@claude-history/shared';
import { useEffect, useRef, useState } from 'react';
import { useMedia } from '../../lib/mobile.ts';
import { entryForField } from '../../lib/settingsCatalog.ts';
import { useSettingsPage } from './context.ts';
import { Anchored, DefaultBadge, Explain, Field, GroupCard, Hint, inputClass, Readout, ReadoutRow, TextField } from './controls.tsx';

/**
 * How the app looks, and what it is called.
 *
 * It is the first area in the rail and the one `/settings` lands on, which is
 * where appearance belongs. Three groups, and the order is the order the
 * answers depend on each other: the mark, the name it wears, and then the one
 * place both of them end up that is not a browser tab — an installed app, whose
 * icon is the mark and whose label is the name.
 */
export function ThemesArea() {
  return (
    <>
      <GroupCard id="logo">
        <LogoColour />
      </GroupCard>
      <GroupCard id="app-name">
        <TextField
          field="appName"
          prefix={APP_NAME}
          hint="Follows the name in the box, in the browser tab and in the app if you install it. Empty is that name on its own."
        />
      </GroupCard>
      <GroupCard id="install">
        <Installed />
      </GroupCard>
    </>
  );
}

/** Is this window the installed app rather than a tab? */
const STANDALONE_QUERY = '(display-mode: standalone)';

/**
 * Whether this app can be installed on this machine, from this address — read
 * from the browser rather than guessed, because the answer really does differ
 * per device and getting it wrong would be telling somebody to look for a
 * button that is not there.
 *
 * State and not a preference, so it is a `Readout`: there is nothing here to
 * change. **And there is no Install button of ours**, which is a limit rather
 * than an omission — Chrome dropped the service-worker requirement for
 * installing from its own menu (108 on mobile, 112 on desktop) but kept it for
 * `beforeinstallprompt`, so a page with no service worker cannot raise the
 * prompt itself. A service worker with no other purpose than to unlock a button
 * is a cache and a lifecycle in a local tool, bought for a button; pointing at
 * the one the browser already draws costs nothing and cannot go stale.
 */
function Installed() {
  const standalone = useMedia(STANDALONE_QUERY);
  // `localhost` and `127.0.0.1` are secure contexts whatever the scheme; a LAN
  // address over plain HTTP is not, and installing needs one. So a phone
  // reading this over remote access is told the truth instead of being sent
  // looking for a button its browser will never draw.
  const secure = window.isSecureContext;
  return (
    <Anchored id="info-install">
      <Readout>
        <ReadoutRow label="this window">
          {standalone ? 'the installed app' : 'a browser tab'}
        </ReadoutRow>
        <ReadoutRow label="installable">
          {standalone
            ? 'already — this IS the installed app'
            : secure
              ? 'yes — the ⊕ Install button at the right of the address bar, in Chrome or Edge'
              : `no from this address (${window.location.host}) — plain HTTP outside localhost is not a secure context`}
        </ReadoutRow>
      </Readout>
      <Explain label="What installing does, and what it does not">
        <p>
          It gets its own window with no address bar and no tabs, its own entry in the Start Menu and the taskbar, and
          the tinted tile as its icon. It is the same server on the same port — nothing is copied to disk and nothing
          works offline, so with the server stopped the window is as empty as the tab would be.
        </p>
        <p>
          <strong>The name is taken when you install.</strong> Renaming it here renames the tab at once, and an app that
          is already installed follows later or not at all: Chrome re-reads the manifest on its own schedule.
          Reinstalling is the way to be sure.
        </p>
        <p>
          Two things this cannot rename: the <strong>Start Menu shortcut the installer made</strong>, which is a
          <code>.lnk</code> written on disk when claude-history was installed, and anything on a phone —{' '}
          <em>Add to home screen</em> in Chrome for Android is a shortcut rather than an install, which is why it works
          over the network where this does not.
        </p>
      </Explain>
    </Anchored>
  );
}

/**
 * The mark's colour: seven swatches, and a box for everything else.
 *
 * A row of its own rather than a `SelectField`, because a colour is the one
 * value that can be SHOWN — a dropdown of the words "Amber" and "Teal" is a
 * list of promises, and the swatch is the thing itself. And because there is no
 * closed list to choose from: after the seven comes "any colour", which a
 * `<select>` has no shape for.
 *
 * There is no preview panel, deliberately, and the accent following the mark is
 * what settled it: a click saves, and the page it saves on is already wearing
 * the answer — the mark in the header, the swatch's own ring, this area's rail
 * entry, the toggles further down. A preview would be a small copy of a screen
 * that has just repainted.
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
      {/* The words wrap away from the controls at 360px, and the two controls
          never wrap away from EACH OTHER: they are one choice made two ways, and
          a picker stranded on the line above the hex it fills in reads as two
          unrelated boxes. So the pair is its own flex item, and the label is a
          `<span>` with an `aria-label` on each input rather than a `<label>`
          wrapping one of them. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[var(--text-dim)]">Any other colour</span>
        <span className="flex items-center gap-2">
          <input
            ref={picker}
            type="color"
            aria-label="Logo colour, from a colour picker"
            // The saved value while the draft is unreadable: a colour input has
            // no way to hold "verde", and handed one it would silently show
            // black — a third state on screen that is nobody's choice.
            value={typed ?? value}
            onChange={(e) => setDraft(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5 max-md:h-11 max-md:w-14"
          />
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
        </span>
      </div>
      <Hint>
        {typed === null && draft.trim() !== ''
          ? 'Not a colour: three or six hex digits, like #d97757 or #abc. Nothing is saved until it is one.'
          : 'It colours the app as well as the mark — the buttons, the highlights, a terminal’s cursor — and the tab icon with it; the pre-rendered ones — favicon.ico, the Windows shortcut, a phone’s home screen — keep the terracotta they shipped in.'}
      </Hint>
    </Field>
  );
}
