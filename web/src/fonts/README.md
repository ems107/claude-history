# `terminal-symbols.woff2`

A 3 KB slice of **Noto Sans Symbols 2**, and the only binary in this repo.

## What it is for

The embedded terminal draws whatever the CLI sends, and Claude Code decorates
its own mode line with `⏵⏵ accept edits on` — U+23F5, BLACK MEDIUM
RIGHT-POINTING TRIANGLE. **No font on the Android device this app is checked
against has U+23F4-U+23F7**: not its monospace one, not Noto Sans Symbols, not
the system fallback. What a phone drew there was two empty boxes.

A font is the right answer to a missing glyph. This is that font, kept to the
one block where the hole actually is, and named `ch-terminal-symbols` so it
can only ever be reached deliberately.

It sits at the END of the terminal's font stack (`TERMINAL_FONT` in
`components/viewer/SessionTerminal.tsx`), which is what makes it cost nothing
anywhere else: CSS font fallback is per CHARACTER, so Cascadia Mono goes on
drawing every glyph it has and this is consulted only for the ones it does not.

## What it covers, and why not more

**Miscellaneous Technical, U+2300-23FF, and nothing else.** That is the block
the four media triangles live in, and it is the only block the device was found
to have a hole in.

**A `unicode-range` is a takeover, not a fallback**, and that is why it is one
block. Inside the range this font wins over whatever the system has, so a
second block bought "generality" and immediately redrew the turn bullet the CLI
prints (U+25CF, Geometric Shapes) in a shape nobody had asked to change. The
device was measured — 38 codepoints probed across dingbats, geometric shapes,
box drawing, arrows and symbols, and **four were missing**, all in this block.

One consequence inside the range is worth knowing: U+23F8 (⏸, which Claude Code
puts in front of *plan mode*) used to come from the colour emoji font and now
comes from here, so it is drawn monochrome and takes the CLI's own colour —
which is what a terminal should look like, but it IS a change.

Box drawing is doubly out of scope: xterm draws it geometrically from
`customGlyphs` whatever the font holds.

If another glyph ever appears as a box, widen the ranges below rather than
inventing a substitution — a table of characters to swap is a font written
badly by hand.

## How it was made

```
# The slice Google Fonts already serves for this family, 373 KB
curl -o nss2.woff2 "https://fonts.gstatic.com/s/notosanssymbols2/v25/I_uyMoGduATTei9eI8daxVHDyfisHr71-vrgfE71.woff2"

pip install fonttools brotli
python -m fontTools.subset nss2.woff2 \
  --unicodes="U+2300-23FF" \
  --layout-features='' --no-hinting --desubroutinize --name-IDs='' --notdef-outline \
  --flavor=woff2 --output-file=terminal-symbols.woff2
```

37 glyphs, 2,896 bytes. Vite fingerprints and emits it from the `url()` in
`styles.css`, so nothing in `scripts/package.mjs` knows it exists.

## Licence

SIL Open Font License 1.1 — `OFL.txt` beside it, which is the whole of what the
licence asks of a redistributor. Copyright 2022 The Noto Project Authors.
