import type {
  SearchHit,
  SearchMode,
  SearchQueryEcho,
  SearchResponse,
  SearchSnippet,
  SearchWordScope,
} from '@claude-history/shared';
import type { SearchBlock } from './enricher.ts';
import type { SessionIndex } from './index.ts';

const MAX_HITS = 200;
const MAX_SNIPPETS_PER_SESSION = 3;
const SNIPPET_BEFORE = 60; // folded chars of context before the match
const SNIPPET_AFTER = 90;
/** More than this and the query is a paragraph, not a search. */
const MAX_TERMS = 8;
/** A single character matches half the corpus and still costs a full scan. */
const MIN_TERM_LENGTH = 2;
const WORD_CHAR = /[\p{L}\p{N}]/u;

const WHITESPACE = /\s/;
/** Nonspacing marks: the diacritics themselves, once NFD has split them off. */
const DIACRITIC = /\p{Mn}/u;

/**
 * The single folding loop, shared so the mapped and unmapped variants cannot
 * drift. Each code point becomes the lowercased base letter of its NFD
 * decomposition ("Código" → "codigo"); a code point that IS a diacritic emits
 * nothing, so text already decomposed ("o" + U+0301, which is what a paste
 * from macOS carries) folds exactly like its composed form; and every run of
 * whitespace collapses to one space.
 *
 * So a folded char stands for one code point, one whitespace run, or a base
 * letter with its marks — and `map` (when given) receives the original index
 * of each, that of its first character, which is how snippet offsets map back.
 */
function foldInto(text: string, map: number[] | null): string {
  let out = '';
  let i = 0;
  let inRun = false;
  for (const ch of text) {
    if (WHITESPACE.test(ch)) {
      if (!inRun) {
        inRun = true;
        out += ' ';
        map?.push(i);
      }
    } else if (!DIACRITIC.test(ch)) {
      inRun = false;
      out += ch.normalize('NFD').charAt(0).toLowerCase();
      map?.push(i);
    }
    i += ch.length;
  }
  return out;
}

/**
 * Folds haystack and needle alike, which is why collapsing whitespace matters:
 * pasted logs, XML and stack traces wrap, so a searched phrase must not depend
 * on where the line happened to break ("is invalid according" sat across a
 * newline and could not be found). Snippets are rendered through oneLine()
 * regardless — without this, the text shown and the text searched differ.
 */
export function foldText(text: string): string {
  return foldInto(text, null);
}

function foldWithMap(text: string): { folded: string; map: number[] } {
  const map: number[] = [];
  return { folded: foldInto(text, map), map };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ');
}

export interface SearchOptions {
  /** Restricts where to look: any subset of 'title' | 'user' | 'assistant'. */
  roles?: Set<string>;
  mode?: SearchMode;
  scope?: SearchWordScope;
  wholeWord?: boolean;
}

/**
 * Folds the query and splits it into the terms to look for: in 'words' mode on
 * the single spaces the fold left behind, keeping anything double-quoted
 * together; in 'phrase' mode not at all. A phrase is just the one-term case,
 * which is why a single scan serves both modes.
 *
 * Nothing shorter than MIN_TERM_LENGTH survives, and an empty query yields no
 * terms at all — which is what keeps indexOf away from the empty string, found
 * at every position and never advancing the scan.
 */
function parseTerms(query: string, mode: SearchMode): string[] {
  const folded = foldText(query.trim());
  if (!folded) return [];
  if (mode === 'phrase') return [folded];
  const terms: string[] = [];
  for (const m of folded.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim();
    if (term.length >= MIN_TERM_LENGTH && !terms.includes(term)) terms.push(term);
  }
  return terms.slice(0, MAX_TERMS);
}

/** A match is a whole word when neither side of it is a letter or a digit. */
function isWholeWord(folded: string, idx: number, len: number): boolean {
  const before = idx > 0 ? folded[idx - 1] : '';
  const after = folded[idx + len] ?? '';
  return !WORD_CHAR.test(before) && !WORD_CHAR.test(after);
}

