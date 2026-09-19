/**
 * Marking the words that actually changed inside a pair of diff lines.
 *
 * It is the single biggest readability win in a unified diff: a line reported
 * as removed-and-added when one identifier changed makes the reader do the
 * comparison by eye, every time. Pure, and it takes plain strings, so the whole
 * thing is checkable without a browser — the same reason `matchSpans` is
 * written this way.
 */

export interface WordSpan {
  text: string;
  /** Part of what changed, rather than shared with the other side. */
  hit: boolean;
}

/**
 * Words, whitespace runs and punctuation, each as its own token. Splitting on
 * whitespace alone would mark `foo(bar)` and `foo(baz)` as entirely different.
 */
function tokenize(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

/**
 * Lines longer than this are left plain. Past it the marks are noise, the LCS
 * is quadratic, and nobody is reading it word by word anyway.
 */
const MAX_CHARS = 400;

/**
 * The two sides of one changed line, with the differing tokens marked — or null
 * when the pair is not worth marking (too long, or nothing in common).
 */
export function wordDiff(oldText: string, newText: string): { del: WordSpan[]; add: WordSpan[] } | null {
  if (oldText.length > MAX_CHARS || newText.length > MAX_CHARS) return null;
  if (oldText === newText) return null;

  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length === 0 || b.length === 0) return null;

  // Longest common subsequence over tokens. The lines are capped above, so the
  // table stays small.
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const del: WordSpan[] = [];
  const add: WordSpan[] = [];
  const push = (into: WordSpan[], text: string, hit: boolean): void => {
    const last = into[into.length - 1];
    if (last && last.hit === hit) last.text += text;
    else into.push({ text, hit });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(del, a[i], false);
      push(add, b[j], false);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push(del, a[i], true);
      i++;
    } else {
      push(add, b[j], true);
      j++;
    }
  }
  while (i < a.length) push(del, a[i++], true);
  while (j < b.length) push(add, b[j++], true);

  // Two lines with almost nothing in common are two different lines, not an
  // edit, and marking every token in both is worse than marking none. Measured
  // in non-whitespace characters on purpose: `alpha beta` and `!!! ???` share a
  // space and nothing else, which is not a resemblance.
  const shared = del.reduce((n, span) => (span.hit ? n : n + span.text.replace(/\s/g, '').length), 0);
  const smaller = Math.min(oldText.replace(/\s/g, '').length, newText.replace(/\s/g, '').length);
  if (shared * MIN_SHARED_RATIO_DIVISOR < smaller) return null;

  return { del, add };
}

/** At least a quarter of the shorter line has to survive for this to be an edit. */
const MIN_SHARED_RATIO_DIVISOR = 4;

/**
 * The runs worth marking inside a hunk: `n` removals immediately followed by
 * `n` additions, which is what an edit looks like once git has finished with
 * it. Anything else — a pure insertion, a deletion, a lopsided run — gets plain
 * tinting, because pairing those lines up would be a guess.
 */
export function pairedRuns(kinds: readonly ('ctx' | 'add' | 'del' | 'meta' | 'conflict')[]): Map<number, number> {
  const pairs = new Map<number, number>();
  let i = 0;
  while (i < kinds.length) {
    if (kinds[i] !== 'del') {
      i++;
      continue;
    }
    let delEnd = i;
    while (delEnd < kinds.length && kinds[delEnd] === 'del') delEnd++;
    let addEnd = delEnd;
    while (addEnd < kinds.length && kinds[addEnd] === 'add') addEnd++;
    const dels = delEnd - i;
    const adds = addEnd - delEnd;
    // Equal-length runs only, and short ones: a twenty-line rewrite is a
    // rewrite, and pairing line 17 with line 17 says nothing true.
    if (dels === adds && dels > 0 && dels <= 20) {
      for (let k = 0; k < dels; k++) pairs.set(i + k, delEnd + k);
    }
    i = addEnd > i ? addEnd : i + 1;
  }
  return pairs;
}
