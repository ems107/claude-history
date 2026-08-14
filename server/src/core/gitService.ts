import {
  type GitCommandLogEntry,
  type GitCommandLogResponse,
  type GitOp,
  type GitOverview,
  type GitRepo,
  type GitRepoRoot,
} from '@claude-history/shared';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import {
  redact,
  runGit,
  setGitCommandSink,
  type GitRunOptions,
  type GitRunResult,
} from '../util/git.ts';
import { findGitExe } from '../util/launcher.ts';
import {
  checkPath,
  discoverRepos,
  repoIdOf,
  toApiRepo,
  type GitStoredPath,
  type ResolvedRepo,
} from './gitRepos.ts';
import type { SessionIndex } from './index.ts';
import { createLogger, localIso } from './logger.ts';

const log = createLogger('git');

/**
 * Commands kept for the panel. Global rather than per repository: the user
 * asked to see every command the app runs, and the failures worth going back
 * for are exactly the ones where you no longer remember which repo it was.
 * Each entry carries its repo, so the panel can filter.
 */
const RING_SIZE = 300;

/** Output kept per entry. Enough to read what went wrong, not enough to hold a diff. */
const RING_OUTPUT_CHARS = 2_000;

/** How long a discovery answer stands before the folders are walked again. */
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

/** Manually remembered paths. A list, not a database. */
const MAX_STORED_PATHS = 100;

/** Operations that CHANGE a repository. Everything else is a read. */
export const MUTATING_OPS = new Set<GitOp>([
  'stage',
  'unstage',
  'discard',
  'commit',
  'amend',
  'checkout',
  'branchCreate',
  'branchDelete',
  'branchRename',
  'fetch',
  'pull',
  'push',
  'pushUpstream',
  'pushDelete',
  'pushForce',
  'merge',
  'rebase',
  'cherryPick',
  'revert',
  'reset',
  'stash',
  'stashApply',
  'stashPop',
  'stashDrop',
  'tagCreate',
  'tagDelete',
  'tagPush',
  'worktreeAdd',
  'worktreeRemove',
  'continue',
  'abort',
  'skip',
]);

const OP_LABELS: Partial<Record<GitOp, string>> = {
  read: 'read',
  fetch: 'fetch',
  pull: 'pull',
  push: 'push',
  merge: 'merge',
  rebase: 'rebase',
  commit: 'commit',
  checkout: 'checkout',
  reset: 'reset',
  cherryPick: 'cherry-pick',
  revert: 'revert',
};

export function opLabel(op: GitOp): string {
  return OP_LABELS[op] ?? op;
}

/** A repository is doing something. Reads take it too — see `withRepoLock`. */
interface LockEntry {
  op: GitOp;
  since: number;
  done: Promise<void>;
}

/** Refused because the repository's own state says no. 409, with the reason verbatim. */
export class GitBlocked extends Error {}
/** The request itself was wrong. 400. */
export class GitBadInput extends Error {}
/** git ran and said no. The route decides what its stderr means. */
export class GitFailed extends Error {
  constructor(readonly result: GitRunResult) {
    super(`git exited ${result.exitCode}`);
  }
}

export class GitService {
  readonly events = new EventEmitter();

  private byKey = new Map<string, ResolvedRepo>();
  private byId = new Map<string, ResolvedRepo>();
  private siblings = new Map<string, string[]>();
  private rootCounts = new Map<string, number>();
  private rootErrors = new Map<string, string>();
  private discoveredAt = 0;
  private discovering: Promise<void> | null = null;

  private ring: GitCommandLogEntry[] = [];
  private seq = 0;
  /** Entries the ring has dropped, so the panel can say what it is not showing. */
  private droppedTotal = 0;

  private locks = new Map<string, LockEntry>();

  constructor(private readonly index: SessionIndex) {
    this.events.setMaxListeners(100); // one set of listeners per SSE client
  }

  /**
   * Install the recorder. Deliberately does NOT discover anything: nothing else
   * in the app needs the repository list, and boot time is the one thing a user
   * feels. The first `GET /api/git` pays for it.
   */
  start(): void {
    setGitCommandSink((result, opts) => this.record(result, opts));
  }

  shutdown(): void {
    setGitCommandSink(null);
  }

  // ------------------------------------------------------------- command panel

  get commandSeq(): number {
    return this.seq;
  }

