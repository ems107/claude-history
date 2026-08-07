import { EventEmitter } from 'node:events';
import type {
  AppSettings,
  IndexState,
  LiveSessionEntry,
  PriceTable,
  ProjectInfo,
  SessionEnrichment,
  SessionSummary,
} from '@claude-history/shared';
import { DEFAULT_PRICES, DEFAULT_SETTINGS } from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { CACHE_VERSION, DiskCache, readJsonFile, writeJsonAtomic, type CacheKey } from './cache.ts';
import { enrichSession, type SearchBlock } from './enricher.ts';
import { readHistoryData, type HistoryData } from './history.ts';
import { readLiveSessions } from './live.ts';
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
  private live: LiveSessionEntry[] = [];
  /** Local title renames — stored in userdata.json, NEVER written to ~/.claude. */
  private titleOverrides: Record<string, string> = {};
  /** Pinned session ids — stored in userdata.json. */
  private pins = new Set<string>();
  /** Custom model price table — null means "use defaults". */
  private prices: PriceTable | null = null;
  /** User settings — stored in userdata.json alongside renames and pins. */
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  state: IndexState = 'scanning';
  cacheHits = 0;
  private enriching = false;

  constructor(private readonly config: AppConfig) {
    this.cache = new DiskCache(config.cacheDir);
    this.events.setMaxListeners(100); // one set of listeners per SSE client
  }

  async build(): Promise<void> {
    this.state = 'scanning';
    await this.cache.init();
    const indexCache = await this.cache.loadIndex<IndexCacheFile>();
    this.history = await readHistoryData(this.config.historyFile);
    const userdata = await readJsonFile<{
      titleOverrides?: Record<string, string>;
      pins?: string[];
      prices?: PriceTable;
      settings?: Partial<AppSettings>;
    }>(this.config.userdataFile);
    this.titleOverrides = userdata?.titleOverrides ?? {};
    this.pins = new Set(userdata?.pins ?? []);
    this.prices = userdata?.prices ?? null;
    this.settings = { ...DEFAULT_SETTINGS, ...(userdata?.settings ?? {}) };

    const scanned = await scanSessions(this.config.projectsDir);
    const seen = new Set<string>();
    for (const s of scanned) {
      seen.add(s.id);
      this.scanned.set(s.id, s);
      const cached = indexCache?.files[s.filePath];
      if (cached && cached.size === s.sizeBytes && cached.mtimeMs === s.mtimeMs) {
        // Live/enrichment/descendants/overrides are runtime state — never trust them from cache.
        this.sessions.set(s.id, {
          ...cached.summary,
          subagentCount: s.subagentCount,
          enrichment: null,
          live: null,
          descendants: [],
          originalTitle: null,
          pinned: false,
        });
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
    await this.refreshLive();
    this.state = 'enriching';
    void this.enrichAll();
  }

  /**
   * Incremental rescan for watcher updates: re-summarize files whose
   * size/mtime changed, add new ones, prune deleted ones.
   */
  async rescan(): Promise<void> {
    const scanned = await scanSessions(this.config.projectsDir);
    const seen = new Set<string>();
    const changed: string[] = [];
    for (const s of scanned) {
      seen.add(s.id);
      const prev = this.scanned.get(s.id);
      if (prev && prev.sizeBytes === s.sizeBytes && prev.mtimeMs === s.mtimeMs && prev.subagentCount === s.subagentCount) {
        continue;
      }
      await this.refreshSummary(s);
      changed.push(s.id);
      void this.enrichOne(s);
    }
    for (const id of [...this.sessions.keys()]) {
      if (!seen.has(id)) {
        this.sessions.delete(id);
        this.scanned.delete(id);
        changed.push(id);
      }
    }
    if (changed.length > 0) {
      this.applyLive();
      this.saveIndexCache();
      this.events.emit('sessions-changed', { ids: changed });
    }
  }

  async refreshLive(): Promise<void> {
    this.live = await readLiveSessions(this.config.sessionsDir);
    this.applyLive();
    this.events.emit('live-changed');
  }

  private applyLive(): void {
    const byId = new Map(this.live.map((l) => [l.sessionId, l]));
    for (const s of this.sessions.values()) {
      const l = byId.get(s.id);
      s.live = l
        ? { pid: l.pid, status: l.status, name: l.name, startedAt: l.startedAt, updatedAt: l.updatedAt }
        : null;
    }
  }

  async reloadHistory(): Promise<void> {
    this.history = await readHistoryData(this.config.historyFile);
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
        summary: { ...summary, enrichment: null, live: null, descendants: [], originalTitle: null, pinned: false },
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

  private withOverride(s: SessionSummary): SessionSummary {
    const override = this.titleOverrides[s.id];
    const pinned = this.pins.has(s.id);
    if (!override && !pinned) return s;
    return {
      ...s,
      pinned,
      ...(override ? { title: override, titleSource: 'local' as const, originalTitle: s.title } : {}),
    };
  }

  private async saveUserdata(): Promise<void> {
    await writeJsonAtomic(this.config.userdataFile, {
      titleOverrides: this.titleOverrides,
      pins: [...this.pins],
      settings: this.settings,
      ...(this.prices ? { prices: this.prices } : {}),
    });
  }

  get priceTable(): PriceTable {
    return this.prices ?? DEFAULT_PRICES;
  }

  get hasCustomPrices(): boolean {
    return this.prices !== null;
  }

  getSettings(): AppSettings {
    return this.settings;
  }

  async setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      ...patch,
      // Guard the poll interval: too low would hammer the GitHub API.
      updateIntervalMinutes: Math.max(
        5,
        Math.round(patch.updateIntervalMinutes ?? this.settings.updateIntervalMinutes),
      ),
    };
    await this.saveUserdata();
    this.events.emit('settings-changed', this.settings);
    return this.settings;
  }

  async setPriceTable(prices: PriceTable | null): Promise<void> {
    this.prices = prices;
    await this.saveUserdata();
  }

  async setTitleOverride(id: string, title: string | null): Promise<void> {
    if (title) this.titleOverrides[id] = title;
    else delete this.titleOverrides[id];
    await this.saveUserdata();
    this.events.emit('session-updated', id);
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    if (pinned) this.pins.add(id);
    else this.pins.delete(id);
    await this.saveUserdata();
    this.events.emit('session-updated', id);
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => this.withOverride(s)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  get(id: string): SessionSummary | undefined {
    const s = this.sessions.get(id);
    return s && this.withOverride(s);
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

  get enrichedCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.enrichment) n++;
    return n;
  }

  get liveSessions(): LiveSessionEntry[] {
    return this.live;
  }

  get historyData(): HistoryData {
    return this.history;
  }
}
