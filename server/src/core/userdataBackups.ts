import fsp from 'node:fs/promises';
import path from 'node:path';
import type { UserdataBackup } from '@claude-history/shared';
import { APP_VERSION } from '../version.ts';
import { writeTextAtomic } from './cache.ts';
import { createLogger } from './logger.ts';

const log = createLogger('backups');

/**
 * How much of each kind of user data `userdata.json` holds, as the `pre-loss`
 * guard counts it. Every key is something whose disappearance is a loss worth a
 * copy — so a new kind of user data belongs here as well as in
 * `SessionIndex.saveUserdata()`.
 */
export interface UserdataCounts {
  titleOverrides: number;
  pins: number;
  stars: number;
  /** 0 or 1: the remote-access credentials are one record or none. */
  auth: number;
}

/** Days of daily copies kept. Older ones are pruned as they are made. */
const KEEP_DAYS = 14;
/** How many of each event-driven copy survive a prune, newest first. */
const KEEP_PER_REASON = 3;
/**
 * Runaway guard, not a target: these are copies of one small file (1 KB today),
 * but a starred message can carry 200,000 characters, so the file itself can
 * reach megabytes and fourteen of those are worth a ceiling.
 */
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** `userdata.json.2026-08-18_00-15-03.daily.bak` */
const NAME_RE = /^userdata\.json\.(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.([A-Za-z0-9._-]+)\.bak$/;

function stampNow(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${String(now.getFullYear())}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  );
}

/**
 * The day, the moment and the reason a copy was taken, read from its own name.
 *
 * Deliberately not from the mtime: the name records when the copy was TAKEN,
 * while the mtime records when the bytes last moved — and copying the folder
 * somewhere, or restoring it from a backup of the machine, rewrites every mtime
 * at once. That would make the newest copy look like all of them and the pruning
 * window meaningless. Local time throughout, so the name matches the clock the
 * person reading the folder is looking at.
 */
function parseName(name: string): { day: string; at: Date; reason: string } | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const n = (i: number) => Number(m[i]);
  return {
    day: `${m[1]}-${m[2]}-${m[3]}`,
    at: new Date(n(1), n(2) - 1, n(3), n(4), n(5), n(6)),
    reason: m[7],
  };
}

/**
 * The KIND of copy, which is what the retention rule has to count.
 *
 * `pre-update-1.0.0` and `pre-update-1.0.1` are two of the same thing. Counting
 * by the full reason kept one copy per version for ever — measured: four
 * survived a rule that keeps three, and after ten updates it would have been ten.
 */
function family(reason: string): string {
  const dash = reason.indexOf('-', reason.startsWith('pre-') ? 4 : 0);
  return dash > 0 ? reason.slice(0, dash) : reason;
}

/** What a stored copy holds, for a panel that has to say what restoring means. */
function summarize(text: string): UserdataBackup['contents'] {
  try {
    const data = JSON.parse(text) as {
      titleOverrides?: Record<string, string>;
      pins?: string[];
      stars?: unknown[];
      prices?: unknown;
      settings?: unknown;
    };
    return {
      titleOverrides: Object.keys(data.titleOverrides ?? {}).length,
      pins: (data.pins ?? []).length,
      stars: (data.stars ?? []).length,
      hasPrices: data.prices != null,
      hasSettings: data.settings != null,
    };
  } catch {
    // A copy that does not parse is worth listing anyway: it says the file was
    // already broken when it was taken, which is itself the answer to "why did
    // I lose this".
    return null;
  }
}

/**
 * Dated copies of `userdata.json`, the only file this app cannot rebuild.
 *
 * Three writes are protected, and the shape of this is set by what each one is
 * for:
 *
 *  - **Corruption** was already handled: a torn file is quarantined as
 *    `.corrupt-<stamp>` ([AI_ARCHITECTURE](../../../docs/AI_ARCHITECTURE.md)).
 *    What was missing is the other half — something to put back — so
 *    `recoverFromBackup()` is what turns that from a loss into a log line.
 *  - **A bug of ours writing a VALID but incomplete file** is the likelier
 *    accident and the one no periodic copy catches, because it parses.
 *    `saveUserdata()` writes the whole file from one literal, so a key missing
 *    from it disappears at the next write. Hence `beforeWrite()`: a copy is
 *    taken when a write is about to zero something that had content.
 *  - **Everything else** — a regression arriving with a new version, a change
 *    made days ago and noticed now — is covered by one copy per day and one per
 *    version, deduplicated so that a day nothing changed costs nothing.
 *
 * Copies live in `backups\` BESIDE the file, never inside the cache dir: that
 * one is documented as safe to delete at any time.
 */
