import { LOGO_DEFAULT_COLOR, normalizeLogoColor } from '@claude-history/shared';
import { useEffect } from 'react';

/**
 * The chosen logo colour, published to the two places that draw the mark.
 *
 * `--logo` and `--logo-dim` for everything on the page (the glyph, the word
 * `claude`), and the `<link rel="icon">` for the one thing that is not on the
 * page: the browser tab. The tile itself is not built here — the server tints
 * the shipped `favicon.svg` from the same setting — so this only has to make the
 * tab ASK again, which a link whose href has changed does. Without the query
 * the icon already in the tab is the one that stays: nothing about the setting
 * makes a browser re-fetch a file it has.
 *
 * **The default is expressed by writing nothing.** Removing the properties
 * leaves the `:root` rule in `styles.css` in charge, where `--logo` is
 * `var(--accent)` — so "no choice made" and "the accent" cannot drift apart,
 * and the mark drawn for a default instance is the mark drawn before this
 * feature existed, to the byte. Same reason the icon goes back to the bare
 * `/favicon.svg`: that URL is the one the tile is already drawn in.
 *
 * Cleanup is not housekeeping here, it is the right answer: `App` unmounts when
 * the session is lost, and the login screen it is replaced by cannot read
 * settings. Losing the colour with the session is what it should do.
 */
export function useLogoTheme(color: string | undefined): void {
  useEffect(() => {
    const hex = normalizeLogoColor(color ?? '');
    const root = document.documentElement;
    const apply = (value: string | null) => {
      if (value === null) {
        root.style.removeProperty('--logo');
        root.style.removeProperty('--logo-dim');
      } else {
        root.style.setProperty('--logo', value);
        // The faded chevrons, derived rather than chosen: 76 % of the colour
        // over black reproduces `--accent-dim` from `--accent` to within a
        // couple of units, and asking somebody to pick two colours for one mark
        // would be asking them to get the relationship between them right.
        root.style.setProperty('--logo-dim', `color-mix(in srgb, ${value} 76%, #000)`);
      }
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      const href = value === null ? '/favicon.svg' : `/favicon.svg?v=${value.slice(1)}`;
      // Only when it actually changes: assigning the same href is a second
      // request for the icon already in the tab.
      if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
    };
    apply(hex === null || hex === LOGO_DEFAULT_COLOR ? null : hex);
    return () => apply(null);
  }, [color]);
}
