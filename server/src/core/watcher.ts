import fs from 'node:fs';
import type { AppConfig } from '../config.ts';
import type { SessionIndex } from './index.ts';

const POLL_FALLBACK_MS = 30_000;

/**
 * Watches ~/.claude for changes: transcripts (projects/), live sessions
 * (sessions/) and history.jsonl. Windows fs.watch supports recursive
 * natively; if watching fails we fall back to a 30 s polling rescan.
 */
export class Watcher {
  private timers = new Map<string, NodeJS.Timeout>();
  private watchers: fs.FSWatcher[] = [];
  private pollTimer: NodeJS.Timeout | null = null;

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
    const okSessions = this.tryWatch(this.config.sessionsDir, false, () => {
      this.debounce('live', 300, () => void this.index.refreshLive());
    });
    this.tryWatch(this.config.dataRoot, false, (filename) => {
      if (filename === 'history.jsonl') {
        this.debounce('history', 1000, () => void this.index.reloadHistory());
      }
    });

    if (!okProjects || !okSessions) {
      console.warn('[watcher] fs.watch unavailable, falling back to 30 s polling');
      this.pollTimer = setInterval(() => {
        void this.index.rescan();
        void this.index.refreshLive();
      }, POLL_FALLBACK_MS);
      this.pollTimer.unref();
    }
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    for (const t of this.timers.values()) clearTimeout(t);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private tryWatch(dir: string, recursive: boolean, onChange: (filename: string | null) => void): boolean {
    try {
      const watcher = fs.watch(dir, { recursive }, (_event, filename) => {
        onChange(filename === null ? null : filename.toString());
      });
      watcher.on('error', (err) => console.warn(`[watcher] error on ${dir}:`, err));
      this.watchers.push(watcher);
      return true;
    } catch (err) {
      console.warn(`[watcher] cannot watch ${dir}:`, err);
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
