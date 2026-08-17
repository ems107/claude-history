import { EventEmitter } from 'node:events';
import type {
  AppSettings,
  IndexState,
  LiveSessionEntry,
  PriceTable,
  ProjectInfo,
  SessionEnrichment,
  SessionSummary,
  StarredMessage,
} from '@claude-history/shared';
import {
  AUTO_RELOAD_MESSAGE_MAX,
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  DEFAULT_PRICES,
  DEFAULT_SETTINGS,
  LOG_LEVEL_CHOICES,
  MIN_CHAT_IDLE_MINUTES,
  MIN_LOG_RETENTION_DAYS,
  MIN_USAGE_INTERVAL_SECONDS,
  MIN_USAGE_RATE_LIMIT_SECONDS,
} from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { CACHE_VERSION, DiskCache, readJsonFileOrQuarantine, writeJsonAtomic, type CacheKey } from './cache.ts';
import { enrichSession, type SearchBlock } from './enricher.ts';
import { appendedText, safeParse, str } from './jsonl.ts';
import { readHistoryData, type HistoryData } from './history.ts';
import { readLiveSessions } from './live.ts';
import { createLogger } from './logger.ts';
import { buildProjects, normalizeProjectKey } from './projects.ts';
import { scanSessions, type ScannedSession } from './scanner.ts';
import { summarizeSession } from './summarizer.ts';

const log = createLogger('index');

/** A star belongs to one message of one transcript, and nothing else identifies it. */
function starKey(sessionId: string, uuid: string): string {
  return `${sessionId}:${uuid}`;
}

/**
 * A whole number at or above `min`, falling back to the stored value. The
 * fallback matters: settings arrive from a JSON body, where a cleared number
 * input is NaN — and a NaN floor compares false against everything, quietly
 * turning "at most one read every N seconds" into "read every time".
 */
function clampInt(patched: number | undefined, current: number, min: number): number {
  const value = Math.round(patched ?? current);
  if (!Number.isFinite(value)) return Math.max(min, Number.isFinite(current) ? current : min);
  return Math.max(min, value);
}

/**
 * Did Claude answer in this session since the last scan?
 *
 * Reads only the bytes appended and looks for a real `assistant` line. The
 * substring is checked first because it settles the common case (a sidecar
 * rewrite) without parsing anything; it is not trusted on its own, since a
 * tool result quoting a transcript carries the same text — this app's own
 * sessions are full of them.
 */
async function hasAssistantWrite(s: ScannedSession, previousBytes: number): Promise<boolean> {
  // Shrunk or rewritten: there is no delta to read, so fall back to counting
  // it. Rare, and erring towards one extra read beats missing real spend.
  if (s.sizeBytes < previousBytes) return true;
  if (s.sizeBytes === previousBytes) return false;
  try {
    const text = await appendedText(s.filePath, previousBytes);
    if (!text.includes('"type":"assistant"')) return false;
    for (const line of text.split('\n')) {
      const rec = safeParse(line);
      if (rec && str(rec.type) === 'assistant') return true;
    }
    return false;
  } catch {
    // The file went away or is locked mid-write; the next scan will tell.
    return false;
  }
}

interface IndexCacheFile {
  version: number;
  files: Record<string, { size: number; mtimeMs: number; summary: SessionSummary }>;
}

