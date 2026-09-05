# The mark

A terminal prompt and the trail it leaves behind: the solid chevron is now, the two behind it are what already happened. Terracotta `#D97757`, the accent this app already wore, on a warm near-black `#2B2320` — warm rather than the app's own cool `#0f1115`, because a cool black on terracotta goes muddy.

**This folder holds only what has no home elsewhere.** The mark is not stored twice:

| Where it lives | Which form, and who reads it |
| --- | --- |
| `web/public/favicon.svg` | the tile — the browser tab, and the source every raster below was drawn from |
| `web/public/favicon.ico` | the same tile at 16, 24, 32, 48, 64, 128 and 256 px, and the icon the Start Menu shortcut points at (`installer/install.ps1`) |
| `web/public/apple-touch-icon.png` | 180 px, for a phone that adds the page to its home screen |
| `web/src/components/Brandmark.tsx` | the glyph — the trail with no tile, for the header, which already has a surface of its own |
| `icon-b.svg` *(here)* | the alternative that was not chosen, and the only one with nowhere else to be |

The Android client carries its own copy of the tile, as a VectorDrawable, because Android cannot read SVG. That is a real duplicate across the two repositories and the only one: its `ic_launcher_foreground.xml` names this drawing as its source, and the two have to be changed together.

## Why the tile and the glyph are not the same file

A tile supplies its own background, so it belongs anywhere that gives an icon a box to fill: a launcher, a desktop shortcut, a browser tab. The header already has a surface — a tile there would be a badge sitting on top of one — so it gets the trail alone, in the theme's `--accent` and `--accent-dim` rather than in fixed hexadecimals, which is why the glyph is a component and not an asset.

## Redrawing the rasters

`favicon.svg` is the source. The `.ico` and the touch icon were rendered from it with headless Chrome and assembled by hand; there is no build step for them, on purpose — they change about once in the life of a project, and a script nobody runs rots faster than a paragraph nobody reads.
