import { EventEmitter } from 'node:events';
import type { IndexState, ProjectInfo, SessionEnrichment, SessionSummary } from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { CACHE_VERSION, DiskCache, type CacheKey } from './cache.ts';
import { enrichSession, type SearchBlock } from './enricher.ts';
import { readHistoryData, type HistoryData } from './history.ts';
import { buildProjects } from './projects.ts';
import { scanSessions, type ScannedSession } from './scanner.ts';
import { summarizeSession } from './summarizer.ts';

interface IndexCacheFile {
  version: number;
  files: Record<string, { size: number; mtimeMs: number; summary: SessionSummary }>;
}

interface EnrichedEntry extends CacheKey {
  enrichment: SessionEnrichment;
}

export interface TextEntry extends CacheKey {
  blocks: SearchBlock[];
}

/**
 * In-memory index of all sessions. Summaries come from a cheap head/tail scan
 * (disk-cached by size+mtime); enrichment runs in the background afterwards
 * and progressively fills token totals, PR links and resume ancestry.
 *
 * Events: 'session-updated' (id), 'sessions-changed' (ids), 'index-progress'
 * ({enriched, total}).
 */
export class SessionIndex {
  readonly events = new EventEmitter();
  readonly cache: DiskCache;
  private sessions = new Map<string, SessionSummary>();
  private scanned = new Map<string, ScannedSession>();
  private history: HistoryData = { entries: [], sessionProject: new Map() };
  state: IndexState = 'scanning';
  cacheHits = 0;
  enrichedCount = 0;
  private enriching = false;

  constructor(private readonly config: AppConfig) {
    this.cache = new DiskCache(config.cacheDir);
  }

  async build(): Promise<void> {
    this.state = 'scanning';
    await this.cache.init();
    const indexCache = await this.cache.loadIndex<IndexCacheFile>();
    this.history = await readHistoryData(this.config.historyFile);

    const scanned = await scanSessions(this.config.projectsDir);
    const seen = new Set<string>();
    for (const s of scanned) {
      seen.add(s.id);
      this.scanned.set(s.id, s);
      const cached = indexCache?.files[s.filePath];
      if (cached && cached.size === s.sizeBytes && cached.mtimeMs === s.mtimeMs) {
        // Live/enrichment/descendants are runtime state — never trust them from cache.
        this.sessions.set(s.id, { ...cached.summary, subagentCount: s.subagentCount, enrichment: null, live: null, descendants: [] });
        this.cacheHits++;
      } else {
        await this.refreshSummary(s);
      }
    }
    // Prune sessions whose files disappeared.
    for (const id of [...this.sessions.keys()]) {
      if (!seen.has(id)) {
        this.sessions.delete(id);
        this.scanned.delete(id);
      }
    }

    this.saveIndexCache();
    this.state = 'enriching';
    void this.enrichAll();
  }

  /** Re-summarize one session file (initial build and watcher updates). */
  async refreshSummary(s: ScannedSession): Promise<void> {
    try {
      this.sessions.set(s.id, await summarizeSession(s, this.history.sessionProject));
      this.scanned.set(s.id, s);
    } catch (err) {
      console.warn(`[index] failed to summarize ${s.filePath}:`, err);
    }
  }

  private saveIndexCache(): void {
    const files: IndexCacheFile['files'] = {};
    for (const [id, s] of this.scanned) {
      const summary = this.sessions.get(id);
      if (!summary) continue;
      files[s.filePath] = {
        size: s.sizeBytes,
        mtimeMs: s.mtimeMs,
        summary: { ...summary, enrichment: null, live: null, descendants: [] },
      };
    }
    this.cache.scheduleSaveIndex({ version: CACHE_VERSION, files } satisfies IndexCacheFile);
  }

  private async enrichAll(): Promise<void> {
    if (this.enriching) return;
    this.enriching = true;
    try {
      const total = this.scanned.size;
      let done = 0;
      for (const s of [...this.scanned.values()].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
        await this.enrichOne(s);
        done++;
        if (done % 5 === 0 || done === total) {
          this.events.emit('index-progress', { enriched: done, total });
        }
      }
      this.state = 'ready';
    } finally {
      this.enriching = false;
    }
  }

  async enrichOne(s: ScannedSession): Promise<void> {
    const summary = this.sessions.get(s.id);
    if (!summary) return;
    const key: CacheKey = { size: s.sizeBytes, mtimeMs: s.mtimeMs };
    try {
      let enriched = await this.cache.loadEntry<EnrichedEntry>('enriched', s.id, key);
      const textOk = (await this.cache.loadEntry<TextEntry>('text', s.id, key)) !== null;
      if (!enriched || !textOk) {
        const data = await enrichSession(s.filePath, s.id);
        enriched = { ...key, enrichment: data.enrichment };
        await this.cache.saveEntry('enriched', s.id, enriched);
        await this.cache.saveEntry('text', s.id, { ...key, blocks: data.searchBlocks } satisfies TextEntry);
      }
      summary.enrichment = enriched.enrichment;
      this.enrichedCount++;
      this.linkAncestry(s.id, enriched.enrichment.resumedFrom);
      this.events.emit('session-updated', s.id);
    } catch (err) {
      console.warn(`[index] failed to enrich ${s.filePath}:`, err);
    }
  }

  private linkAncestry(id: string, resumedFrom: string[]): void {
    for (const ancestorId of resumedFrom) {
      const ancestor = this.sessions.get(ancestorId);
      if (ancestor && !ancestor.descendants.includes(id)) {
        ancestor.descendants.push(id);
        this.events.emit('session-updated', ancestorId);
      }
    }
  }

  async loadTextBlocks(id: string): Promise<TextEntry | null> {
    const s = this.scanned.get(id);
    if (!s) return null;
    return this.cache.loadEntry<TextEntry>('text', id, { size: s.sizeBytes, mtimeMs: s.mtimeMs });
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  get(id: string): SessionSummary | undefined {
    return this.sessions.get(id);
  }

  getScanned(id: string): ScannedSession | undefined {
    return this.scanned.get(id);
  }

  projects(): ProjectInfo[] {
    return buildProjects(this.sessions.values());
  }

  get size(): number {
    return this.sessions.size;
  }

  get historyData(): HistoryData {
    return this.history;
  }
}
