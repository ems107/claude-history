import { LOGO_DEFAULT_COLOR, normalizeLogoColor } from '@claude-history/shared';
import { useEffect } from 'react';

/**
 * What the browser's own chrome shows about this app: the colour of the mark,
 * the tab's icon, and the manifest an install reads its name and icon from.
 *
 * Three links between a setting and something outside the page, and all three
 * turned out to need the same push. **A browser does not go back and look.**
 * `--logo` and `--logo-dim` are ours to write; the icon and the manifest are
 * files it decided it already had, and nothing about a setting changing makes
 * it ask again. Each of the two is re-asked by REPLACING its `<link>` element —
 * measured, and the only thing that works: writing `href` on a link the browser
 * has read sends no request at all, and neither does `replaceWith`.
 *
 * **The manifest is read once per page load and never again**, which is sharper
 * than the icon's version of the same rule: Chrome's install dialog shows
 * whatever the DOCUMENT holds, so renaming the app and pressing Install without
 * this would offer to install the previous name — measured through
 * `Page.getAppManifest`, which is the same thing the dialog reads.
 *
 * **And both URLs were poisoned.** For the whole life of this app before these
 * routes existed, the static handler served `/manifest.webmanifest` and
 * `/favicon.svg` with `public, max-age=31536000, immutable` — so every browser
 * that has ever opened it holds a copy it will not revalidate until 2027, and
 * a dynamic route at the same URL is answering a question nobody asks any more.
 * That is why the token below is not an optimisation and is not conditional:
 * `?v=` makes a URL that has never been cached, which is the only way past a
 * year of `immutable`. The server does the same for the icon INSIDE the
 * manifest.
 *
 * **The default is still expressed by writing nothing** where writing nothing
 * is possible: removing the properties leaves `styles.css` in charge, where
 * `--logo` is `var(--accent)`, so "no choice made" and "the accent" cannot
 * drift apart. Only the two links are unconditional, because a cache that has
 * to be beaten has to be beaten every time.
 *
 * Cleanup is not housekeeping here, it is the right answer: `App` unmounts when
 * the session is lost, and the login screen it is replaced by cannot read
 * settings. Losing the colour with the session is what it should do.
 */
export function useAppIdentity(logoColor: string | undefined, appName: string | undefined): void {
  useEffect(() => {
    // Nothing at all until the settings are in. `undefined` here is "not asked
    // yet" rather than "the default", and acting on it swapped both links to
    // the shipped values and then swapped them again a moment later — two
    // requests per page load to say something we did not yet know.
    if (logoColor === undefined) return;
    const hex = normalizeLogoColor(logoColor);
    publish(hex === null || hex === LOGO_DEFAULT_COLOR ? null : hex, appName ?? '');
  }, [logoColor, appName]);

  /**
   * Back to the shipped identity when `App` goes, and ONLY then.
   *
   * As the effect above's own cleanup this also ran between every change —
   * React runs a cleanup before each re-run, not just at unmount — so renaming
   * the app took the colour off the mark and re-fetched both files on its way
   * to setting them again. An effect of its own with no dependencies is the
   * shape that means "on unmount", which is what was meant: `App` is replaced
   * by the login screen when a session is lost, and that screen cannot read
   * settings and is right to wear what the app ships with.
   */
  useEffect(() => () => publish(null, ''), []);
}

/** Write the identity into the document: the properties, then the two links. */
function publish(value: string | null, name: string): void {
  const root = document.documentElement;
  if (value === null) {
    root.style.removeProperty('--logo');
    root.style.removeProperty('--logo-dim');
  } else {
    root.style.setProperty('--logo', value);
    // The faded chevrons, derived rather than chosen: 76 % of the colour over
    // black reproduces `--accent-dim` from `--accent` to within a couple of
    // units, and asking somebody to pick two colours for one mark would be
    // asking them to get the relationship between them right.
    root.style.setProperty('--logo-dim', `color-mix(in srgb, ${value} 76%, #000)`);
  }
  const colour = (value ?? LOGO_DEFAULT_COLOR).slice(1);
  swapLink('icon', `/favicon.svg?v=${colour}`, 'image/svg+xml');
  // The token is what the manifest DEPENDS on — the name it will carry and the
  // colour its icon is tinted in — so it changes exactly when the served
  // manifest would, and never otherwise.
  const token = name === '' ? colour : `${colour}.${encodeURIComponent(name)}`;
  swapLink('manifest', `/manifest.webmanifest?v=${token}`);
}

/**
 * Point one of the document's links somewhere else — by taking the old element
 * OUT and putting a new one in, in that order.
 *
 * Which sounds like ceremony and is the whole reason this function exists. All
 * four ways of doing it were measured against `Network.requestWillBeSent`, and
 * only the insertion of a new node makes a browser ask for anything:
 *
 * - writing `href` on the link it has already read: **no request at all**. The
 *   attribute changes, the DOM says exactly what you wanted it to say, and the
 *   tab wears the old icon until the next reload. This is how the icon shipped
 *   broken, past a check that asserted the attribute instead of the request —
 *   assert what the BROWSER did, not what you told it.
 * - `replaceWith`: also no request. An in-place swap is the same slot as far as
 *   Chrome is concerned.
 * - appending the new one and then removing the old: two requests, the second
 *   for the file being retired.
 * - removing, then appending: one request, for the file we want. This.
 *
 * The fresh node lands at the end of `<head>`, which is harmless: a `rel` is
 * not decided by position. `sizes="any"` rides along on the icon for the
 * reason `index.html` gives — it is the true thing about a scalable file, and
 * it keeps anything declared later from winning the tab by accident.
 */
function swapLink(rel: 'icon' | 'manifest', href: string, type?: string): void {
  const link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (link && link.getAttribute('href') === href) return;
  const fresh = document.createElement('link');
  fresh.rel = rel;
  if (type) fresh.type = type;
  if (rel === 'icon') fresh.sizes.add('any');
  fresh.href = href;
  link?.remove();
  document.head.appendChild(fresh);
}
