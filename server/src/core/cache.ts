import fsp from 'node:fs/promises';
import path from 'node:path';

/** Bump to invalidate every cached artifact after a schema change. */
export const CACHE_VERSION = 2;

/** Read a JSON file, null on any failure. */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Atomic JSON write (tmp + rename); throws on failure. */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

export interface CacheKey {
  size: number;
  mtimeMs: number;
}

export type CacheSubdir = 'enriched' | 'text';

function keyMatches(entry: Partial<CacheKey>, key: CacheKey): boolean {
  return entry.size === key.size && entry.mtimeMs === key.mtimeMs;
}

/**
 * JSON-on-disk cache keyed by (file size, mtime). All writes are atomic
 * (tmp + rename) and failures are non-fatal: the cache is always safe to lose.
 */
export class DiskCache {
  private readonly indexPath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private pendingIndex: unknown = null;

  constructor(readonly cacheDir: string) {
    this.indexPath = path.join(cacheDir, 'index.json');
  }

  async init(): Promise<void> {
    await fsp.mkdir(path.join(this.cacheDir, 'enriched'), { recursive: true });
    await fsp.mkdir(path.join(this.cacheDir, 'text'), { recursive: true });
  }

  async loadIndex<T extends { version: number }>(): Promise<T | null> {
    try {
      const raw = JSON.parse(await fsp.readFile(this.indexPath, 'utf8')) as T;
      return raw.version === CACHE_VERSION ? raw : null;
    } catch {
      return null;
    }
  }

  /** Debounced, atomic index write (the index is rewritten as a whole). */
  scheduleSaveIndex(value: unknown): void {
    this.pendingIndex = value;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.writeAtomic(this.indexPath, this.pendingIndex);
    }, 1000);
    this.saveTimer.unref?.();
  }

  async loadEntry<T extends CacheKey>(subdir: CacheSubdir, id: string, key: CacheKey): Promise<T | null> {
    try {
      const raw = JSON.parse(await fsp.readFile(this.entryPath(subdir, id), 'utf8')) as T & { version?: number };
      // Version-gate every entry so schema changes invalidate stale caches.
      return raw.version === CACHE_VERSION && keyMatches(raw, key) ? raw : null;
    } catch {
      return null;
    }
  }

  async saveEntry<T extends CacheKey>(subdir: CacheSubdir, id: string, value: T): Promise<void> {
    await this.writeAtomic(this.entryPath(subdir, id), { version: CACHE_VERSION, ...value });
  }

  async deleteEntry(subdir: CacheSubdir, id: string): Promise<void> {
    try {
      await fsp.rm(this.entryPath(subdir, id), { force: true });
    } catch {
      /* ignore */
    }
  }

  private entryPath(subdir: CacheSubdir, id: string): string {
    return path.join(this.cacheDir, subdir, `${id}.json`);
  }

  private async writeAtomic(filePath: string, value: unknown): Promise<void> {
    const tmp = `${filePath}.tmp`;
    try {
      await fsp.writeFile(tmp, JSON.stringify(value), 'utf8');
      await fsp.rename(tmp, filePath);
    } catch (err) {
      console.warn(`[cache] write failed: ${filePath}`, err);
    }
  }
}
