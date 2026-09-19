import type { GitDiscardEntry } from '@claude-history/shared';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createLogger, localIso } from './logger.ts';

const log = createLogger('git');

/**
 * The bin for things the Git tab is about to throw away.
 *
 * Everything else this tab does is recoverable by git itself: a bad commit can
 * be reset, a bad stage unstaged, a bad merge aborted. Discarding is the
 * exception — the content only ever existed in the working file, so once it is
 * overwritten nothing in git remembers it. Verifying the operation harder does
 * not help, because a correct discard destroys exactly as much as an incorrect
 * one; what helps is being able to put it back.
 *
 * So before any write to the working tree, the file's exact bytes are copied
 * here. It lives beside userdata.json rather than in the cache, because "Clear
 * cache" must not be a way to lose work, and it is pruned by age and by count
 * so it cannot grow without limit.
 */

/** Discards kept per repository. Past this the oldest goes. */
const MAX_ENTRIES = 40;
/** And nothing is kept longer than this, however few there are. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A file bigger than this is not copied — and the discard is refused rather than done blind. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface StoredEntry {
  id: string;
  at: string;
  repoKey: string;
  repoName: string;
  /** What the user asked for, in their words: "3 lines of src/app.ts". */
  what: string;
  files: { path: string; bytes: number; missing: boolean }[];
}

export class GitUndoStore {
  constructor(private readonly root: string) {}

  private repoDir(repoKey: string): string {
    // The key is a path; hashed so it can be a folder name on any filesystem.
    return path.join(this.root, crypto.createHash('sha1').update(repoKey).digest('hex').slice(0, 16));
  }

  /**
   * Copy the given files before they are written over. Returns the entry id, or
   * null when there was nothing to keep.
   *
   * A file that cannot be read is recorded as `missing` rather than skipped
   * silently: restoring must be able to say "this one was already gone".
   */
  async keep(
    repo: { key: string; name: string; path: string },
    files: string[],
    what: string,
  ): Promise<string | null> {
    if (files.length === 0) return null;
    const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const dir = path.join(this.repoDir(repo.key), id);
    const entry: StoredEntry = { id, at: localIso(), repoKey: repo.key, repoName: repo.name, what, files: [] };

    await fsp.mkdir(dir, { recursive: true });
    for (const relative of files) {
      const source = path.join(repo.path, relative);
      const target = path.join(dir, 'files', relative);
      try {
        const stat = await fsp.stat(source);
        if (!stat.isFile()) {
          // A directory here is an untracked folder; its files are listed
          // individually by the caller, so nothing is lost by skipping it.
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) {
          throw new Error(`${relative} is ${Math.round(stat.size / 1024 / 1024)} MB — too big to keep a copy of`);
        }
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.copyFile(source, target);
        entry.files.push({ path: relative, bytes: stat.size, missing: false });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          entry.files.push({ path: relative, bytes: 0, missing: true });
          continue;
        }
        // Anything else means we cannot promise the discard is undoable, and a
        // promise that might not hold is worse than none: let the caller refuse.
        await fsp.rm(dir, { recursive: true, force: true });
        throw err;
      }
    }

    if (entry.files.every((f) => f.missing)) {
      await fsp.rm(dir, { recursive: true, force: true });
      return null;
    }

    await fsp.writeFile(path.join(dir, 'entry.json'), JSON.stringify(entry, null, 2), 'utf8');
    log.info(`kept a copy before discarding ${what} in ${repo.name}`, { id, files: entry.files.length });
    await this.prune(repo.key);
    return id;
  }

  /**
   * Throw away a copy that turned out not to be needed — the discard it was
   * taken for was refused, so nothing was lost. Leaving it would be a lie in
   * the one list the user has to check what they lost.
   */
  async forget(repoKey: string, id: string): Promise<void> {
    await fsp.rm(path.join(this.repoDir(repoKey), id), { recursive: true, force: true }).catch(() => undefined);
  }

  /** Newest first. */
  async list(repoKey: string): Promise<GitDiscardEntry[]> {
    const dir = this.repoDir(repoKey);
    let ids: string[];
    try {
      ids = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const out: GitDiscardEntry[] = [];
    for (const id of ids) {
      const entry = await this.read(repoKey, id);
      if (entry) {
        out.push({
          id: entry.id,
          at: entry.at,
          what: entry.what,
          files: entry.files.map((f) => ({ path: f.path, bytes: f.bytes, missing: f.missing })),
        });
      }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  private async read(repoKey: string, id: string): Promise<StoredEntry | null> {
    try {
      const raw = await fsp.readFile(path.join(this.repoDir(repoKey), id, 'entry.json'), 'utf8');
      return JSON.parse(raw) as StoredEntry;
    } catch {
      return null;
    }
  }

  /**
   * Put the files back exactly as they were.
   *
   * It writes over whatever is there now, which is the point — but the entry is
   * KEPT afterwards rather than consumed, so restoring the wrong one is itself
   * undoable by restoring the right one.
   *
   * Null means there is no such copy — a pruned one, or a page left open past
   * it. Anything else that goes wrong throws: a copy that exists and cannot be
   * read is a failure, not an answer.
   */
  async restore(repo: { key: string; name: string; path: string }, id: string): Promise<string[] | null> {
    const entry = await this.read(repo.key, id);
    if (!entry) return null;
    const from = path.join(this.repoDir(repo.key), id, 'files');
    const restored: string[] = [];
    for (const file of entry.files) {
      if (file.missing) continue;
      const source = path.join(from, file.path);
      const target = path.join(repo.path, file.path);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(source, target);
      restored.push(file.path);
    }
    log.info(`restored ${restored.length} file(s) from a discard in ${repo.name}`, { id });
    return restored;
  }

  /** Oldest first out, and nothing older than a week whatever the count. */
  private async prune(repoKey: string): Promise<void> {
    const dir = this.repoDir(repoKey);
    let ids: string[];
    try {
      ids = await fsp.readdir(dir);
    } catch {
      return;
    }
    const entries: { id: string; time: number }[] = [];
    for (const id of ids) {
      const entry = await this.read(repoKey, id);
      const time = entry ? Date.parse(entry.at) : 0;
      entries.push({ id, time: Number.isFinite(time) ? time : 0 });
    }
    entries.sort((a, b) => b.time - a.time);
    const cutoff = Date.now() - MAX_AGE_MS;
    const doomed = entries.filter((e, i) => i >= MAX_ENTRIES || e.time < cutoff);
    for (const { id } of doomed) {
      await fsp.rm(path.join(dir, id), { recursive: true, force: true }).catch(() => undefined);
    }
    if (doomed.length > 0) log.debug(`pruned ${doomed.length} old discard copies`);
  }

  /** Whether anything is kept at all, for the settings page to be honest about disk use. */
  sizeOnDisk(): number {
    const walk = (dir: string): number => {
      let total = 0;
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return 0;
      }
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) total += walk(full);
        else {
          try {
            total += fs.statSync(full).size;
          } catch {
            // gone between listing and asking
          }
        }
      }
      return total;
    };
    return walk(this.root);
  }
}