/**
 * Folded positions of `term` at or after `from`, stopping past `until`.
 * A rejected boundary advances by one, not by the term's length: the match it
 * turned down can still overlap a later one that qualifies.
 */
function* occurrences(
  folded: string,
  term: string,
  wholeWord: boolean,
  from = 0,
  until = Number.MAX_SAFE_INTEGER,
): Generator<number> {
  let at = from;
  let idx: number;
  while ((idx = folded.indexOf(term, at)) !== -1 && idx + term.length <= until) {
    if (wholeWord && !isWholeWord(folded, idx, term.length)) {
      at = idx + 1;
      continue;
    }
    yield idx;
    at = idx + term.length;
  }
}

interface SessionText {
  sig: string;
  blocks: SearchBlock[];
  folded: string[];
}

/**
 * Full-text search over extracted transcript text. Haystacks are folded once
 * and kept in memory (a few MB); a linear indexOf scan over this corpus takes
 * tens of ms. Sessions not yet enriched fall back to title/prompt previews.
 */
export class SearchService {
  private texts = new Map<string, SessionText>();

  constructor(private readonly index: SessionIndex) {
    // Drop cached text when a session file changes or is re-enriched.
    this.index.events.on('session-updated', (id: string) => this.texts.delete(id));
  }

  private async ensureSession(id: string): Promise<SessionText | null> {
    const scanned = this.index.getScanned(id);
    if (!scanned) {
      this.texts.delete(id);
      return null;
    }
    const sig = `${scanned.sizeBytes}:${scanned.mtimeMs}`;
    const cached = this.texts.get(id);
    if (cached && cached.sig === sig) return cached;

    const s = this.index.get(id);
    const blocks: SearchBlock[] = [];
    // The (possibly locally-renamed) title is always searchable.
    if (s && s.titleSource !== 'uuid') blocks.push({ uuid: null, role: 'title', text: s.title });
    const entry = await this.index.loadTextBlocks(id);
    if (entry) {
      blocks.push(...entry.blocks);
    } else if (s) {
      // Not enriched yet — previews only.
      if (s.firstPromptPreview) blocks.push({ uuid: null, role: 'user', text: s.firstPromptPreview });
      if (s.lastPromptPreview) blocks.push({ uuid: null, role: 'user', text: s.lastPromptPreview });
    }
    // Some transcripts re-append a line they already wrote, verbatim and with
    // the same uuid (57 of 246 messages in one session here). Keeping both
    // would double every count and spend the snippet budget saying the same
    // thing twice. Identical text under a DIFFERENT uuid is a real repetition
    // and stays.
    const seen = new Set<string>();
    const unique = blocks.filter((b) => {
      const key = `${b.uuid ?? ''}\u0000${b.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const st: SessionText = { sig, blocks: unique, folded: unique.map((b) => foldText(b.text)) };
    this.texts.set(id, st);
    return st;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const t0 = performance.now();
    const { roles, wholeWord = false } = options;
    const mode = options.mode ?? 'phrase';
    const scope = options.scope ?? 'message';
    const terms = parseTerms(query, mode);
    const echo: SearchQueryEcho = { terms, mode, scope, wholeWord };
    const hits: SearchHit[] = [];
    let scannedSessions = 0;
    const respond = (): SearchResponse => ({
      hits,
      scannedSessions,
      tookMs: Math.round(performance.now() - t0),
      indexComplete: this.index.state === 'ready',
      query: echo,
    });

    if (terms.length === 0) return respond();

    for (const s of this.index.list()) {
      const st = await this.ensureSession(s.id);
      if (!st) continue;
      scannedSessions++;

      // Up to MAX_SNIPPETS_PER_SESSION anchors per term, so the snippets can be
      // shared out later instead of the first term taking them all.
      const anchors: { bi: number; idx: number }[][] = terms.map(() => []);
      const termSeen = terms.map(() => false);
      let matchCount = 0;

      for (let bi = 0; bi < st.blocks.length; bi++) {
        if (roles && !roles.has(st.blocks[bi].role)) continue;
        const folded = st.folded[bi];
        const found: number[][] = terms.map(() => []);
        const counts = terms.map(() => 0);
        let allHere = true;
        for (let ti = 0; ti < terms.length; ti++) {
          for (const idx of occurrences(folded, terms[ti], wholeWord)) {
            counts[ti]++;
            if (found[ti].length < MAX_SNIPPETS_PER_SESSION) found[ti].push(idx);
          }
          if (counts[ti] === 0) {
            allHere = false;
            // Nothing else about this block can matter when they must all meet
            // inside it — the remaining terms are not worth scanning for.
            if (scope === 'message') break;
          }
        }
        if (scope === 'message' && !allHere) continue;

        for (let ti = 0; ti < terms.length; ti++) {
          matchCount += counts[ti];
          if (counts[ti] > 0) termSeen[ti] = true;
          for (const idx of found[ti]) {
            if (anchors[ti].length < MAX_SNIPPETS_PER_SESSION) anchors[ti].push({ bi, idx });
          }
        }
      }

      if (matchCount === 0 || !termSeen.every(Boolean)) continue;

      const snippets: SearchSnippet[] = [];
      const windows: { bi: number; from: number; to: number }[] = [];
      const maps = new Map<number, number[]>();
      // Round by round, one term at a time: with several terms and room for
      // three snippets, each gets to show where it landed.
      for (let round = 0; round < MAX_SNIPPETS_PER_SESSION; round++) {
        for (let ti = 0; ti < terms.length && snippets.length < MAX_SNIPPETS_PER_SESSION; ti++) {
          const anchor = anchors[ti][round];
          // Two terms a few characters apart would otherwise produce two nearly
          // identical snippets and spend the budget saying the same thing twice.
          if (!anchor || windows.some((w) => w.bi === anchor.bi && anchor.idx >= w.from && anchor.idx < w.to)) {
            continue;
          }
          const block = st.blocks[anchor.bi];
          let map = maps.get(anchor.bi);
          if (!map) {
            map = foldWithMap(block.text).map;
            maps.set(anchor.bi, map);
          }
          const from = Math.max(0, anchor.idx - SNIPPET_BEFORE);
          const to = Math.min(map.length, anchor.idx + terms[ti].length + SNIPPET_AFTER);
          windows.push({ bi: anchor.bi, from, to });
          snippets.push(this.buildSnippet(block, st.folded[anchor.bi], map, from, to, terms, wholeWord));
        }
      }

      hits.push({ sessionId: s.id, matchCount, snippets });
      if (hits.length >= MAX_HITS) break;
    }

    return respond();
  }

  /**
   * One window of a block, cut at folded offsets and mapped back to the
   * original text, with every term that falls inside it marked — the anchor is
   * only what chose the window, not the only thing worth highlighting.
   */
  private buildSnippet(
    block: SearchBlock,
    folded: string,
    map: number[],
    startFold: number,
    endFold: number,
    terms: string[],
    wholeWord: boolean,
  ): SearchSnippet {
    const text = block.text;
    const at = (foldedIndex: number): number =>
      foldedIndex < map.length ? map[foldedIndex] : text.length;

    const ranges: [number, number][] = [];
    for (const term of terms) {
      for (const idx of occurrences(folded, term, wholeWord, startFold, endFold)) {
        ranges.push([idx, idx + term.length]);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);

    const parts: SearchSnippet['parts'] = [];
    const push = (chunk: string, hit?: true): void => {
      if (chunk) parts.push(hit ? { text: chunk, hit } : { text: chunk });
    };
    let cursor = startFold;
    let lead = startFold > 0 ? '…' : '';
    for (const [start, end] of ranges) {
      // Overlapping terms ("invalid" inside "is invalid") merge into one mark.
      if (end <= cursor) continue;
      push(lead + oneLine(text.slice(at(cursor), at(Math.max(start, cursor)))));
      lead = '';
      push(oneLine(text.slice(at(Math.max(start, cursor)), at(end))), true);
      cursor = end;
    }
    push(lead + oneLine(text.slice(at(cursor), at(endFold))) + (endFold < map.length ? '…' : ''));

    return { uuid: block.uuid, role: block.role, parts };
  }

}