  private record(result: GitRunResult, opts: GitRunOptions): void {
    const repo = opts.repoKey ? this.byKey.get(opts.repoKey) : null;
    const entry: GitCommandLogEntry = {
      seq: ++this.seq,
      at: localIso(),
      repoId: repo?.id ?? null,
      repoName: repo?.name ?? null,
      argv: result.argv.map(redact),
      cwd: opts.cwd,
      stdinPreview: opts.stdin ? redact(opts.stdin.slice(0, 200)) : null,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      mutation: opts.mutation === true,
      timedOut: result.timedOut,
      aborted: result.aborted,
      stdout: redact(result.stdout.slice(0, RING_OUTPUT_CHARS)),
      stderr: redact(result.stderr.slice(0, RING_OUTPUT_CHARS)),
      truncated: result.truncated || result.stdout.length > RING_OUTPUT_CHARS,
    };
    this.ring.push(entry);
    while (this.ring.length > RING_SIZE) {
      this.ring.shift();
      this.droppedTotal++;
    }
    this.events.emit('command', entry.seq);

    // The daily log gets the audit, not the transcript: at the default level it
    // reads as everything that CHANGED a repository and nothing else, and at
    // debug it reproduces the panel.
    const where = repo?.name ?? opts.cwd;
    const line = `${entry.argv.join(' ')} in ${where} -> ${result.exitCode} in ${result.durationMs} ms`;
    if (result.timedOut) log.error(`timed out: ${line}`);
    else if (result.aborted) log.debug(`cancelled: ${line}`);
    else if (!result.ok) log.warn(`${line} :: ${entry.stderr.slice(0, 500)}`);
    else if (opts.mutation) log.info(line);
    else log.debug(line);
  }

  /**
   * Entries after `since`. `dropped` is what the ring lost in between — a panel
   * that silently skips is worse than one admitting it skipped.
   */
  commands(since: number, limit: number): GitCommandLogResponse {
    const oldest = this.ring.length > 0 ? this.ring[0].seq : this.seq + 1;
    const after = this.ring.filter((e) => e.seq > since);
    const entries = after.slice(Math.max(0, after.length - limit));
    const dropped = since > 0 && oldest > since + 1 ? oldest - since - 1 : 0;
    return { entries, newestSeq: this.seq, dropped };
  }

  // ------------------------------------------------------------- repositories

  /**
   * Everything the tab needs to open. Discovery is lazy and cached; `force`
   * comes from the Refresh button.
   */
  async overview(force = false): Promise<GitOverview> {
    const gitPath = findGitExe();
    if (!gitPath) {
      return {
        available: false,
        gitPath: null,
        gitVersion: null,
        repos: [],
        scanRoots: this.roots(this.index.getGitScanRoots()),
        manual: this.roots(this.index.getGitRepos()),
        scannedAt: null,
        error: 'Git could not be found on this machine. Install Git for Windows and reload.',
      };
    }
    await this.discover(force);
    return {
      available: true,
      gitPath,
      gitVersion: await this.version(),
      repos: [...this.byKey.values()].map((repo) => toApiRepo(repo, this.siblings.get(repo.key) ?? [])),
      scanRoots: this.roots(this.index.getGitScanRoots()),
      manual: this.roots(this.index.getGitRepos()),
      scannedAt: this.discoveredAt ? localIso(new Date(this.discoveredAt)) : null,
      error: null,
    };
  }

  private roots(stored: GitStoredPath[]): GitRepoRoot[] {
    return stored.map((entry) => ({
      path: entry.path,
      addedAt: entry.addedAt,
      found: this.rootCounts.get(entry.path) ?? 0,
      error: this.rootErrors.get(entry.path) ?? null,
    }));
  }

  private versionCache: string | null = null;
  private async version(): Promise<string | null> {
    if (this.versionCache) return this.versionCache;
    try {
      const res = await runGit({ cwd: process.cwd(), args: ['--version'], readOnly: true, timeoutMs: 10_000 });
      this.versionCache = res.ok ? res.stdout.trim() : null;
    } catch {
      this.versionCache = null;
    }
    return this.versionCache;
  }

  /** Walk the sources again. Concurrent callers share one pass. */
  private async discover(force: boolean): Promise<void> {
    if (!force && this.discoveredAt && Date.now() - this.discoveredAt < DISCOVERY_TTL_MS) return;
    if (this.discovering) return this.discovering;
    this.discovering = (async () => {
      const started = Date.now();
      try {
        const result = await discoverRepos({
          projects: this.index.projects().map((p) => ({ key: p.key, path: p.path })),
          scanRoots: this.index.getGitScanRoots(),
          manual: this.index.getGitRepos(),
          hidden: this.index.getGitHidden(),
        });
        this.byKey = new Map(result.repos.map((repo) => [repo.key, repo]));
        this.byId = new Map(result.repos.map((repo) => [repo.id, repo]));
        this.siblings = result.siblings;
        this.rootCounts = result.rootCounts;
        this.rootErrors = result.rootErrors;
        this.discoveredAt = Date.now();
        log.info(`found ${result.repos.length} repositories in ${Date.now() - started} ms`, {
          scanRoots: this.index.getGitScanRoots().length,
          manual: this.index.getGitRepos().length,
          hidden: this.index.getGitHidden().size,
        });
      } catch (err) {
        log.error('repository discovery failed', err);
      } finally {
        this.discovering = null;
      }
    })();
    return this.discovering;
  }

