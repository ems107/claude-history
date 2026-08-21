import {
  foldText,
  foldWithMap,
  type SearchHit,
  type SearchQueryEcho,
  type SearchResponse,
  type SearchSnippet,
  type SessionMatchesResponse,
} from '@claude-history/shared';
import type { SearchBlock } from './enricher.ts';
import type { SessionIndex } from './index.ts';
import {
  buildSnippet,
  hasTerm,
  ID_ROLE,
  matchesSessionIds,
  matchWindows,
  occurrences,
  parseTerms,
  type SearchOptions,
  skipBlock,
  SNIPPET_AFTER,
  SNIPPET_BEFORE,
} from './searchText.ts';

const MAX_HITS = 200;
const MAX_SNIPPETS_PER_SESSION = 3;

interface SessionText {
  sig: string;
  blocks: SearchBlock[];
  folded: string[];
}

/**
 * Full-text search over extracted transcript text. Haystacks are folded once
 * and kept in memory (a few MB); a linear indexOf scan over this corpus takes
 * tens of ms. Sessions not yet enriched fall back to title/prompt previews.
 *
 * Tool calls and output are NOT in here — they are forty times the text and are
 * read on demand instead, by deepSearch.ts.
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
    // The session's own id, first, so pasting the eight characters the app puts
    // on a fork chip or a log line finds the session it names. It is part of the
    // corpus like any other block — which is what keeps the counts, the paged
    // match list and the deep scan agreeing about it — but only a query that
    // could BE an id is ever allowed to look at it (`matchesSessionIds`).
    blocks.push({ uuid: null, role: ID_ROLE, text: id });
    // And its agents' ids, for the same reason and one more: an agent id is
    // written into the URL when its drawer opens and shown nowhere else, so
    // until this existed there was no way back from the string to the agent.
    // The row carries which agent it names, because the hit belongs to the
    // parent session and the link has to open the drawer.
    for (const agentId of s?.enrichment?.subagentIds ?? []) {
      blocks.push({ uuid: null, role: ID_ROLE, text: agentId, agentId });
    }
    // The (possibly locally-renamed) title is always searchable.
    if (s && s.titleSource !== 'uuid') blocks.push({ uuid: null, role: 'title', text: s.title });
    // Nothing this method makes up itself carries a `when` — not the ids, not
    // the title, not the previews below — and that is the point of the field
    // being optional: an id is not something written at an hour, and a title is
    // not either. Those rows keep the clock's column and leave it empty rather
    // than dating a session's name by the last thing that happened in it. Every
    // block that IS a line of transcript brings its own, from the enricher.
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

  /** The indexed text of one session, folded — what deepSearch adds tool text to. */
  async unitsOf(id: string): Promise<{ blocks: SearchBlock[]; folded: string[] } | null> {
    return this.ensureSession(id);
  }

  /**
   * One page of EVERY place the query matched in one session, in block order.
   * The search itself shows three snippets a session and counts the rest, which
   * left the count as the only thing said about matches nobody could reach.
   *
   * The whole session is walked on every page — the folded text is already in
   * memory, so a page costs the same milliseconds the search does, and paging
   * that way cannot drift when a live transcript grows between two clicks.
   */
  async matchesIn(
    id: string,
    query: string,
    options: SearchOptions,
    page: { offset: number; limit: number },
  ): Promise<SessionMatchesResponse> {
    const t0 = performance.now();
    const { roles, wholeWord = false } = options;
    const mode = options.mode ?? 'phrase';
    const scope = options.scope ?? 'message';
    const terms = parseTerms(query, mode);
    const ids = matchesSessionIds(terms);
    const echo: SearchQueryEcho = { terms, mode, scope, wholeWord };
    const snippets: SearchSnippet[] = [];
    let total = 0;
    let matchCount = 0;
    let pageMatches = 0;

    const st = terms.length > 0 ? await this.ensureSession(id) : null;
    if (st) {
      for (let bi = 0; bi < st.blocks.length; bi++) {
        if (skipBlock(st.blocks[bi].role, roles, ids)) continue;
        const folded = st.folded[bi];
        if (scope === 'message' && !terms.every((t) => hasTerm(folded, t, wholeWord))) continue;
        let map: number[] | null = null;
        for (const window of matchWindows(folded, terms, wholeWord)) {
          matchCount += window.matches;
          const index = total++;
          // Past the page, but still counted: the figures are about the session,
          // not about what fitted in this response.
          if (index < page.offset || snippets.length >= page.limit) continue;
          map ??= foldWithMap(st.blocks[bi].text).map;
          snippets.push(buildSnippet(st.blocks[bi], folded, map, window.from, window.to, terms, wholeWord));
          pageMatches += window.matches;
        }
      }
    }

    return {
      sessionId: id,
      query: echo,
      snippets,
      offset: page.offset,
      total,
      matchCount,
      pageMatches,
      tookMs: Math.round(performance.now() - t0),
    };
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const t0 = performance.now();
    const { roles, wholeWord = false } = options;
    const mode = options.mode ?? 'phrase';
    const scope = options.scope ?? 'message';
    const terms = parseTerms(query, mode);
    const ids = matchesSessionIds(terms);
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
        if (skipBlock(st.blocks[bi].role, roles, ids)) continue;
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
          snippets.push(buildSnippet(block, st.folded[anchor.bi], map, from, to, terms, wholeWord));
        }
      }

      hits.push({ sessionId: s.id, matchCount, snippets });
      if (hits.length >= MAX_HITS) break;
    }

    return respond();
  }
}
