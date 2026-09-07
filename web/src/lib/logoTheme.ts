import { LOGO_DEFAULT_COLOR, normalizeLogoColor } from '@claude-history/shared';
import { useEffect } from 'react';

/**
 * The chosen logo colour, published to the two places that draw the mark.
 *
 * `--logo` and `--logo-dim` for everything on the page (the glyph, the word
 * `claude`), and the `<link rel="icon">` for the one thing that is not on the
 * page: the browser tab. The tile itself is not built here — the server tints
 * the shipped `favicon.svg` from the same setting — so this only has to make the
 * tab ASK again. A fresh page needs none of it: the tinted tile is what the
 * server answers with. It is the colour changing UNDER an open tab that has to
 * be pushed, and nothing about a setting makes a browser re-fetch a file it
 * already has.
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
/**
 * Point the tab at another icon — by taking the old `<link>` OUT and putting a
 * new one in, in that order.
 *
 * Which sounds like ceremony and is the whole reason this function exists. All
 * four ways of doing it were measured against `Network.requestWillBeSent`, and
 * only the insertion of a new node makes a browser ask for anything:
 *
 * - writing `href` on the link it has already read: **no request at all**. The
 *   attribute changes, the DOM says exactly what you wanted it to say, and the
 *   tab wears the old icon until the next reload. This is how the feature
 *   shipped broken, past a check that asserted the attribute instead of the
 *   request — assert what the BROWSER did, not what you told it.
 * - `replaceWith`: also no request. An in-place swap is the same slot as far as
 *   Chrome is concerned.
 * - appending the new one and then removing the old: two requests, the second
 *   for the icon being retired.
 * - removing, then appending: one request, for the icon we want. This.
 *
 * The fresh node lands at the end of `<head>`, after the `alternate icon`, and
 * that is harmless: the alternate is a fallback by its `rel`, not by its place
 * in the document. The no-op guard stays — with the icon already pointing where
 * it should there is nothing to push and nothing to fetch, which is every
 * ordinary page load, since the server already served the right tile.
 */
function swapIcon(href: string): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link || link.getAttribute('href') === href) return;
  const fresh = document.createElement('link');
  fresh.rel = 'icon';
  fresh.type = 'image/svg+xml';
  fresh.href = href;
  link.remove();
  document.head.appendChild(fresh);
}

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
      swapIcon(value === null ? '/favicon.svg' : `/favicon.svg?v=${value.slice(1)}`);
    };
    apply(hex === null || hex === LOGO_DEFAULT_COLOR ? null : hex);
    return () => apply(null);
  }, [color]);
}