  /** The repository an id names, or null. The only way a path is ever obtained. */
  repo(id: string): ResolvedRepo | null {
    return this.byId.get(id) ?? null;
  }

  /** Add a repository or a scan root. Returns what was actually stored. */
  async addPath(input: string, asRoot: boolean): Promise<string> {
    const check = await checkPath(input, asRoot);
    if (!check.ok) throw new GitBadInput(check.error ?? 'That path cannot be used.');

    const list = asRoot ? [...this.index.getGitScanRoots()] : [...this.index.getGitRepos()];
    if (list.some((entry) => entry.path.toLowerCase() === check.path.toLowerCase())) {
      throw new GitBadInput(asRoot ? 'That folder is already a scan root.' : 'That repository is already listed.');
    }
    if (list.length >= MAX_STORED_PATHS) {
      throw new GitBadInput(`That is already ${MAX_STORED_PATHS} entries — remove one first.`);
    }
    list.push({ path: check.path, addedAt: localIso() });
    await this.index.setGitPaths(asRoot ? { scanRoots: list } : { repos: list });
    log.info(`${asRoot ? 'scan root' : 'repository'} added: ${check.path}`);
    await this.discover(true);
    return check.path;
  }

  /** Remove a stored path by its literal value (roots and manual repos share the call). */
  async removePath(target: string, asRoot: boolean): Promise<void> {
    const list = (asRoot ? this.index.getGitScanRoots() : this.index.getGitRepos()).filter(
      (entry) => entry.path.toLowerCase() !== target.toLowerCase(),
    );
    await this.index.setGitPaths(asRoot ? { scanRoots: list } : { repos: list });
    log.info(`${asRoot ? 'scan root' : 'repository'} removed: ${target}`);
    await this.discover(true);
  }

  /**
   * Hide or show an auto-detected repository. Nothing is deleted and no folder
   * is touched — it only leaves the picker.
   */
  async setHidden(id: string, hidden: boolean): Promise<void> {
    const repo = this.repo(id);
    if (!repo) throw new GitBadInput('Repository not found.');
    const set = new Set(this.index.getGitHidden());
    if (hidden) set.add(repo.key);
    else set.delete(repo.key);
    await this.index.setGitPaths({ hidden: set });
    repo.hidden = hidden;
  }

  // ------------------------------------------------------------- locking

  /**
   * Hold a repository while something runs in it.
   *
   * Per repository rather than global: two checkouts are independent, and a
   * two-minute fetch in one must not freeze another's status. And it covers
   * READS as well as writes, because `git status` refreshes the index and takes
   * `index.lock` — a status racing a commit in the same repository produces
   * lock failures that look like our bug and are not.
   *
   * What a naive queue gets wrong is the other side of it: a read arriving
   * while the repository is held must not wait behind that fetch. Callers hand
   * back their last good figures instead — the same rule the usage service
   * follows, where a failed read never discards what it had.
   */
  async withRepoLock<T>(key: string, op: GitOp, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(key)) {
      await this.locks.get(key)?.done.catch(() => undefined);
    }
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, { op, since: Date.now(), done });
    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      release();
    }
  }

  /** What is holding this repository right now, if anything. */
  lockOn(key: string): GitOp | null {
    return this.locks.get(key)?.op ?? null;
  }

  /**
   * Some repository is in the middle of a MUTATION. Stopping the server,
   * uninstalling or applying an update all refuse while this is true: replacing
   * the server mid-rebase would leave a repository in a state nothing in this
   * app put it in.
   */
  get busy(): boolean {
    for (const lock of this.locks.values()) {
      if (MUTATING_OPS.has(lock.op)) return true;
    }
    return false;
  }

  get busyDescription(): string | null {
    for (const [key, lock] of this.locks) {
      if (!MUTATING_OPS.has(lock.op)) continue;
      const repo = this.byKey.get(key);
      return `a ${opLabel(lock.op)} in ${repo?.name ?? key}`;
    }
    return null;
  }

  // ------------------------------------------------------------- shared checks

  /**
   * Reasons that apply to every operation, before its own are considered. Kept
   * here so the endpoint and the button read the identical string.
   */
  baseBlockedReason(repo: ResolvedRepo, op: GitOp): string | null {
    if (!findGitExe()) return 'Git could not be found on this machine.';
    if (repo.error) return repo.error;
    if (!fs.existsSync(repo.path)) return `The folder no longer exists: ${repo.path}`;
    const held = this.lockOn(repo.key);
    if (held && held !== 'read' && op !== 'read') {
      return `A ${opLabel(held)} is running in this repository right now.`;
    }
    return null;
  }
}

/** Re-exported so routes can build an id without importing the repo module. */
export { repoIdOf };
