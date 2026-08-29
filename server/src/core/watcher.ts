import fs from 'node:fs';
import type { AppConfig } from '../config.ts';
import type { SessionIndex } from './index.ts';
import { pidAlive } from './live.ts';
import { createLogger } from './logger.ts';

const POLL_FALLBACK_MS = 30_000;
/**
 * How often the pids of the running CLIs are checked. Short because what waits
 * on it is a sentence on screen telling somebody their session is open
 * elsewhere, long after they closed it.
 */
const LIVENESS_POLL_MS = 5_000;
const log = createLogger('watcher');

/**
 * Watches ~/.claude for changes: transcripts (projects/), live sessions
 * (sessions/) and history.jsonl. Windows fs.watch supports recursive
 * natively; if watching fails we fall back to a 30 s polling rescan.
 */
export class Watcher {
  private timers = new Map<string, NodeJS.Timeout>();
  private watchers: fs.FSWatcher[] = [];
  private pollTimer: NodeJS.Timeout | null = null;
  private liveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly index: SessionIndex,
  ) {}

  start(): void {
    const okProjects = this.tryWatch(this.config.projectsDir, true, (filename) => {
      // Only .jsonl content and subagent meta affect the index.
      if (filename && !/\.(jsonl|json)$/.test(filename)) return;
      this.debounce('projects', 300, () => void this.index.rescan());
    });
    const okSessions = this.tryWatch(this.config.sessionsDir, false, (filename) => {
      // `<pid>.json` is the whole of what this directory has to say; the `.key`
      // files beside them are Claude Code's own business, and re-reading every
      // running CLI because one of them was touched is work for nothing.
      if (filename && !filename.endsWith('.json')) return;
      this.debounce('live', 300, () => void this.index.refreshLive());
    });
    this.tryWatch(this.config.dataRoot, false, (filename) => {
      if (filename === 'history.jsonl') {
        this.debounce('history', 1000, () => void this.index.reloadHistory());
      }
    });

    if (!okProjects || !okSessions) {
      log.warn('fs.watch unavailable, falling back to 30 s polling');
      this.pollTimer = setInterval(() => {
        void this.index.rescan();
        void this.index.refreshLive();
      }, POLL_FALLBACK_MS);
      this.pollTimer.unref();
    }

    this.liveTimer = setInterval(() => this.checkLiveness(), LIVENESS_POLL_MS);
    this.liveTimer.unref();
  }

  /**
   * The one change no watcher can see: a CLI that stopped existing.
   *
   * `~/.claude/sessions/<pid>.json` is written when something CHANGES, and a
   * process killed outright changes nothing on its way out — the file stays
   * behind saying `busy`, and no event ever comes. Every reader of that list
   * drops a dead pid at the moment it reads, so nothing is ever WRONG; what was
   * missing is anyone to say so. Until something asked, the composer went on
   * showing "already open in a terminal" about a window that was closed, and
   * only a reload cleared it.
   *
   * One `process.kill(pid, 0)` per running CLI, and none at all the rest of the
   * time: the list is empty far more often than not.
   */
  private checkLiveness(): void {
    const live = this.index.liveSessions;
    if (live.length === 0 || live.every((l) => pidAlive(l.pid))) return;
    void this.index.refreshLive();
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    for (const t of this.timers.values()) clearTimeout(t);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.liveTimer) clearInterval(this.liveTimer);
  }

  private tryWatch(dir: string, recursive: boolean, onChange: (filename: string | null) => void): boolean {
    try {
      const watcher = fs.watch(dir, { recursive }, (_event, filename) => {
        onChange(filename === null ? null : filename.toString());
      });
      watcher.on('error', (err) => log.warn(`error on ${dir}`, err));
      this.watchers.push(watcher);
      return true;
    } catch (err) {
      log.warn(`cannot watch ${dir}`, err);
      return false;
    }
  }

  private debounce(key: string, ms: number, fn: () => void): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        fn();
      }, ms),
    );
  }
}