interface EnrichedEntry extends CacheKey {
  enrichment: SessionEnrichment;
  /**
   * Bytes of `subagents/*.jsonl` when this was computed. The cache key is the
   * session file's (size, mtime), and the agents' spend is now part of the
   * enrichment — but their files grow on their own, so without this a running
   * agent's cost would stay frozen at whatever it was when the parent last
   * wrote a line.
   */
  subagentBytes: number;
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
 * ({enriched, total}), 'stars-changed'.
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
  /**
   * Starred messages, keyed `<sessionId>:<uuid>` — stored in userdata.json,
   * text and all. A Map rather than the array on disk so the viewer can ask
   * about one message without walking the list.
   */
  private stars = new Map<string, StarredMessage>();
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
    // This is the one file whose loss is permanent, so a copy of anything
    // unparseable is kept before we carry on with the defaults and the first
    // write of the run overwrites it.
    const stored = await readJsonFileOrQuarantine<{
      titleOverrides?: Record<string, string>;
      pins?: string[];
      stars?: StarredMessage[];
      prices?: PriceTable;
      settings?: Partial<AppSettings>;
    }>(this.config.userdataFile);
    if (stored.moveError) {
      log.error(
        `${this.config.userdataFile} does not parse and no copy of it could be made — the renames, pins, stars, prices and settings in it are about to be replaced by the defaults`,
        { parseError: String(stored.error), moveError: String(stored.moveError) },
      );
    } else if (stored.movedTo) {
      log.error(
        `${this.config.userdataFile} does not parse — kept it as ${stored.movedTo} and started from the defaults`,
        { parseError: String(stored.error) },
      );
    }
    const userdata = stored.data;
    this.titleOverrides = userdata?.titleOverrides ?? {};
    this.pins = new Set(userdata?.pins ?? []);
    this.stars = new Map((userdata?.stars ?? []).map((s) => [starKey(s.sessionId, s.uuid), s]));
    this.prices = userdata?.prices ?? null;
    // Only keys we still have: a setting that is retired would otherwise live
    // on in userdata.json forever, be served by /api/settings and read as
    // current — which is exactly what happened to chatModel/chatEffort.
    const saved = (userdata?.settings ?? {}) as Record<string, unknown>;
    const known = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).filter((k) => k in saved).map((k) => [k, saved[k]]));
    this.settings = { ...DEFAULT_SETTINGS, ...(known as Partial<AppSettings>) };

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
   *
   * Also classifies each change: `assistantIds` are the sessions where the
   * bytes appended contain a real `assistant` line, i.e. Claude answered. Only
   * those mean tokens were spent — a typed prompt, a tool result and the
   * sidecar lines rewritten every turn all move the file without moving the
   * subscription figures, and reading usage for them was pure noise.
   */
  async rescan(): Promise<void> {
    const scanned = await scanSessions(this.config.projectsDir);
    const seen = new Set<string>();
    const changed: string[] = [];
    const assistantIds: string[] = [];
    for (const s of scanned) {
      seen.add(s.id);
      const prev = this.scanned.get(s.id);
      if (
        prev &&
        prev.sizeBytes === s.sizeBytes &&
        prev.mtimeMs === s.mtimeMs &&
        prev.subagentCount === s.subagentCount &&
        // An agent writing into its own transcript changes what this session
        // cost without touching a byte of its file.
        prev.subagentBytes === s.subagentBytes
      ) {
        continue;
      }
      // Classify before refreshSummary records the new size — the previous one
      // is where the delta starts. A file we have never seen is deliberately
      // not counted: a new session's first write is its header and prompt, and
      // a resumed one is copied history whose tokens were spent long ago.
      if (prev && (await hasAssistantWrite(s, prev.sizeBytes))) assistantIds.push(s.id);
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
      this.events.emit('sessions-changed', { ids: changed, assistantIds });
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
        ? {
            pid: l.pid,
            status: l.status,
            name: l.name,
            startedAt: l.startedAt,
            updatedAt: l.updatedAt,
            statusUpdatedAt: l.statusUpdatedAt,
          }
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
      log.warn(`failed to summarize ${s.filePath}`, err);
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
      // The agents' bytes are checked apart from the cache key: nothing about
      // the session file changes when one of them writes another answer.
      if (enriched && enriched.subagentBytes !== s.subagentBytes) enriched = null;
      if (!enriched || !textOk) {
        const data = await enrichSession(s.filePath, s.id, s.sessionDir);
        enriched = { ...key, enrichment: data.enrichment, subagentBytes: s.subagentBytes };
        await this.cache.saveEntry('enriched', s.id, enriched);
        await this.cache.saveEntry('text', s.id, { ...key, blocks: data.searchBlocks } satisfies TextEntry);
      }
      summary.enrichment = enriched.enrichment;
      this.linkFork(s.id, enriched.enrichment.forkedFrom);
      this.events.emit('session-updated', s.id);
    } catch (err) {
      log.warn(`failed to enrich ${s.filePath}`, err);
    }
  }

  /** The reverse of `forkedFrom`: the parent gets to know what was branched off it. */
  private linkFork(id: string, forkedFrom: string | null): void {
    if (!forkedFrom) return;
    const parent = this.sessions.get(forkedFrom);
    if (parent && !parent.descendants.includes(id)) {
      parent.descendants.push(id);
      this.events.emit('session-updated', forkedFrom);
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

  /**
   * The whole file, every time. Anything missing from this literal is dropped
   * from disk on the next rename — so a new kind of user data has to be added
   * here as well as to the read above.
   */
  private async saveUserdata(): Promise<void> {
    await writeJsonAtomic(this.config.userdataFile, {
      titleOverrides: this.titleOverrides,
      pins: [...this.pins],
      stars: [...this.stars.values()],
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
      usageIntervalSeconds: clampInt(patch.usageIntervalSeconds, this.settings.usageIntervalSeconds, MIN_USAGE_INTERVAL_SECONDS),
      // The floor between real reads. Never below the hard one: this is the
      // only thing standing between a burst of triggers and a 429.
      usageMinIntervalSeconds: clampInt(
        patch.usageMinIntervalSeconds,
        this.settings.usageMinIntervalSeconds,
        MIN_USAGE_INTERVAL_SECONDS,
      ),
      // How long a 429 silences every reader. Its own floor, well above the
      // read floor: a shorter answer to "you ask too much" is not an answer.
      usageRateLimitBackoffSeconds: clampInt(
        patch.usageRateLimitBackoffSeconds,
        this.settings.usageRateLimitBackoffSeconds,
        MIN_USAGE_RATE_LIMIT_SECONDS,
      ),
      // 0 is meaningful here: "always re-read when the window regains focus".
      usageFocusMaxAgeSeconds: clampInt(patch.usageFocusMaxAgeSeconds, this.settings.usageFocusMaxAgeSeconds, 0),
      autoReloadModel: (CLAUDE_MODELS as readonly string[]).includes(
        patch.autoReloadModel ?? this.settings.autoReloadModel,
      )
        ? (patch.autoReloadModel ?? this.settings.autoReloadModel)
        : DEFAULT_SETTINGS.autoReloadModel,
      chatIdleTimeoutMinutes: clampInt(
        patch.chatIdleTimeoutMinutes,
        this.settings.chatIdleTimeoutMinutes,
        MIN_CHAT_IDLE_MINUTES,
      ),
      autoReloadMessage: (patch.autoReloadMessage ?? this.settings.autoReloadMessage).slice(
        0,
        AUTO_RELOAD_MESSAGE_MAX,
      ),
      // Windows' "Copy as path" wraps the path in quotes; keep them out of the cwd.
      autoReloadCwd: (patch.autoReloadCwd ?? this.settings.autoReloadCwd).trim().replace(/^"(.*)"$/, '$1'),
      logLevel: (LOG_LEVEL_CHOICES as readonly string[]).includes(patch.logLevel ?? this.settings.logLevel)
        ? (patch.logLevel ?? this.settings.logLevel)
        : DEFAULT_SETTINGS.logLevel,
      logRetentionDays: Math.max(
        MIN_LOG_RETENTION_DAYS,
        Math.round(patch.logRetentionDays ?? this.settings.logRetentionDays),
      ),
    };
    await this.saveUserdata();
    this.events.emit('settings-changed', this.settings);
    return this.settings;
  }

  async setPriceTable(prices: PriceTable | null): Promise<void> {
    this.prices = prices;
    await this.saveUserdata();
    // Costs are computed in the browser from this table, everywhere they appear,
    // so a window that did not save it goes on pricing tokens with the old one.
    this.events.emit('prices-changed');
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

  /** Every starred message, in the order they were stored. */
  listStars(): StarredMessage[] {
    return [...this.stars.values()];
  }

  getStar(sessionId: string, uuid: string): StarredMessage | undefined {
    return this.stars.get(starKey(sessionId, uuid));
  }

  /**
   * Store or replace a star. `stars-changed` and NOT `session-updated`: the
   * transcript did not move, and that event costs every open tab a re-parse of
   * it.
   */
  async setStar(record: StarredMessage): Promise<void> {
    this.stars.set(starKey(record.sessionId, record.uuid), record);
    await this.saveUserdata();
    this.events.emit('stars-changed');
  }

  /**
   * Drop a star. Deliberately says nothing about whether the session still
   * exists: a star whose transcript has gone is exactly the one that has to
   * stay removable.
   */
  async removeStar(sessionId: string, uuid: string): Promise<boolean> {
    if (!this.stars.delete(starKey(sessionId, uuid))) return false;
    await this.saveUserdata();
    this.events.emit('stars-changed');
    return true;
  }

  /**
   * Project key hidden from the browsing views, or null. That is the auto-reload
   * folder when the user asked for it: it fills up with one throwaway session
   * every 5 hours, and those would otherwise drown the real ones.
   */
  private hiddenProjectKey(): string | null {
    const { autoReloadEnabled, autoReloadHideSessions, autoReloadCwd } = this.settings;
    // Gated on the feature being on, and not just on its own checkbox: with the
    // feature off its whole settings block is disabled in the UI, and a greyed
    // control that still hides sessions would be a trap. Switching the feature
    // off therefore brings the folder's sessions back into view.
    if (!autoReloadEnabled || !autoReloadHideSessions || !autoReloadCwd.trim()) return null;
    return normalizeProjectKey(autoReloadCwd.trim());
  }

  /** True when this project is the hidden one. */
  isHiddenProject(projectKey: string): boolean {
    return this.hiddenProjectKey() === projectKey;
  }

  /**
   * Everything the browsing views may show. `list()` and `projects()` both go
   * through here, so the session list, the project filters, the counts, search
   * and the stats page can never disagree about what exists.
   */
  private *visible(): Generator<SessionSummary> {
    const hidden = this.hiddenProjectKey();
    for (const s of this.sessions.values()) {
      if (hidden !== null && s.projectKey === hidden) continue;
      yield s;
    }
  }

  list(): SessionSummary[] {
    return [...this.visible()].map((s) => this.withOverride(s)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  /** Unfiltered: a hidden session is still openable by direct link. */
  get(id: string): SessionSummary | undefined {
    const s = this.sessions.get(id);
    return s && this.withOverride(s);
  }

  getScanned(id: string): ScannedSession | undefined {
    return this.scanned.get(id);
  }

  projects(): ProjectInfo[] {
    return buildProjects(this.visible());
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
