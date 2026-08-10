const WHITESPACE = /\s/;
const DIACRITIC = /\p{Mn}/u;

/**
 * Case-, diacritic- and whitespace-insensitive folding (mirror of the server's
 * search fold in core/search.ts — keep both in step). Runs of whitespace
 * collapse to one space so a phrase stays findable across the line break it was
 * pasted with, and a code point that is itself a diacritic emits nothing so
 * already-decomposed text folds like its composed form.
 */
export function foldText(text: string): string {
  let out = '';
  let inRun = false;
  for (const ch of text) {
    if (WHITESPACE.test(ch)) {
      if (!inRun) {
        inRun = true;
        out += ' ';
      }
    } else if (!DIACRITIC.test(ch)) {
      inRun = false;
      out += ch.normalize('NFD').charAt(0).toLowerCase();
    }
  }
  return out;
}
