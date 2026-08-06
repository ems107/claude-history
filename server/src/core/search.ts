import type { SearchHit, SearchResponse, SearchSnippet } from '@claude-history/shared';
import type { SearchBlock } from './enricher.ts';
import type { SessionIndex } from './index.ts';

const MAX_HITS = 200;
const MAX_SNIPPETS_PER_SESSION = 3;
const SNIPPET_BEFORE = 60; // folded chars of context before the match
const SNIPPET_AFTER = 90;

/**
 * Case- and diacritic-insensitive folding: each code point becomes the
 * lowercased base letter of its NFD decomposition ("Código" → "codigo").
 * One folded char per code point, so offsets map back via foldWithMap.
 */
export function foldText(text: string): string {
  let out = '';
  for (const ch of text) {
    out += ch.normalize('NFD').charAt(0).toLowerCase();
  }
  return out;
}

function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    folded += ch.normalize('NFD').charAt(0).toLowerCase();
    map.push(i);
    i += ch.length;
  }
  return { folded, map };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ');
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
    const st: SessionText = { sig, blocks, folded: blocks.map((b) => foldText(b.text)) };
    this.texts.set(id, st);
    return st;
  }

  /** `roles` restricts where to look: any subset of 'title' | 'user' | 'assistant'. */
  async search(query: string, roles?: Set<string>): Promise<SearchResponse> {
    const t0 = performance.now();
    const needle = foldText(query.trim());
    const hits: SearchHit[] = [];
    let scannedSessions = 0;

    for (const s of this.index.list()) {
      const st = await this.ensureSession(s.id);
      if (!st) continue;
      scannedSessions++;

      let matchCount = 0;
      const snippets: SearchSnippet[] = [];
      for (let bi = 0; bi < st.blocks.length; bi++) {
        if (roles && !roles.has(st.blocks[bi].role)) continue;
        const foldedBlock = st.folded[bi];
        let from = 0;
        let idx: number;
        let mapData: { folded: string; map: number[] } | null = null;
        while ((idx = foldedBlock.indexOf(needle, from)) !== -1) {
          matchCount++;
          if (snippets.length < MAX_SNIPPETS_PER_SESSION) {
            mapData ??= foldWithMap(st.blocks[bi].text);
            snippets.push(this.buildSnippet(st.blocks[bi], mapData, idx, needle.length));
          }
          from = idx + needle.length;
        }
      }

      if (matchCount > 0) {
        hits.push({ sessionId: s.id, matchCount, snippets });
        if (hits.length >= MAX_HITS) break;
      }
    }

    return {
      hits,
      scannedSessions,
      tookMs: Math.round(performance.now() - t0),
      indexComplete: this.index.state === 'ready',
    };
  }

  private buildSnippet(
    block: SearchBlock,
    { map }: { folded: string; map: number[] },
    idx: number,
    needleLen: number,
  ): SearchSnippet {
    const text = block.text;
    const at = (foldedIndex: number): number =>
      foldedIndex < map.length ? map[foldedIndex] : text.length;
    const startFold = Math.max(0, idx - SNIPPET_BEFORE);
    const endFold = Math.min(map.length, idx + needleLen + SNIPPET_AFTER);
    const origStart = at(startFold);
    const origMatchStart = at(idx);
    const origMatchEnd = at(idx + needleLen);
    const origEnd = at(endFold);
    return {
      uuid: block.uuid,
      role: block.role,
      before: (startFold > 0 ? '…' : '') + oneLine(text.slice(origStart, origMatchStart)),
      match: oneLine(text.slice(origMatchStart, origMatchEnd)),
      after: oneLine(text.slice(origMatchEnd, origEnd)) + (endFold < map.length ? '…' : ''),
    };
  }
}
