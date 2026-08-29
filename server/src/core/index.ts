import { EventEmitter } from 'node:events';
import type {
  AppSettings,
  ToneChoice,
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
  CHAT_UI_MODES,
  ACTIVE_SESSIONS_MAX,
  ACTIVE_SESSIONS_MIN,
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  DEFAULT_PRICES,
  DEFAULT_SETTINGS,
  defaultSettings,
  LIVE_BUSY,
  LIVE_WAITING,
  LOG_LEVEL_CHOICES,
  MIN_LOG_RETENTION_DAYS,
  MIN_USAGE_INTERVAL_SECONDS,
  MIN_USAGE_RATE_LIMIT_SECONDS,
  NOTIFICATION_TONE_IDS,
  NOTIFY_VOICE_NAME_MAX,
  NOTIFY_VOLUME_MAX,
  NOTIFY_VOLUME_MIN,
  TONE_INHERIT,
} from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { CACHE_VERSION, DiskCache, readJsonFileOrQuarantine, writeJsonAtomic, type CacheKey } from './cache.ts';
import { UserdataBackups, type UserdataCounts } from './userdataBackups.ts';
import type { AuthConfig } from './auth.ts';
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
 * A per-kind notification tone, which may legitimately be `inherit`.
 *
 * Anything the catalogue does not know falls back to the field's DEFAULT rather
 * than to `none`: an id we cannot read is a bug or a retired tone, and neither
 * of those is somebody asking for silence.
 */
