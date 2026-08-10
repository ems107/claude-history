const WHITESPACE = /\s/;

/**
 * Case-, diacritic- and whitespace-insensitive folding (mirror of the server's
 * search fold in core/search.ts — keep both in step). Runs of whitespace
 * collapse to one space so a phrase stays findable across the line break it
 * was pasted with.
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
    } else {
      inRun = false;
      out += ch.normalize('NFD').charAt(0).toLowerCase();
    }
  }
  return out;
}
