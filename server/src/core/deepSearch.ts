import {
  foldText,
  foldWithMap,
  type DeepScanInfo,
  type SearchHit,
  type SearchQueryEcho,
  type SearchResponse,
  type SearchSnippet,
} from '@claude-history/shared';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.ts';
import type { SearchBlock } from './enricher.ts';
import type { SessionIndex } from './index.ts';
import { isRec, replayFilter, safeParse, str, streamLines } from './jsonl.ts';
import { createLogger } from './logger.ts';
import type { SearchService } from './search.ts';
import {
  buildSnippet,
  occurrences,
  parseTerms,
  type SearchOptions,
  SNIPPET_AFTER,
  SNIPPET_BEFORE,
} from './searchText.ts';

const log = createLogger('deep-search');

/**
 * A deep hit has both corpora to show from, so it gets more room than the plain
 * search's three — pressing the button must never show less than not pressing it.
 */
const MAX_SNIPPETS_PER_SESSION = 6;
const MAX_SNIPPETS_PER_TERM = 3;
const MAX_HITS = 200;
/** An offloaded output this big is a dump, not a message; read the head of it. */
const MAX_PERSISTED_BYTES = 2 * 1024 * 1024;
/**
 * A whole-corpus scan runs in about four seconds here. The ceiling is not for
 * that — it is so a corpus ten times the size answers late rather than never,
 * and says how far it got.
 */
const BUDGET_MS = 30_000;
/** Date.now() per line would be noise on half a million of them. */
const LINES_PER_CLOCK_CHECK = 512;

