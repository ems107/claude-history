import type { UpdateLatest, UpdateStatusResponse } from '@claude-history/shared';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../version.ts';

// Automatic update CHECK is the only background network call in the app:
// a tiny JSON GET against the GitHub releases API, sent with If-None-Match
// so unchanged answers are free 304s (which don't count against GitHub's
// unauthenticated rate limit of 60 req/h). Downloading and applying an
// update NEVER happens without explicit user confirmation in the UI.
const DEFAULT_REPO = 'ems107/claude-history';
const CHECK_INTERVAL_MS = 10 * 60_000;
const STARTUP_DELAY_MS = 30_000;
const MANUAL_THROTTLE_MS = 10_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface InstallInfo {
  /** Install root (the folder containing install.json, current\, versions\). */
  root: string;
  /** Real directory the running version lives in (versions\vX.Y.Z). */
  versionDir: string;
}

interface ReleaseAssets {
  zipUrl: string;
  zipName: string;
  checksumsUrl: string | null;
}

/**
 * Detect whether this process runs from an installed portable layout:
 * <root>\versions\vX.Y.Z\server.cjs with <root>\install.json present.
 * The entry path goes through the `current` junction, so resolve real paths.
 */
export function detectInstall(entryPath = process.argv[1] ?? ''): InstallInfo | null {
  try {
    const versionDir = fs.realpathSync(path.dirname(path.resolve(entryPath)));
    if (!/^v\d+\.\d+\.\d+/.test(path.basename(versionDir))) return null;
    const versionsDir = path.dirname(versionDir);
    if (path.basename(versionsDir).toLowerCase() !== 'versions') return null;
    const root = path.dirname(versionsDir);
    if (!fs.existsSync(path.join(root, 'install.json'))) return null;
    return { root, versionDir };
  } catch {
    return null;
  }
}

/** Numeric semver comparison; prerelease suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export class UpdateService {
  readonly events = new EventEmitter();
  readonly install: InstallInfo | null;

  private readonly repo: string;
  private etag: string | null = null;
  private latest: UpdateLatest | null = null;
  private assets: ReleaseAssets | null = null;
  private lastCheckAt: string | null = null;
  private lastError: string | null = null;
  private state: UpdateStatusResponse['state'] = 'idle';
  private lastManualCheck = 0;

  constructor() {
    this.repo = process.env.CLAUDE_HISTORY_UPDATE_REPO || DEFAULT_REPO;
    this.install = detectInstall();
  }

  /** Schedule the automatic checks (startup + every 10 minutes). */
  start(): void {
    setTimeout(() => void this.check(), STARTUP_DELAY_MS).unref();
    setInterval(() => void this.check(), CHECK_INTERVAL_MS).unref();
  }

  getStatus(): UpdateStatusResponse {
    return {
      currentVersion: APP_VERSION,
      installed: this.install !== null,
      updateAvailable:
        this.latest !== null && APP_VERSION !== 'dev' && compareVersions(this.latest.version, APP_VERSION) > 0,
      latest: this.latest,
      lastCheckAt: this.lastCheckAt,
      lastError: this.lastError,
      state: this.state,
    };
  }

  /** Latest release's downloadable assets (set after a successful check). */
  getAssets(): ReleaseAssets | null {
    return this.assets;
  }

  setState(state: UpdateStatusResponse['state']): void {
    this.state = state;
    this.emit();
  }

  /** Manual check from the UI; throttled so button mashing stays polite. */
  async checkNow(): Promise<UpdateStatusResponse> {
    const now = Date.now();
    if (now - this.lastManualCheck >= MANUAL_THROTTLE_MS) {
      this.lastManualCheck = now;
      await this.check();
    }
    return this.getStatus();
  }

  private async check(): Promise<void> {
    if (this.state !== 'idle') return; // an apply (or another check) is running
    this.setState('checking');
    try {
      const res = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'claude-history-updater',
          ...(this.etag ? { 'if-none-match': this.etag } : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status !== 304) {
        if (!res.ok) throw new Error(`GitHub API answered HTTP ${res.status}`);
        this.etag = res.headers.get('etag');
        const rel = (await res.json()) as {
          tag_name?: string;
          body?: string | null;
          published_at?: string | null;
          assets?: Array<{ name: string; size: number; browser_download_url: string }>;
        };
        if (!rel.tag_name) throw new Error('Release response has no tag_name');
        const zip = rel.assets?.find((a) => /^claude-history-.+-win-x64\.zip$/.test(a.name)) ?? null;
        const checksums = rel.assets?.find((a) => a.name === 'checksums.txt') ?? null;
        this.latest = {
          version: rel.tag_name.replace(/^v/, ''),
          tag: rel.tag_name,
          notes: rel.body ?? '',
          publishedAt: rel.published_at ?? null,
          sizeBytes: zip?.size ?? null,
        };
        this.assets = zip
          ? { zipUrl: zip.browser_download_url, zipName: zip.name, checksumsUrl: checksums?.browser_download_url ?? null }
          : null;
      }
      this.lastError = null;
    } catch (err) {
      // Stay silent: keep whatever we knew, retry on the next cycle.
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.lastCheckAt = new Date().toISOString();
      this.state = 'idle';
      this.emit();
    }
  }

  private emit(): void {
    this.events.emit('update-status');
  }
}
