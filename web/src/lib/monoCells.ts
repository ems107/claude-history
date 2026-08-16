/**
 * Put a drawing back on its grid.
 *
 * The sketches an `AskUserQuestion` option carries are terminal art: every
 * character is meant to occupy one cell (two for an emoji, which is what a
 * terminal gives it — verified on the two framed drawings here that carry one:
 * counting the emoji as 2 makes them rectangular and counting it as 1 does not).
 *
 * A browser does not honour that. The monospace stack on this machine has no
 * glyph for 22 of the 167 characters these drawings use, so Chrome falls back to
 * a proportional symbol font and they come out 0.9 to 2.5 cells wide — `👤` at
 * 2.497, `⟶` at 2.145, `✔` at 1.457, `↺` at 1.422. One of those anywhere in a
 * line shifts everything after it, and 17 of the 23 drawings that Claude drew
 * correctly were arriving crooked because of it. No installed font fixes this:
 * Cascadia covers 6 of the 22 and nothing covers the rest.
 *
 * So the character is measured and, when its advance is not what the grid says
 * it should be, it is given that advance explicitly. Measured rather than taken
 * from a hard-coded list, because the list would be a list of the symbols
 * yesterday's drawings happened to use.
 *
 * What this does NOT fix, and must not pretend to: 19 of the 42 framed drawings
 * in this corpus are crooked in the transcript itself — Claude miscounted by a
 * character or two. Those are shown as they were written.
 */

/** A stretch of a sketch: `cells` is set only where the advance must be forced. */
export interface Run {
  text: string;
  cells: number | null;
}

/** advance in px, keyed by `<font>|<char>` — the font differs between callers. */
const advances = new Map<string, number>();
const cells = new Map<string, number>();

/**
 * How wide a terminal would draw this character: 2 for an emoji, 1 otherwise.
 *
 * The cut at U+1F000 is deliberate. Below it live the dingbats and arrows that
 * a terminal gives ONE cell (`✔`, `⚙`, `⟶`) however wide a browser draws them,
 * so widening those to 2 would break the very lines this exists to straighten.
 */
function gridCells(codePoint: number): number {
  return codePoint >= 0x1f000 ? 2 : 1;
}

/** A hidden twin of `el`, so every measurement uses the font really in force. */
function probeFor(el: HTMLElement): { probe: HTMLSpanElement; key: string } {
  const style = getComputedStyle(el);
  const key = `${style.fontFamily}|${style.fontSize}`;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;top:0;left:0';
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontWeight = style.fontWeight;
  document.body.appendChild(probe);
  return { probe, key };
}

/** Repeated, so the reading is an advance and not one glyph's ink. */
const REPEAT = 16;

function advance(probe: HTMLSpanElement, key: string, text: string): number {
  const memo = `${key}|${text}`;
  const known = advances.get(memo);
  if (known !== undefined) return known;
  probe.textContent = text.repeat(REPEAT);
  const w = probe.getBoundingClientRect().width / REPEAT;
  advances.set(memo, w);
  return w;
}

/**
 * Split a sketch into runs, forcing an advance only where the font gets it
 * wrong. Everything else stays one plain text node — which is what keeps the
 * drawing selectable and copyable as the block of text it is.
 *
 * Returns a single unforced run when there is no DOM to measure against, so a
 * server-side render is the plain text it always was.
 */
export function splitCells(text: string, el: HTMLElement | null): Run[] {
  if (!el || typeof document === 'undefined') return [{ text, cells: null }];
  const { probe, key } = probeFor(el);
  try {
    const cell = advance(probe, key, '0');
    if (!cell) return [{ text, cells: null }];
    const runs: Run[] = [];
    let plain = '';
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      // A newline has no advance to speak of and must stay in the text node, or
      // the `<pre>` loses the line break that makes it a drawing at all.
      let want: number | null = null;
      if (code > 0x7f) {
        const memo = `${key}|${ch}`;
        let n = cells.get(memo);
        if (n === undefined) {
          const grid = gridCells(code);
          n = Math.abs(advance(probe, key, ch) - grid * cell) > 0.05 ? grid : 0;
          cells.set(memo, n);
        }
        want = n || null;
      }
      if (want === null) {
        plain += ch;
        continue;
      }
      if (plain) {
        runs.push({ text: plain, cells: null });
        plain = '';
      }
      runs.push({ text: ch, cells: want });
    }
    if (plain) runs.push({ text: plain, cells: null });
    return runs;
  } finally {
    probe.remove();
  }
}
