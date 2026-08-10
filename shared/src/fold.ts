// The one folding used on both sides of the wire. It lived twice — once in the
// server's search and once as a hand-kept copy in the web app, under a comment
// asking whoever touched one to remember the other. That comment failed its
// first test within the hour: the server moved to the lookup table below and the
// copy did not, so emoji folded to a lone surrogate there and collided with each
// other while the server told them apart. There is one implementation now, and
// the web imports it exactly as it already imports DEFAULT_PRICES.

const WHITESPACE = /\s/;
/** Nonspacing marks: the diacritics themselves, once NFD has split them off. */
const DIACRITIC = /\p{Mn}/u;

/**
 * How one UTF-16 unit folds: the lowercased base letter of its NFD decomposition
 * ("ó" → "o"), a single space for anything blank, and nothing at all for a
 * diacritic — so text already decomposed ("o" + U+0301, which is what a paste
 * from macOS carries) folds exactly like its composed form.
 *
 * Half of a surrogate pair falls through untouched (normalize leaves unpaired
 * surrogates alone, and neither property matches one), so the two halves are
 * emitted in turn and the pair survives whole.
 */
function foldUnit(unit: string): string {
  if (WHITESPACE.test(unit)) return ' ';
  if (DIACRITIC.test(unit)) return '';
  return unit.normalize('NFD').charAt(0).toLowerCase();
}

/**
 * Latin-1 holds every accent this corpus uses, so those 256 units are folded
 * once at startup and looked up afterwards. It is the same function that fills
 * the table and handles everything above it, so the fast path cannot disagree
 * with the slow one — and calling normalize() per character instead costs 13
 * MB/s against 100, which is the difference between reading the transcripts on
 * demand and not being able to.
 */
const LATIN1_FOLD = Array.from({ length: 256 }, (_, code) => foldUnit(String.fromCharCode(code)));

/**
 * The single folding loop, shared so the mapped and unmapped variants cannot
 * drift. Every run of whitespace collapses to one space, and `map` (when given)
 * receives the original index of each folded unit — for a run, that of its first
 * character — which is how snippet offsets map back.
 */
function foldInto(text: string, map: number[] | null): string {
  let out = '';
  let inRun = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const folded = code < 256 ? LATIN1_FOLD[code] : foldUnit(text[i]);
    if (folded === '') continue;
    if (folded === ' ') {
      if (inRun) continue;
      inRun = true;
    } else {
      inRun = false;
    }
    out += folded;
    map?.push(i);
  }
  return out;
}

/**
 * Folds haystack and needle alike, which is why collapsing whitespace matters:
 * pasted logs, XML and stack traces wrap, so a searched phrase must not depend
 * on where the line happened to break ("is invalid according" sat across a
 * newline and could not be found). Snippets are rendered on one line regardless
 * — without this, the text shown and the text searched differ.
 */
export function foldText(text: string): string {
  return foldInto(text, null);
}

/** The same fold, plus where each folded unit came from. Snippet offsets need it. */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  const map: number[] = [];
  return { folded: foldInto(text, map), map };
}
