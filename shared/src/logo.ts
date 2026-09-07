/**
 * The logo's colour, and everything that has to agree about it.
 *
 * The mark is drawn twice — once as a glyph beside the wordmark
 * (`web/src/components/Brandmark.tsx`, which paints from CSS custom properties)
 * and once as a tile (`web/public/favicon.svg`, which is a file a browser asks
 * for before any of our code runs). The glyph follows the setting through
 * `--logo`; the tile follows it through `tintLogoTile`, which SUBSTITUTES the
 * two hexes in that file rather than redrawing it here. That is deliberate:
 * a second copy of the drawing in TypeScript would be a second thing to keep in
 * step with a mark that already lives in two repositories.
 *
 * What does NOT follow the setting: `favicon.ico`, `apple-touch-icon.png` (which
 * is also the maskable icon Android puts in its launcher) and the icon baked
 * into the Start Menu shortcut. All three are rasters rendered by hand — see
 * `docs/brand/README.md` — and there is no rasteriser in this app.
 */

/**
 * The hex the shipped tile is drawn in, and therefore the default the whole
 * feature is measured against. A fact about `web/public/favicon.svg`, which
 * carries a comment pointing back here — the substitution below is what makes
 * the two one thing rather than two.
 *
 * It is the same colour as `--accent` in `styles.css`, but not the same FACT:
 * the CSS says so with `--logo: var(--accent)`, so the default follows the
 * app's accent for free and this constant never has to know about it.
 */
export const LOGO_DEFAULT_COLOR = '#d97757';

/**
 * The two inks the tile's chevrons can be cut in.
 *
 * Both are warm rather than neutral, for the reason the SVG already gives: on a
 * terracotta ground a cool black goes muddy. Which one a colour gets is not a
 * taste — see `logoInk`.
 */
export const LOGO_INK_DARK = '#2b2320';
export const LOGO_INK_LIGHT = '#f7ece7';

export interface LogoPreset {
  /** Always normalised: lower case, six digits, leading `#`. */
  hex: string;
  /** What the swatch is called, in the picker and in the `default …` marker. */
  label: string;
}

/**
 * The colours offered without typing one, and the first is the default.
 *
 * Chosen at a middle luminance on purpose, which is two constraints at once:
 * light enough to read as a mark on the app's near-black ground, dark enough
 * that the tile still takes the dark ink and looks like the icon that shipped.
 * Anything outside them is still reachable — that is what the custom box is
 * for — and a very dark one gets the light ink instead of losing its chevrons.
 */
export const LOGO_PRESETS: readonly LogoPreset[] = [
  { hex: LOGO_DEFAULT_COLOR, label: 'Claude terracotta' },
  { hex: '#e0a154', label: 'Amber' },
  { hex: '#5fb08a', label: 'Emerald' },
  { hex: '#4fa8b8', label: 'Teal' },
  { hex: '#6f9ee8', label: 'Azure' },
  { hex: '#a98ae8', label: 'Violet' },
  { hex: '#dd7fa8', label: 'Rose' },
];

/** The preset's name where the value is one, so a hex is never read out loud. */
export function logoPresetLabel(hex: string): string | undefined {
  const wanted = normalizeLogoColor(hex);
  return LOGO_PRESETS.find((p) => p.hex === wanted)?.label;
}

/**
 * A colour somebody typed, in the one spelling everything else here expects —
 * or `null`, which is the UI's cue to explain rather than save.
 *
 * `#abc` and `abc` and `#AABBCC` are all things people type into a hex box, and
 * refusing two of the three would be pedantry; storing three spellings of one
 * colour would be worse, because then "is this the default?" and "which swatch
 * is selected?" both stop working. So: one shape in, one shape out.
 */
export function normalizeLogoColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(raw)) return null;
  if (raw.length === 3) return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  if (raw.length === 6) return `#${raw}`;
  return null;
}

/** WCAG relative luminance, which is the only reason this file does arithmetic. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Which ink the chevrons are cut in, on a given ground: **whichever of the two
 * contrasts more.**
 *
 * A threshold would have been a number to argue about and a way to get the
 * shipped icon wrong — the default terracotta sits at a luminance of 0.29,
 * which is exactly where a naive "is it light?" test flips. Comparing the two
 * candidates instead needs no number and cannot: at terracotta the dark ink
 * wins 4.9 to 2.6, so the tile this serves for the default is the tile in the
 * repository, and a navy chosen by hand gets the light ink rather than three
 * invisible chevrons.
 */
export function logoInk(hex: string): string {
  const color = normalizeLogoColor(hex) ?? LOGO_DEFAULT_COLOR;
  return contrast(color, LOGO_INK_DARK) >= contrast(color, LOGO_INK_LIGHT) ? LOGO_INK_DARK : LOGO_INK_LIGHT;
}

/**
 * The shipped tile in another colour.
 *
 * One pass over the text, matching both hexes in a single alternation, so
 * nothing that was just written can be rewritten by the second substitution —
 * which is what would happen to a ground colour that happened to BE the dark
 * ink. Case-insensitive because the file spells one of them in upper case, and
 * global because each appears in the comment as well as in the drawing: the
 * comment describing the icon should describe the icon that was served.
 */
export function tintLogoTile(svg: string, color: string): string {
  const hex = normalizeLogoColor(color) ?? LOGO_DEFAULT_COLOR;
  const ink = logoInk(hex);
  return svg.replace(new RegExp(`${LOGO_DEFAULT_COLOR}|${LOGO_INK_DARK}`, 'gi'), (match) =>
    match.toLowerCase() === LOGO_DEFAULT_COLOR ? hex : ink,
  );
}