interface DeepRequest {
  query: string;
  options: SearchOptions;
  /** The sessions the caller can actually see; everything, when absent. */
  sessionIds?: string[];
  signal?: AbortSignal;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (isRec(b) && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function toolCallText(block: Record<string, unknown>): string {
  const name = str(block.name) ?? 'tool';
  // The input as written: a command, a path, a pattern. Searching it answers
  // "which session ran that" as well as any prose would.
  return `${name} ${JSON.stringify(block.input ?? {})}`;
}

/**
 * Reads what the index deliberately leaves out. Tool calls and their output are
 * forty times the text of the prose, so they are streamed on demand, one chunk
 * at a time and never accumulated: at 100 MB/s of folding, the whole 470 MB of
 * transcripts costs a few seconds and no memory that outlives the request.
 *
 * The result is a superset of the ordinary search, not a separate one -- the
 * indexed text is matched again here (it is already folded and in memory), so
 * "all words anywhere in the session" can pair a word from a prompt with one
 * from a tool result, which merging two result sets afterwards could never do.
 */
export class DeepSearchService {
  constructor(
    private readonly config: AppConfig,
    private readonly index: SessionIndex,
    private readonly search: SearchService,
  ) {}

  async run(request: DeepRequest): Promise<SearchResponse> {
    const t0 = performance.now();
    const { roles, wholeWord = false } = request.options;
    const mode = request.options.mode ?? 'phrase';
    const scope = request.options.scope ?? 'message';
    const terms = parseTerms(request.query, mode);
    const echo: SearchQueryEcho = { terms, mode, scope, wholeWord };
    const only = request.sessionIds ? new Set(request.sessionIds) : null;

    const hits: SearchHit[] = [];
    const scan: DeepScanInfo = { sessionsRead: 0, bytesRead: 0, stoppedEarly: false };
    const respond = (): SearchResponse => ({
      hits,
      scannedSessions: scan.sessionsRead,
      tookMs: Math.round(performance.now() - t0),
      indexComplete: this.index.state === 'ready',
      query: echo,
      deep: scan,
    });

    if (terms.length === 0) return respond();

    const deadline = performance.now() + BUDGET_MS;
    log.info(`deep search started for ${terms.length} term(s)`, {
      terms,
      mode,
      scope,
      wholeWord,
      sessions: only ? only.size : this.index.list().length,
    });

    for (const summary of this.index.list()) {
      if (only && !only.has(summary.id)) continue;
      if (request.signal?.aborted || performance.now() > deadline) {
        scan.stoppedEarly = true;
        break;
      }
      const hit = await this.scanSession(summary.id, terms, { roles, wholeWord, scope }, request, deadline, scan);
      scan.sessionsRead++;
      if (hit) hits.push(hit);
      if (hits.length >= MAX_HITS) {
        scan.stoppedEarly = true;
        break;
      }
    }

    const answer = respond();
    const how = request.signal?.aborted ? 'cancelled' : scan.stoppedEarly ? 'stopped early' : 'complete';
    log.info(
      `deep search ${how}: ${hits.length} session(s), ${(scan.bytesRead / 1048576).toFixed(1)} MB read in ${answer.tookMs} ms`,
      { terms, sessionsRead: scan.sessionsRead, bytesRead: scan.bytesRead, hits: hits.length },
    );
    return answer;
  }

  private async scanSession(
    id: string,
    terms: string[],
    match: { roles?: Set<string>; wholeWord: boolean; scope: string },
    request: DeepRequest,
    deadline: number,
    scan: DeepScanInfo,
  ): Promise<SearchHit | null> {
    const { roles, wholeWord, scope } = match;
    const perTerm = terms.map(() => 0);
    const snippets: SearchSnippet[] = [];
    const shown = terms.map(() => false);
    let matchCount = 0;

    /**
     * One unit of text -- an indexed block or a streamed tool chunk. Snippets are
     * cut here and now, because the chunk is gone on the next iteration; a
     * session that turns out not to qualify simply throws them away, which costs
     * six windows at worst.
     */
    const consume = (block: SearchBlock, folded: string): void => {
      const counts = terms.map(() => 0);
      const found: number[][] = terms.map(() => []);
      let allHere = true;
      for (let ti = 0; ti < terms.length; ti++) {
        for (const idx of occurrences(folded, terms[ti], wholeWord)) {
          counts[ti]++;
          if (found[ti].length < MAX_SNIPPETS_PER_TERM) found[ti].push(idx);
        }
        if (counts[ti] === 0) {
          allHere = false;
          if (scope === 'message') break;
        }
      }
      if (scope === 'message' && !allHere) return;
      for (let ti = 0; ti < terms.length; ti++) {
        perTerm[ti] += counts[ti];
        matchCount += counts[ti];
      }

      let map: number[] | null = null;
      const windows: [number, number][] = [];
      /**
       * A term that has yet to appear anywhere always gets its slot; a second
       * window for a term that already has one is only cut while enough of the
       * budget is left for the terms still unseen. Without that reservation an
       * early chunk full of one word would spend everything, and the word that
       * only turns up in the last tool result would never be shown at all.
       */
      const roomForMore = (): boolean =>
        snippets.length + shown.filter((s) => !s).length < MAX_SNIPPETS_PER_SESSION;

      for (let round = 0; round < MAX_SNIPPETS_PER_TERM; round++) {
        for (let ti = 0; ti < terms.length; ti++) {
          if (snippets.length >= MAX_SNIPPETS_PER_SESSION) return;
          const idx = found[ti][round];
          if (idx === undefined) continue;
          if (shown[ti] && !roomForMore()) continue;
          // Two terms a few characters apart would say the same thing twice.
          if (windows.some(([from, to]) => idx >= from && idx < to)) continue;
          shown[ti] = true;
          map ??= foldWithMap(block.text).map;
          const from = Math.max(0, idx - SNIPPET_BEFORE);
          const to = Math.min(map.length, idx + terms[ti].length + SNIPPET_AFTER);
          windows.push([from, to]);
          snippets.push(buildSnippet(block, folded, map, from, to, terms, wholeWord));
        }
      }
    };

    // The prose first: already folded and in memory, so it costs nothing.
    const indexed = await this.search.unitsOf(id);
    if (indexed) {
      for (let i = 0; i < indexed.blocks.length; i++) {
        if (roles && !roles.has(indexed.blocks[i].role)) continue;
        consume(indexed.blocks[i], indexed.folded[i]);
      }
    }

    for await (const chunk of this.toolChunks(id, request, deadline, scan)) {
      consume(chunk, foldText(chunk.text));
    }

    if (matchCount === 0 || !perTerm.every((n) => n > 0)) return null;
    return { sessionId: id, matchCount, snippets };
  }

  /**
   * Everything textual that the index does not hold: tool calls and their
   * output from the transcript, the outputs offloaded to tool-results/, and the
   * whole of every subagent transcript -- 54 MB of this corpus that no search
   * could reach at all until now.
   */
  private async *toolChunks(
    id: string,
    request: DeepRequest,
    deadline: number,
    scan: DeepScanInfo,
  ): AsyncGenerator<SearchBlock> {
    const scanned = this.index.getScanned(id);
    if (!scanned) return;

    let lines = 0;
    // The indexed text arrives deduplicated by uuid+text; the tool output it
    // does not hold has to earn the same treatment here, or a compaction's
    // replay (see `replayFilter`) spends the snippet budget twice on one
    // command and counts its matches again.
    const isReplay = replayFilter();
    const overBudget = (): boolean => {
      if (request.signal?.aborted) return true;
      if (++lines % LINES_PER_CLOCK_CHECK !== 0) return false;
      if (performance.now() <= deadline) return false;
      scan.stoppedEarly = true;
      return true;
    };

    try {
      for await (const line of streamLines(scanned.filePath)) {
        if (overBudget()) return;
        scan.bytesRead += line.length;
        const o = safeParse(line);
        if (!o) continue;
        if (isReplay(o)) continue;
        const uuid = str(o.uuid);
        const message = isRec(o.message) ? o.message : null;
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (!isRec(block)) continue;
            if (block.type === 'tool_use') {
              yield { uuid, role: 'call', text: toolCallText(block) };
            } else if (block.type === 'tool_result') {
              const text = toolResultText(block.content);
              if (text.trim()) yield { uuid, role: 'tool', text };
            }
          }
        }
        const result = isRec(o.toolUseResult) ? o.toolUseResult : null;
        const persisted = result ? str(result.persistedOutputPath) : null;
        if (persisted) {
          const text = await this.readPersisted(persisted, scan);
          if (text) yield { uuid, role: 'tool', text };
        }
      }
    } catch (err) {
      // A transcript being rewritten under us is not a reason to fail a search.
      log.debug(`could not finish reading ${scanned.filePath}`, { err: String(err) });
    }

    if (!scanned.sessionDir || scanned.subagentCount === 0) return;
    const dir = path.join(scanned.sessionDir, 'subagents');
    let entries: string[];
    try {
      entries = (await fsp.readdir(dir)).filter((e) => e.endsWith('.jsonl'));
    } catch {
      return;
    }
    for (const entry of entries) {
      try {
        for await (const line of streamLines(path.join(dir, entry))) {
          if (overBudget()) return;
          scan.bytesRead += line.length;
          const o = safeParse(line);
          if (!o) continue;
          const message = isRec(o.message) ? o.message : null;
          if (!message) continue;
          // A subagent line's uuid means nothing to the viewer, which knows only
          // the parent transcript -- so the snippet links to the session with no
          // anchor rather than to an anchor that resolves nowhere.
          if (typeof message.content === 'string') {
            if (message.content.trim()) yield { uuid: null, role: 'agent', text: message.content };
          } else if (Array.isArray(message.content)) {
            for (const block of message.content) {
              if (!isRec(block)) continue;
              if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
                yield { uuid: null, role: 'agent', text: block.text };
              } else if (block.type === 'tool_use') {
                yield { uuid: null, role: 'agent', text: toolCallText(block) };
              } else if (block.type === 'tool_result') {
                const text = toolResultText(block.content);
                if (text.trim()) yield { uuid: null, role: 'agent', text };
              }
            }
          }
        }
      } catch (err) {
        log.debug(`could not finish reading subagent ${entry}`, { err: String(err) });
      }
    }
  }

  /**
   * An offloaded output lives in a file, and the path comes out of a transcript
   * -- data we do not write. It is read only if it resolves inside the projects
   * directory, and only its head, because one of these can be a megabyte.
   */
  private async readPersisted(filePath: string, scan: DeepScanInfo): Promise<string | null> {
    const resolved = path.resolve(filePath);
    const root = path.resolve(this.config.projectsDir);
    if (!resolved.startsWith(root + path.sep)) return null;
    try {
      const handle = await fsp.open(resolved, 'r');
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, MAX_PERSISTED_BYTES);
        const buffer = Buffer.allocUnsafe(length);
        await handle.read(buffer, 0, length, 0);
        scan.bytesRead += length;
        return buffer.toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }
}