export class UserdataBackups {
  private readonly dir: string;
  private readonly stateFile: string;
  /**
   * Counts as of the last write this service saw. Read from disk at startup and
   * updated on every write, because `saveUserdata()` is called AFTER the index
   * has already mutated itself — by then the only record of "before" is here.
   */
  private lastCounts: UserdataCounts = { titleOverrides: 0, pins: 0, stars: 0, auth: 0 };
  /** Day of the newest copy, so the common path costs no disk at all. */
  private newestDay: string | null = null;
  /** Summaries by `<name>:<size>`; a stored copy never changes once written. */
  private readonly summaries = new Map<string, UserdataBackup['contents']>();
  private recovered: { from: string; at: string } | null = null;

  constructor(private readonly userdataFile: string) {
    this.dir = path.resolve(userdataFile, '..', 'backups');
    this.stateFile = path.join(this.dir, 'state.json');
  }

  get directory(): string {
    return this.dir;
  }

  /** Set when this start-up had to restore a copy, for the panel to report. */
  get recovery(): { from: string; at: string } | null {
    return this.recovered;
  }

  /**
   * Called once the index has loaded, with what it loaded.
   *
   * The version copy is taken here rather than at the first write: "back up when
   * the version changes" has to hold for an install that is opened and never
   * touched, and `state.json` is the only record of which version wrote last —
   * putting it in `userdata.json` would mean adding a key to the user's own data
   * to serve our bookkeeping.
   */
  async start(counts: UserdataCounts): Promise<void> {
    this.lastCounts = counts;
    try {
      const previous = await this.readState();
      if (previous !== APP_VERSION) {
        // 'initial' reads better than a version bump for a first run, and it is
        // what the very first copy on a machine actually is.
        await this.create(previous === null ? 'initial' : `version-${APP_VERSION}`);
        await this.writeState();
      }
      await this.ensureDaily();
    } catch (err) {
      // Never fatal: the app's job is to browse transcripts, and it can do that
      // with no copies at all.
      log.warn('could not take the start-up backup', err);
    }
  }

  /**
   * Take the copies a write calls for, before it happens.
   *
   * `next` is what is about to be written, so the comparison is against what the
   * file still holds — which is the point: the copy has to be of the state the
   * write is about to replace.
   */
  async beforeWrite(next: UserdataCounts): Promise<void> {
    try {
      const emptied = (Object.keys(this.lastCounts) as (keyof UserdataCounts)[]).filter(
        (k) => this.lastCounts[k] > 0 && next[k] === 0,
      );
      if (emptied.length > 0) {
        // Not refused, only recorded: clearing every star by hand is a real
        // thing to do. What must not happen is it being unrecoverable.
        log.warn(`a write is about to empty ${emptied.join(', ')} — taking a copy first`, {
          before: this.lastCounts,
          after: next,
        });
        await this.create('pre-loss');
      }
      await this.ensureDaily();
    } catch (err) {
      log.warn('could not take a backup before writing', err);
    } finally {
      this.lastCounts = next;
    }
  }

  /** Every stored copy, newest first. */
  async list(): Promise<UserdataBackup[]> {
    let names: string[];
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    const out: UserdataBackup[] = [];
    for (const name of names) {
      const parsed = parseName(name);
      if (!parsed) continue;
      const full = path.join(this.dir, name);
      try {
        const stat = await fsp.stat(full);
        const key = `${name}:${String(stat.size)}`;
        let contents = this.summaries.get(key);
        if (contents === undefined) {
          contents = summarize(await fsp.readFile(full, 'utf8'));
          this.summaries.set(key, contents);
        }
        out.push({
          name,
          at: parsed.at.toISOString(),
          reason: parsed.reason,
          sizeBytes: stat.size,
          contents,
        });
      } catch (err) {
        log.debug(`could not read the backup ${name}`, err);
      }
    }
    // By name, which sorts by the stamp it starts with — the mtime of a file
    // copied by hand would not.
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }

  /**
   * Copy the file as it stands now. Answers the name written, or null when there
   * was nothing to copy or the bytes are identical to the newest copy already
   * held — a day on which nothing changed must not cost a slot.
   */
  async create(reason: string, now = new Date()): Promise<string | null> {
    let text: string;
    try {
      text = await fsp.readFile(this.userdataFile, 'utf8');
    } catch {
      return null; // First run: there is no file yet, and nothing to protect.
    }
    await fsp.mkdir(this.dir, { recursive: true });
    const held = await this.list();
    if (held.length > 0) {
      const newest = path.join(this.dir, held[0].name);
      try {
        if ((await fsp.readFile(newest, 'utf8')) === text) {
          // A day on which nothing changed must not cost a slot, and the day is
          // marked as covered so the next write does not ask the disk again.
          this.newestDay = parseName(held[0].name)?.day ?? null;
          log.debug(`nothing changed since ${held[0].name} — no copy taken`);
          return null;
        }
      } catch (err) {
        log.debug('could not compare against the newest backup', err);
      }
    }
    // The stamp is per second, so two copies of the same kind inside one second
    // would land on one name and the first would be lost. Push the stamp forward
    // instead of adding a suffix: a name that reads a second late is nothing, and
    // a suffix would need `family()` to know about it too.
    const taken = new Set(held.map((b) => b.name));
    let at = now;
    let name = `userdata.json.${stampNow(at)}.${reason}.bak`;
    for (let i = 0; taken.has(name) && i < 60; i++) {
      at = new Date(at.getTime() + 1_000);
      name = `userdata.json.${stampNow(at)}.${reason}.bak`;
    }
    await writeTextAtomic(path.join(this.dir, name), text);
    this.newestDay = stampNow(at).slice(0, 10);
    log.info(`kept a copy of userdata.json as ${name} (${String(text.length)} bytes, ${reason})`);
    await this.prune();
    return name;
  }

