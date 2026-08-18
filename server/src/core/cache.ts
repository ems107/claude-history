import fsp from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from './logger.ts';

/**
 * Bump to invalidate every cached artifact after a schema change — or after a
 * change in what the enricher COUNTS, since an entry is keyed on the file's
 * (path, size, mtime) and a corrected count would otherwise wait for the
 * transcript to be written to again. 5: replayed lines stopped being counted.
 * 6: `forkedFrom` replaced the `session_id` ancestry guess, and a fork's
 * carried-over tokens moved out of its own totals. 7: lines Claude Code injected
 * (background-task notifications) stopped being counted and indexed as prompts.
 * 8: the re-cached tokens joined the daily buckets. 9: prompts typed while Claude
 * was working (the `attachment` envelope) started being counted and indexed.
 * 10: what the session's subagents spent became part of the enrichment. 11: their
 * ids joined the search index, and a nested agent's report stopped being dropped.
 * 12: an `ExitPlanMode` plan joined it too. 13: and what the model said it was
 * doing when it made a call (`toolIntent`).
 */
export const CACHE_VERSION = 13;

const cacheLog = createLogger('cache');

/** What `readJsonFileOrQuarantine` found, beyond the value itself. */
export interface JsonReadOutcome<T> {
  data: T | null;
  /** Where an unparseable file was kept, when there was one to keep. */
  movedTo?: string;
  /** Why it would not parse. */
  error?: unknown;
  /** Set when the copy could not be made either — nothing was preserved. */
  moveError?: unknown;
}

/**
 * Read a JSON file, keeping anything unparseable instead of stepping over it.
 *
 * The cache's own readers below answer null for both "there is nothing there"
 * and "what is there is broken", which is right for a cache that is always safe
 * to lose and wrong for `userdata.json`: starting from the defaults there drops
 * every rename, pin, star, price and setting — the only state this app cannot
 * regenerate — and the next write buries the evidence. One rename keeps it
 * recoverable by hand.
 *
 * It still answers null and lets the caller carry on with the defaults: an app
 * that refuses to open because of one bad file is the worse failure.
 */
export async function readJsonFileOrQuarantine<T>(filePath: string): Promise<JsonReadOutcome<T>> {
  let text: string;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch {
    // Missing is the ordinary case — a first run — and is not worth a word.
    return { data: null };
  }
  try {
    return { data: JSON.parse(text) as T };
  } catch (error) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const movedTo = `${filePath}.corrupt-${stamp}`;
    try {
      await fsp.rename(filePath, movedTo);
      return { data: null, movedTo, error };
    } catch {
      // The rename can fail on a file something else holds open. The text is
      // already in hand, so write the copy instead: without it, the first write
      // of the new run overwrites the only evidence of what was lost.
      try {
        await fsp.writeFile(movedTo, text, 'utf8');
        return { data: null, movedTo, error };
      } catch (moveError) {
        return { data: null, error, moveError };
      }
    }
  }
}

/**
 * Writes in flight per path, so two of them never share the temporary file.
 *
 * Every write here is tmp + rename against a tmp name derived from the target,
 * and two overlapping writes to one path meant two `writeFile` calls truncating
 * that same tmp — the bytes of both interleaved into JSON nobody can parse —
 * followed by two renames, the second failing with ENOENT because the first had
 * already moved the file away. Several browser windows make that a real
 * sequence: a star in one and a pin in the other land in the same tick, and
 * `userdata.json` is the file that cannot be regenerated.
 *
 * A queue rather than unique tmp names: `${filePath}.tmp` cleans itself up
 * because the next write overwrites it, while a unique name left behind by a
 * process that died between the write and the rename stays on disk for good.
 */
const writesInFlight = new Map<string, Promise<void>>();

/**
 * Write one file through tmp + rename, behind whatever is already writing it.
 *
 * The bytes are built by the CALLER, before queueing, so what lands on disk is
 * the state as of the call and the order on disk is the order asked for.
 */
export async function writeTextAtomic(filePath: string, text: string): Promise<void> {
  const previous = writesInFlight.get(filePath);
  const write = async (): Promise<void> => {
    const tmp = `${filePath}.tmp`;
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, filePath);
  };
  // A failure belongs to the caller that caused it and to nobody else, so the
  // next writer in line runs either way.
  const mine = previous ? previous.then(write, write) : write();
  const tail = mine.catch(() => undefined);
  writesInFlight.set(filePath, tail);
  try {
    await mine;
  } finally {
    // Only when nobody queued behind us — otherwise we would drop their turn.
    if (writesInFlight.get(filePath) === tail) writesInFlight.delete(filePath);
  }
}

/** Atomic JSON write (tmp + rename), serialized per path; throws on failure. */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, JSON.stringify(value, null, 2));
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
    try {
      // Not `writeJsonAtomic`: these files are large and nobody reads them by
      // eye, so they go out unindented. The per-path queue is the same one, which
      // is what keeps the debounced index write off whatever wrote it last.
      await writeTextAtomic(filePath, JSON.stringify(value));
    } catch (err) {
      cacheLog.warn(`write failed: ${filePath}`, err);
    }
  }
}