function toneChoice(value: ToneChoice, fallback: ToneChoice): ToneChoice {
  if (value === TONE_INHERIT) return value;
  return (NOTIFICATION_TONE_IDS as readonly string[]).includes(value) ? value : fallback;
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
  /**
   * When each open turn began — `LiveInfo.busySince`. In memory, never
   * persisted, like every transition: a stop is a transition and nothing on
   * disk records one, and neither does anything record a start.
   */
  private turnStarts = new Map<string, number>();
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
  /**
   * Remote-access credentials — stored in userdata.json, under its own key and
   * NOT in `settings`, which is served whole to every authenticated browser.
   * Null means none have been set, which is what keeps remote access off.
   */
  private auth: AuthConfig | null = null;
  state: IndexState = 'scanning';
  cacheHits = 0;
  private enriching = false;

  /** Dated copies of `userdata.json` — the only state that cannot be rebuilt. */
  readonly backups: UserdataBackups;

  constructor(private readonly config: AppConfig) {
    this.cache = new DiskCache(config.cacheDir);
    this.backups = new UserdataBackups(config.userdataFile);
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
      auth?: AuthConfig;
    }>(this.config.userdataFile);
    if (stored.moveError) {
      log.error(
        `${this.config.userdataFile} does not parse and no copy of it could be made — the renames, pins, stars, prices and settings in it are about to be replaced by the defaults`,
        { parseError: String(stored.error), moveError: String(stored.moveError) },
      );
    } else if (stored.movedTo) {
      // What happens NEXT is not decided here — a backup may put it all back —
      // so this line says what was found and nothing about the outcome.
      log.error(`${this.config.userdataFile} does not parse — kept it as ${stored.movedTo}`, {
        parseError: String(stored.error),
      });
    }
    // Quarantining the broken file was only half of it: something has to go back
    // in its place, or every rename, pin and star is still gone. The newest copy
    // that parses is that something.
    let userdata = stored.data;
    let recoveredFrom: string | null = null;
    if (!userdata && (stored.movedTo || stored.moveError)) {
      const fromBackup = (await this.backups.recoverFromBackup()) as typeof userdata;
      if (fromBackup) {
        userdata = fromBackup;
        recoveredFrom = this.backups.recovery?.from ?? null;
        log.error(
          `restored ${this.config.userdataFile} from the backup ${recoveredFrom ?? '(unknown)'} — nothing was lost`,
        );
      } else {
        log.error(
          `there is no usable backup in ${this.backups.directory} — starting from the defaults, and the renames, pins, stars, prices and settings that were in that file are gone`,
        );
      }
    }
    this.applyUserdata(userdata);
    // Before any write of this run, so the guard that spots one emptying the
    // file has something to compare against, and so a version change or a new
    // day is recorded even on an install nobody touches.
    await this.backups.start(this.userdataCounts());
    // Put the recovered state back on disk rather than leaving it in memory: a
    // crash before the next star would otherwise lose it a second time.
    if (recoveredFrom) await this.saveUserdata();

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
   *
   * `agents` is the same idea one level down: which subagent transcripts grew.
   * A session with eleven agents is eleven conversations of 350-500 KB, and
   * "something under this session moved" would have a browser watching one of
   * them re-read all eleven on every write.
   */
  async rescan(): Promise<void> {
    const scanned = await scanSessions(this.config.projectsDir);
    const seen = new Set<string>();
    const changed: string[] = [];
    const assistantIds: string[] = [];
    const agents: { sessionId: string; agentId: string }[] = [];
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
      // An agent that wrote, or one that has just appeared. A file we have never
      // seen is listed on purpose here, unlike the assistant test above: its
      // whole transcript is news to anyone watching, not tokens spent long ago.
      for (const [agentId, size] of Object.entries(s.subagentSizes)) {
        if (prev?.subagentSizes[agentId] !== size) agents.push({ sessionId: s.id, agentId });
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
      this.events.emit('sessions-changed', { ids: changed, assistantIds, agents });
    }
  }

  /**
   * Re-read what is running, and say which sessions came or went.
   *
   * The ids are the membership difference and not the whole list: a busy/idle
   * flip writes to that directory too, and it changes nothing about who holds a
   * transcript. What it does change is every `blockedReason` that names a
   * terminal, so those -- and only those -- are worth re-asking for.
   */
  async refreshLive(): Promise<void> {
    const before = new Set(this.live.map((l) => l.sessionId));
    this.live = await readLiveSessions(this.config.sessionsDir);
    const after = new Set(this.live.map((l) => l.sessionId));
    // What the pid file cannot say: when the open TURN began. `statusUpdatedAt`
    // moves on every flip — answering a permission restarts it — so the moment
    // a session is first seen busy is remembered here, and survives the
    // waiting↔busy flips a dialog causes. Anything else ends the turn. A server
    // restarted mid-turn starts empty and adopts the flip the file still holds,
    // which is the best it can know.
    for (const l of this.live) {
      if (l.status === LIVE_BUSY) {
        if (!this.turnStarts.has(l.sessionId)) this.turnStarts.set(l.sessionId, l.statusUpdatedAt ?? Date.now());
      } else if (l.status !== LIVE_WAITING) {
        this.turnStarts.delete(l.sessionId);
      }
      l.busySince = this.turnStarts.get(l.sessionId) ?? null;
    }
    for (const id of this.turnStarts.keys()) if (!after.has(id)) this.turnStarts.delete(id);
    const ids = [...new Set([...before, ...after])].filter((id) => before.has(id) !== after.has(id));
    this.applyLive();
    this.events.emit('live-changed', ids);
  }

  private applyLive(): void {
    const byId = new Map(this.live.map((l) => [l.sessionId, l]));
    for (const s of this.sessions.values()) {
      const l = byId.get(s.id);
      s.live = l
        ? {
            pid: l.pid,
            status: l.status,
            waitingFor: l.waitingFor,
            name: l.name,
            startedAt: l.startedAt,
            updatedAt: l.updatedAt,
            statusUpdatedAt: l.statusUpdatedAt,
            busySince: l.busySince,
          }
        : null;
    }
  }

  async reloadHistory(): Promise<void> {
    this.history = await readHistoryData(this.config.historyFile);
  }

  /**
   * Re-summarize one session file (initial build and watcher updates).
   *
   * **A fresh summary knows nothing the file does not say, and two of its fields
   * are not in the file.** `live` is put back by `applyLive()` and the overrides
   * by `withOverride()` at serve time; `enrichment` and `descendants` have
   * nothing behind them, so a summary rebuilt from scratch answers without them
   * — and that gap is drawn. The enricher fills the first one back in ~100 ms
   * later, which sounds like nothing until you watch a session work: every line
   * it writes took the cost, the compaction count and the PR and fork badges out
   * of its row and put them back, and the meta line shoved the LIVE and WORKING
   * badges sideways twice a second. The second field is worse — only a CHILD
   * being re-enriched restores `descendants`, which may never happen, so a
   * parent that grew lost its "branched into" chips for good.
   *
   * So they are carried across: one message stale for a tenth of a second beats
   * absent, which is the same call the session header used to make for itself
   * before this made it unnecessary. A session that has never been enriched
   * still has null here, because there is nothing to remember.
   */
  async refreshSummary(s: ScannedSession): Promise<void> {
    try {
      const prev = this.sessions.get(s.id);
      const next = await summarizeSession(s, this.history.sessionProject);
      if (prev?.enrichment) next.enrichment = prev.enrichment;
      if (prev && prev.descendants.length > 0) next.descendants = prev.descendants;
      this.sessions.set(s.id, next);
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

  /** What the file holds right now, as the backup guard counts it. */
  private userdataCounts(): UserdataCounts {
    return {
      titleOverrides: Object.keys(this.titleOverrides).length,
      pins: this.pins.size,
      stars: this.stars.size,
      // Counted like the rest so a write that drops the credentials leaves a
      // copy behind. Losing them locks every remote device out until someone
      // walks to the machine — recoverable, but only from a backup.
      auth: this.auth ? 1 : 0,
    };
  }

  /**
   * Take what was read from `userdata.json` — or from a backup — into memory.
   *
   * Separate from `build()` because a restore has to do exactly this, in a
   * running server, and two copies of it would drift on the first key added.
   */
  private applyUserdata(userdata: {
    titleOverrides?: Record<string, string>;
    pins?: string[];
    stars?: StarredMessage[];
    prices?: PriceTable;
    settings?: Partial<AppSettings>;
    auth?: AuthConfig;
  } | null): void {
    this.titleOverrides = userdata?.titleOverrides ?? {};
    this.pins = new Set(userdata?.pins ?? []);
    // Keyed on two fields, so a record without them would answer for the key
    // "undefined:undefined" and shadow the next one like it. Worth filtering
    // because this data no longer comes only from our own endpoint: a restored
    // backup may have been written by an older version, or edited by hand.
    this.stars = new Map(
      (userdata?.stars ?? [])
        .filter((s) => typeof s?.sessionId === 'string' && typeof s.uuid === 'string')
        .map((s) => [starKey(s.sessionId, s.uuid), s]),
    );
    this.prices = userdata?.prices ?? null;
    // Every field or it is not credentials at all: a half-written record here
    // would be a password nobody can use and, worse, a `configured: true` that
    // hides the "set a username and password" panel behind a login nobody can
    // pass. Treated as absent, which the UI already knows how to fix.
    //
    // Absent means GONE, including on a restore, and that is deliberate: a
    // stored copy is the file, and "restore this copy" has to mean the file
    // afterwards IS that copy — the confirmation in the panel promises exactly
    // that. Every copy older than remote access carries no credentials, so
    // restoring one does revoke every signed-in device and switch the feature
    // off. That is recoverable (a `pre-restore` copy is taken first, and
    // credentials are set at the machine anyway), whereas a restore that
    // quietly kept two keys back would make the promise false for good.
    const auth = userdata?.auth;
    this.auth =
      auth && typeof auth.username === 'string' && typeof auth.passwordHash === 'string' && typeof auth.secret === 'string'
        ? auth
        : null;
    // Only keys we still have: a setting that is retired would otherwise live
    // on in userdata.json forever, be served by /api/settings and read as
    // current — which is exactly what happened to chatModel/chatEffort.
    const saved = (userdata?.settings ?? {}) as Record<string, unknown>;
    const known = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).filter((k) => k in saved).map((k) => [k, saved[k]]));
    // A dev instance starts from its own defaults (DEV_SETTING_OVERRIDES), and
    // only where nothing was saved: anything switched on there stays on.
    this.settings = { ...defaultSettings(this.config.devInstance), ...(known as Partial<AppSettings>) };
  }

  /**
   * Put a stored copy back, in place, with the server running.
   *
   * A restore is itself a write that replaces everything, so it takes its own
   * `pre-restore` copy first — picking the wrong line in a list of dates has to
   * be undoable. Everything then re-reads through the ordinary events: the ids
   * that gained or lost a rename or a pin, the stars, the settings (whose
   * listeners re-apply the log level and the auto-reload signature) and the
   * prices.
   */
  async restoreBackup(name: string): Promise<{ restoredFrom: string; backedUpTo: string | null }> {
    const data = (await this.backups.read(name)) as Parameters<typeof this.applyUserdata>[0];
    const backedUpTo = await this.backups.create('pre-restore');
    const touched = new Set([...Object.keys(this.titleOverrides), ...this.pins]);
    this.applyUserdata(data);
    for (const id of [...Object.keys(this.titleOverrides), ...this.pins]) touched.add(id);
    await this.saveUserdata();
    log.info(`restored userdata.json from ${name}`, { ...this.userdataCounts(), backedUpTo });
    // One event for the whole list rather than one per id: the ids are only the
    // ones whose row can look different, and `assistantIds` stays empty because
    // nothing was answered — that field is what triggers a usage read.
    this.events.emit('sessions-changed', { ids: [...touched], assistantIds: [], agents: [] });
    this.events.emit('stars-changed');
    this.events.emit('settings-changed', this.settings);
    this.events.emit('prices-changed');
    return { restoredFrom: name, backedUpTo };
  }

  /**
   * The whole file, every time. Anything missing from this literal is dropped
   * from disk on the next rename — so a new kind of user data has to be added
   * here as well as to `applyUserdata` above.
   */
  private async saveUserdata(): Promise<void> {
    // Copies first: the file still holds what this write is about to replace,
    // which is the only moment a copy of it can be taken.
    await this.backups.beforeWrite(this.userdataCounts());
    await writeJsonAtomic(this.config.userdataFile, {
      titleOverrides: this.titleOverrides,
      pins: [...this.pins],
      stars: [...this.stars.values()],
      settings: this.settings,
      ...(this.prices ? { prices: this.prices } : {}),
      ...(this.auth ? { auth: this.auth } : {}),
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
      // The tones, against the catalogue. The general one cannot inherit — there
      // is nothing above it to inherit from — so it is the one checked against
      // the ids alone.
      notifyTone: (NOTIFICATION_TONE_IDS as readonly string[]).includes(patch.notifyTone ?? this.settings.notifyTone)
        ? (patch.notifyTone ?? this.settings.notifyTone)
        : DEFAULT_SETTINGS.notifyTone,
      notifyToneNeedsYou: toneChoice(
        patch.notifyToneNeedsYou ?? this.settings.notifyToneNeedsYou,
        DEFAULT_SETTINGS.notifyToneNeedsYou,
      ),
      notifyToneFinished: toneChoice(
        patch.notifyToneFinished ?? this.settings.notifyToneFinished,
        DEFAULT_SETTINGS.notifyToneFinished,
      ),
      // Both ends, and 0 is meaningful: silence with the feature still on.
      notifyVolume: Math.min(
        NOTIFY_VOLUME_MAX,
        clampInt(patch.notifyVolume, this.settings.notifyVolume, NOTIFY_VOLUME_MIN),
      ),
      notifyVoiceName: (patch.notifyVoiceName ?? this.settings.notifyVoiceName).trim().slice(0, NOTIFY_VOICE_NAME_MAX),
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
      chatMode: (CHAT_UI_MODES as readonly string[]).includes(patch.chatMode ?? this.settings.chatMode)
        ? (patch.chatMode ?? this.settings.chatMode)
        : DEFAULT_SETTINGS.chatMode,
      autoReloadMessage: (patch.autoReloadMessage ?? this.settings.autoReloadMessage).slice(
        0,
        AUTO_RELOAD_MESSAGE_MAX,
      ),
      // Windows' "Copy as path" wraps the path in quotes; keep them out of the cwd.
      autoReloadCwd: (patch.autoReloadCwd ?? this.settings.autoReloadCwd).trim().replace(/^"(.*)"$/, '$1'),
      logLevel: (LOG_LEVEL_CHOICES as readonly string[]).includes(patch.logLevel ?? this.settings.logLevel)
        ? (patch.logLevel ?? this.settings.logLevel)
        : DEFAULT_SETTINGS.logLevel,
      // Both ends clamped: zero would switch the feature off through the back
      // door, and the ceiling is the machine's, not a preference.
      maxActiveSessions: Math.min(
        ACTIVE_SESSIONS_MAX,
        clampInt(patch.maxActiveSessions, this.settings.maxActiveSessions, ACTIVE_SESSIONS_MIN),
      ),
      logRetentionDays: Math.max(
        MIN_LOG_RETENTION_DAYS,
        Math.round(patch.logRetentionDays ?? this.settings.logRetentionDays),
      ),
      // Remote access without credentials is an open door, so the switch cannot
      // be on without them — clamped here rather than trusted to the UI, which
      // sets both in one gesture but is not the only thing that can PUT here.
      remoteAccessEnabled: (patch.remoteAccessEnabled ?? this.settings.remoteAccessEnabled) && this.auth !== null,
    };
    if (patch.remoteAccessEnabled && !this.settings.remoteAccessEnabled) {
      log.warn('remote access cannot be enabled before a username and password are set — the switch stays off');
    }
    await this.saveUserdata();
    this.events.emit('settings-changed', this.settings);
    return this.settings;
  }

  /** The stored credentials, or null when none have been set. */
  getAuth(): AuthConfig | null {
    return this.auth;
  }

  /**
   * Set or replace the credentials. Only ever reached from a local request
   * ([localOnly.ts](../../../shared/src/localOnly.ts)), which is what makes
   * "no old password needed" safe: being at the machine already grants
   * everything this password protects.
   */
  async setAuth(auth: AuthConfig): Promise<void> {
    this.auth = auth;
    await this.saveUserdata();
    // No event: nothing in any browser renders from this, and an event carrying
    // "the credentials changed" to every open window is a nudge to look.
  }

  /**
   * Replace the signing key, which invalidates every session cookie in
   * existence — the "sign out on all devices" button, and the one action that
   * has to work from a device you no longer hold.
   */
  async rotateAuthSecret(secret: string): Promise<void> {
    if (!this.auth) return;
    this.auth = { ...this.auth, secret, updatedAt: new Date().toISOString() };
    await this.saveUserdata();
    log.info('the remote-access signing key was rotated — every signed-in device is now signed out');
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