  /**
   * The contents of one stored copy, by name.
   *
   * The name is checked against the shape AND against what is really there: it
   * arrives from a request, and the rule everywhere else in this app is that a
   * path never comes from one.
   */
  async read(name: string): Promise<unknown> {
    if (!NAME_RE.test(name)) throw new Error('That is not the name of a backup.');
    const held = await this.list();
    if (!held.some((b) => b.name === name)) throw new Error(`There is no backup named ${name}.`);
    const text = await fsp.readFile(path.join(this.dir, name), 'utf8');
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${name} does not parse — it was already broken when it was taken.`);
    }
  }

  /**
   * The newest copy that parses, for a start-up that found the file unreadable.
   *
   * Answers null when there is nothing usable, and the caller then starts from
   * the defaults exactly as before — a first run has no copies either.
   */
  async recoverFromBackup(): Promise<unknown | null> {
    for (const backup of await this.list()) {
      if (backup.contents === null) continue; // Already broken when taken.
      try {
        const data = JSON.parse(await fsp.readFile(path.join(this.dir, backup.name), 'utf8'));
        this.recovered = { from: backup.name, at: backup.at };
        return data;
      } catch (err) {
        log.warn(`the backup ${backup.name} could not be read either`, err);
      }
    }
    return null;
  }

  private async ensureDaily(): Promise<void> {
    const today = stampNow(new Date()).slice(0, 10);
    if (this.newestDay === today) return;
    if (this.newestDay === null) {
      const held = await this.list();
      this.newestDay = held.length ? (parseName(held[0].name)?.day ?? null) : null;
      if (this.newestDay === today) return;
    }
    await this.create('daily');
  }

  /**
   * Keep the daily copies of the last `KEEP_DAYS` days, the newest few of every
   * other kind, and nothing beyond the size ceiling.
   *
   * The newest copy is never pruned whatever the rules say: a ceiling that can
   * leave you with none is not a ceiling, it is a bug.
   */
  private async prune(): Promise<void> {
    const held = await this.list();
    if (held.length <= 1) return;
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60_000;
    const seenPerReason = new Map<string, number>();
    const doomed: UserdataBackup[] = [];
    for (const [i, backup] of held.entries()) {
      if (i === 0) continue;
      if (backup.reason === 'daily' || backup.reason === 'initial') {
        if (Date.parse(backup.at) < cutoff) doomed.push(backup);
        continue;
      }
      const kind = family(backup.reason);
      const seen = (seenPerReason.get(kind) ?? 0) + 1;
      seenPerReason.set(kind, seen);
      if (seen > KEEP_PER_REASON) doomed.push(backup);
    }
    // The ceiling, applied to what survived, oldest first.
    const surviving = held.filter((b) => !doomed.includes(b));
    let total = surviving.reduce((sum, b) => sum + b.sizeBytes, 0);
    for (let i = surviving.length - 1; i > 0 && total > MAX_TOTAL_BYTES; i--) {
      doomed.push(surviving[i]);
      total -= surviving[i].sizeBytes;
    }
    for (const backup of doomed) {
      try {
        await fsp.rm(path.join(this.dir, backup.name), { force: true });
        log.debug(`pruned the backup ${backup.name}`);
      } catch (err) {
        log.debug(`could not prune ${backup.name}`, err);
      }
    }
    if (doomed.length > 0) log.info(`pruned ${String(doomed.length)} old backup(s)`);
  }

  private async readState(): Promise<string | null> {
    try {
      const raw = JSON.parse(await fsp.readFile(this.stateFile, 'utf8')) as { lastVersion?: unknown };
      return typeof raw.lastVersion === 'string' ? raw.lastVersion : null;
    } catch {
      return null;
    }
  }

  private async writeState(): Promise<void> {
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      await writeTextAtomic(this.stateFile, JSON.stringify({ lastVersion: APP_VERSION }, null, 2));
    } catch (err) {
      // Losing this costs one redundant copy on the next start, nothing more.
      log.debug('could not record the version that wrote last', err);
    }
  }
}
