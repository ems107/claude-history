import {
  GIT_COMMIT_MAX_FILES,
  GIT_DIFF_MAX_FILES,
  GIT_DIFF_MAX_LINES,
  GIT_LOG_PAGE,
  GIT_MESSAGE_MAX,
  GIT_STATUS_MAX_ENTRIES,
  isValidRefName,
  isValidSha,
  type GitBranchesResponse,
  type GitCommandLogEntry,
  type GitCommandLogResponse,
  type GitCommitDetail,
  type GitCommitFile,
  type GitConflictSides,
  type GitDiffMode,
  type GitDiffResponse,
  type GitInProgress,
  type GitInProgressKind,
  type GitLogResponse,
  type GitOp,
  type GitOverview,
  type GitRemote,
  type GitRepo,
  type GitRepoRoot,
  type GitStash,
  type GitStatus,
  type GitTag,
  type GitWorktree,
} from '@claude-history/shared';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {
  GIT_NETWORK_TIMEOUT_MS,
  redact,
  runGit,
  setGitCommandSink,
  type GitRunOptions,
  type GitRunResult,
} from '../util/git.ts';
import { findGitExe } from '../util/launcher.ts';
import {
  BRANCH_FORMAT,
  COMMIT_FORMAT,
  LOG_FORMAT,
  REMOTE_BRANCH_FORMAT,
  STASH_FORMAT,
  TAG_FORMAT,
  parseCommitDetail,
  parseDiff,
  parseLocalBranches,
  parseLogRecords,
  parseNameStatusZ,
  parseNumstatZ,
  splitRawHunks,
  parseRemoteBranches,
  parseRemotes,
  parseStashList,
  parseStatusV2,
  parseTags,
  parseWorktreeList,
} from './gitParse.ts';
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

/**
 * How long our own writes are ignored by the `.git` watcher. Without it every
 * commit provokes a refetch of the change it just made.
 */
const WATCH_QUIET_MS = 600;

/**
 * Paths per `git clean` invocation. It is the one command here that will not
 * read a pathspec from stdin, so its paths go in argv — and a command line has
 * a length limit that a hundred paths will not reach.
 */
const CLEAN_BATCH = 100;

/** The same figure `core/watcher.ts` settled on for `~/.claude`. */
const WATCH_DEBOUNCE_MS = 300;
/** Repositories watched at once. A handle each is cheap; sixty clones is not. */
const MAX_WATCHERS = 8;
/** Stop watching a repository nobody has read for this long. */
const WATCH_IDLE_MS = 5 * 60 * 1000;
/** How often the idle sweep runs. */
const WATCH_SWEEP_MS = 60 * 1000;

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

/** Finishing what the repository is already in the middle of. */
const CONTINUATION_OPS = new Set<GitOp>(['continue', 'abort', 'skip']);

/**
 * What has to wait for a merge/rebase/cherry-pick to end. Staging, discarding
 * and committing are deliberately absent: staging is how a conflict gets
 * resolved, and a commit is how a merge is concluded.
 */
const BLOCKED_WHILE_IN_PROGRESS = new Set<GitOp>([
  'checkout',
  'merge',
  'rebase',
  'cherryPick',
  'revert',
  'reset',
  'pull',
  'push',
  'pushUpstream',
  'pushDelete',
  'pushForce',
  'branchCreate',
  'branchDelete',
  'branchRename',
  'stash',
  'stashApply',
  'stashPop',
  'worktreeAdd',
  'worktreeRemove',
]);

/** The operations whose reason travels with every status, for the controls that show them. */
const REPORTED_OPS: GitOp[] = [
  'stage',
  'unstage',
  'discard',
  'commit',
  'amend',
  'checkout',
  'branchCreate',
  'branchDelete',
  'fetch',
  'pull',
  'push',
  'pushUpstream',
  'pushDelete',
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
  'continue',
  'abort',
  'skip',
];

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
  /** Repo key -> the moment its own-write quiet period ends. */
  private quietUntil = new Map<string, number>();
  private watchers = new Map<string, { lastRead: number; close: () => void }>();
  private sweepTimer: NodeJS.Timeout | null = null;

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
    this.sweepTimer = setInterval(() => this.sweepWatchers(), WATCH_SWEEP_MS);
    this.sweepTimer.unref();
  }

  shutdown(): void {
    setGitCommandSink(null);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const key of [...this.watchers.keys()]) this.unwatch(key);
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
    else if (!result.ok && opts.expectFailure) log.debug(line);
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

  // ------------------------------------------------------------- reading state

  private statusCache = new Map<string, GitStatus>();

  /**
   * The working tree, the branch and what is blocked.
   *
   * A read arriving while the repository is held by a MUTATION does not queue
   * behind it — a two-minute fetch would freeze the page — it answers with the
   * last figures it had, marked `stale`. That is the usage service's rule
   * ("a failed read never discards the last good figures") applied to a lock
   * instead of to a failure. With nothing cached there is no choice but to
   * wait, which is at least honest.
   */
  async status(repo: ResolvedRepo, signal?: AbortSignal): Promise<GitStatus> {
    const held = this.lockOn(repo.key);
    if (held && MUTATING_OPS.has(held)) {
      const cached = this.statusCache.get(repo.key);
      if (cached) return { ...cached, stale: true };
    }
    // Someone is looking at this repository, which is what a watcher is for.
    this.watchRepo(repo);
    return this.withRepoLock(repo.key, 'read', async () => {
      const status = await this.readStatus(repo, signal);
      this.statusCache.set(repo.key, status);
      return status;
    });
  }

  /** Drop the cached figures for a repository — after a mutation, or a change on disk. */
  invalidate(repoKey: string): void {
    this.statusCache.delete(repoKey);
  }

  // ------------------------------------------------------------- watching .git

  /**
   * Notice when a repository changes underneath us.
   *
   * The concrete case is the ordinary one: you work in a terminal with this tab
   * open. Without this the page shows a branch you switched five minutes ago,
   * and a git client that lies about the current branch is worse than none. It
   * is also what turns "resolve the conflict outside the app" from an
   * instruction into a workflow — fix the file in an editor and the banner
   * updates itself.
   *
   * Scoped hard: the GITDIR only, NOT recursive, and only while someone is
   * looking. That way it fires on HEAD, index, MERGE_HEAD, ORIG_HEAD and the
   * refs directory, and never on a working-tree edit — watching a large tree
   * recursively means thousands of handles and an event per write inside
   * node_modules. Working-tree edits are picked up by the ordinary refetch.
   *
   * The event invalidates LOCAL state. It must never lead to a fetch: that
   * would turn a file being saved into network traffic, which the app's network
   * policy forbids outright.
   */
  private watchRepo(repo: ResolvedRepo): void {
    const existing = this.watchers.get(repo.key);
    if (existing) {
      existing.lastRead = Date.now();
      return;
    }
    // A handle per open repository is cheap; sixty clones' worth is not.
    while (this.watchers.size >= MAX_WATCHERS) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [key, watch] of this.watchers) {
        if (watch.lastRead < oldest) {
          oldest = watch.lastRead;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      this.unwatch(oldestKey);
    }

    let timer: NodeJS.Timeout | null = null;
    try {
      const isQuiet = (): boolean => Date.now() < (this.quietUntil.get(repo.key) ?? 0);
      const watcher = fs.watch(repo.gitDir, { recursive: false }, () => {
        if (isQuiet()) return;
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          // Checked AGAIN here, and this is the check that does the work: a
          // write of ours fires its first event before the command has
          // finished, so the timer is already armed by the time the quiet
          // period is set. Testing only on arrival let every commit echo
          // straight back at the page.
          if (isQuiet()) return;
          this.invalidate(repo.key);
          this.events.emit('repo-changed', repo.id);
        }, WATCH_DEBOUNCE_MS);
      });
      watcher.on('error', () => this.unwatch(repo.key));
      this.watchers.set(repo.key, {
        lastRead: Date.now(),
        close: () => {
          if (timer) clearTimeout(timer);
          watcher.close();
        },
      });
      log.debug(`watching ${repo.name}`);
    } catch (err) {
      // A folder that cannot be watched is not a failure worth surfacing: the
      // page simply refetches the ordinary way.
      log.debug(`could not watch ${repo.name}`, err);
    }
  }

  private unwatch(key: string): void {
    const watch = this.watchers.get(key);
    if (!watch) return;
    watch.close();
    this.watchers.delete(key);
  }

  /** Let go of repositories nobody has looked at for a while. */
  private sweepWatchers(): void {
    const cutoff = Date.now() - WATCH_IDLE_MS;
    for (const [key, watch] of this.watchers) {
      if (watch.lastRead < cutoff) this.unwatch(key);
    }
  }

  private async readStatus(repo: ResolvedRepo, signal?: AbortSignal): Promise<GitStatus> {
    const [statusRes, subjectRes, stashRes] = await Promise.all([
      runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        signal,
        label: 'status',
        // `normal` collapses an untracked directory into one entry. `all` on a
        // repository with an untracked node_modules is seconds and tens of
        // thousands of rows, so it stays an explicit choice nobody makes here.
        args: ['status', '--porcelain=v2', '--branch', '--untracked-files=normal', '-z'],
      }),
      runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        signal,
        label: 'head-subject',
        args: ['log', '-1', '--format=%s'],
      }),
      runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        signal,
        label: 'stash-count',
        args: ['stash', 'list', '--format=%gd'],
      }),
    ]);

    if (!statusRes.ok) throw new GitFailed(statusRes);
    const parsed = parseStatusV2(statusRes.stdout);
    const truncated = parsed.entries.length > GIT_STATUS_MAX_ENTRIES;
    const entries = truncated ? parsed.entries.slice(0, GIT_STATUS_MAX_ENTRIES) : parsed.entries;

    const status: GitStatus = {
      repoId: repo.id,
      branch: parsed.branch,
      detachedAt: parsed.detachedAt,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      headSha: parsed.headSha,
      // A repository with no commits at all answers non-zero here; that is not
      // an error, it just has no subject yet.
      headSubject: subjectRes.ok ? subjectRes.stdout.trim() || null : null,
      entries,
      truncated,
      inProgress: this.readInProgress(repo),
      stashCount: stashRes.ok ? stashRes.stdout.split('\n').filter((l) => l.trim()).length : 0,
      blocked: {},
      readAt: localIso(),
      stale: false,
    };
    status.blocked = this.blockedMap(repo, status);
    // The branch may have moved since discovery; the picker shows it.
    repo.currentBranch = parsed.branch;
    return status;
  }

  /**
   * What the repository is in the middle of, read from the gitdir rather than
   * from git's English. `--absolute-git-dir` already answered with the right
   * directory for a linked worktree, so these are plain file reads.
   */
  private readInProgress(repo: ResolvedRepo): GitInProgress | null {
    const at = (...parts: string[]): string => path.join(repo.gitDir, ...parts);
    const read = (...parts: string[]): string | null => {
      try {
        return fs.readFileSync(at(...parts), 'utf8').trim();
      } catch {
        return null;
      }
    };
    const exists = (...parts: string[]): boolean => fs.existsSync(at(...parts));
    const num = (value: string | null): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const make = (kind: GitInProgressKind, extra: Partial<GitInProgress> = {}): GitInProgress => ({
      kind,
      step: null,
      total: null,
      headName: null,
      ontoSha: null,
      canContinue: true,
      canAbort: true,
      canSkip: false,
      ...extra,
    });

    if (exists('rebase-merge')) {
      // NOT checked against `rebase-merge/interactive`, however much that file
      // sounds like the answer. Since the merge backend became the default git
      // writes it for EVERY rebase — verified on 2.55 with a plain
      // `pull --rebase` — so keying on it labelled every rebase "interactive",
      // which is a claim about what the user asked for that we cannot support.
      // A rebase is a rebase here.
      return make('rebase', {
        step: num(read('rebase-merge', 'msgnum')),
        total: num(read('rebase-merge', 'end')),
        headName: read('rebase-merge', 'head-name')?.replace(/^refs\/heads\//, '') ?? null,
        ontoSha: read('rebase-merge', 'onto'),
        canSkip: true,
      });
    }
    if (exists('rebase-apply')) {
      // The same directory serves `git am`; only `applying` tells them apart.
      const isAm = exists('rebase-apply', 'applying');
      return make(isAm ? 'am' : 'rebase', {
        step: num(read('rebase-apply', 'next')),
        total: num(read('rebase-apply', 'last')),
        headName: read('rebase-apply', 'head-name')?.replace(/^refs\/heads\//, '') ?? null,
        ontoSha: read('rebase-apply', 'onto'),
        canSkip: true,
      });
    }
    if (exists('MERGE_HEAD')) return make('merge');
    if (exists('CHERRY_PICK_HEAD')) return make('cherry-pick', { canSkip: true });
    if (exists('REVERT_HEAD')) return make('revert');
    if (exists('BISECT_LOG')) return make('bisect', { canContinue: false });
    return null;
  }

  async branches(repo: ResolvedRepo, signal?: AbortSignal): Promise<GitBranchesResponse> {
    return this.withRepoLock(repo.key, 'read', async () => {
      const [localRes, remoteRes, worktreeRes] = await Promise.all([
        runGit({
          cwd: repo.path,
          repoKey: repo.key,
          readOnly: true,
          signal,
          label: 'branches',
          args: ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads'],
        }),
        runGit({
          cwd: repo.path,
          repoKey: repo.key,
          readOnly: true,
          signal,
          label: 'remote-branches',
          args: ['for-each-ref', `--format=${REMOTE_BRANCH_FORMAT}`, 'refs/remotes'],
        }),
        runGit({
          cwd: repo.path,
          repoKey: repo.key,
          readOnly: true,
          signal,
          label: 'worktrees',
          args: ['worktree', 'list', '--porcelain'],
        }),
      ]);
      if (!localRes.ok) throw new GitFailed(localRes);

      // A branch checked out in a linked worktree cannot be checked out here,
      // and saying so beforehand beats git's error after the click.
      const worktreeBranches = new Map<string, string>();
      if (worktreeRes.ok) {
        for (const wt of parseWorktreeList(worktreeRes.stdout)) {
          if (wt.branch && path.normalize(wt.path).toLowerCase() !== repo.path.toLowerCase()) {
            worktreeBranches.set(wt.branch, wt.path);
          }
        }
      }

      const local = parseLocalBranches(localRes.stdout, worktreeBranches);
      const localNames = new Set(local.map((b) => b.name));
      const remote = remoteRes.ok ? parseRemoteBranches(remoteRes.stdout, localNames) : [];
      const current = local.find((b) => b.current) ?? null;
      return { current: current?.name ?? null, detached: !current, local, remote };
    });
  }

  /**
   * A page of commits, as edges rather than as a drawing.
   *
   * `git log --graph` is never used: its ASCII art is meant for people, it has
   * changed shape between versions, and it cannot be turned back into the edges
   * a renderer needs. `%P` is the graph; everything else on the row is text
   * beside it, and the lane layout happens in the browser.
   *
   * `--date-order` rather than `--topo-order` on purpose. Topo order draws
   * tidier lanes but has to walk the whole history before it can emit the first
   * commit, which makes page one slow exactly where it matters; date order
   * streams and pages stably.
   */
  async log(
    repo: ResolvedRepo,
    opts: { limit: number; offset: number; ref?: string | null; path?: string | null },
    signal?: AbortSignal,
  ): Promise<GitLogResponse> {
    const limit = Math.min(GIT_LOG_PAGE * 5, Math.max(1, Math.floor(opts.limit)));
    const offset = Math.max(0, Math.floor(opts.offset));

    const args = [
      'log',
      '--no-color',
      '--date-order',
      '--decorate=full',
      // A stash is a commit with a ref, and it would appear as a mystery row.
      '--decorate-refs-exclude=refs/stash',
      `--format=${LOG_FORMAT}`,
      '-n',
      // One more than asked: its arrival is what `hasMore` means.
      String(limit + 1),
      '--skip',
      String(offset),
    ];

    if (opts.ref) {
      if (!isValidRefName(opts.ref)) throw new GitBadInput('That is not a valid ref name.');
      args.push(opts.ref);
    } else {
      // Not `--all`: that also drags in refs/notes and other namespaces, which
      // would show up as commits nobody recognises.
      args.push('--branches', '--tags', '--remotes', 'HEAD');
    }
    args.push('--');
    if (opts.path) args.push(opts.path);

    const res = await runGit({
      cwd: repo.path,
      repoKey: repo.key,
      readOnly: true,
      signal,
      label: 'log',
      args,
      // A page of 200 subjects is small; a repository with enormous messages
      // should still not be able to hand us tens of megabytes.
      maxBytes: 16 * 1024 * 1024,
    });
    if (!res.ok) {
      // A repository with no commits has no HEAD to walk. That is not a
      // failure, it is what an empty repository looks like — and git says so
      // in several different ways depending on which argument it choked on
      // ("bad revision 'HEAD'" is the one a freshly cloned empty repo gives).
      if (/does not have any commits yet|unknown revision|bad revision|bad default revision/i.test(res.stderr)) {
        return { commits: [], hasMore: false, offset };
      }
      throw new GitFailed(res);
    }

    const all = parseLogRecords(res.stdout);
    const hasMore = all.length > limit;
    return { commits: hasMore ? all.slice(0, limit) : all, hasMore, offset };
  }

  /**
   * One commit: its message, and which files it touched.
   *
   * A merge is diffed against its FIRST parent. `git show` on a merge prints
   * nothing by default, which reads as "this commit changed no files" — the
   * one thing that is certainly untrue about it.
   */
  async commitDetail(repo: ResolvedRepo, sha: string, signal?: AbortSignal): Promise<GitCommitDetail> {
    if (!isValidSha(sha)) throw new GitBadInput('That is not a commit id.');

    const [metaRes, numstatRes, nameRes] = await Promise.all([
      runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        signal,
        label: 'commit',
        args: ['show', '--no-patch', `--format=${COMMIT_FORMAT}`, '--decorate=full', sha, '--'],
      }),
      runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        signal,
        label: 'commit-numstat',
        args: ['show', '--format=', '--numstat', '-z', '--find-renames', '--diff-merges=first-parent', sha, '--'],
      }),
      runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        signal,
        label: 'commit-status',
        args: ['show', '--format=', '--name-status', '-z', '--find-renames', '--diff-merges=first-parent', sha, '--'],
      }),
    ]);
    if (!metaRes.ok) throw new GitFailed(metaRes);
    const detail = parseCommitDetail(metaRes.stdout);
    if (!detail) throw new GitBadInput('That commit could not be read.');

    const statusByPath = new Map<string, string>();
    if (nameRes.ok) {
      for (const entry of parseNameStatusZ(nameRes.stdout)) statusByPath.set(entry.path, entry.status);
    }

    const stats = numstatRes.ok ? parseNumstatZ(numstatRes.stdout) : [];
    const truncated = stats.length > GIT_COMMIT_MAX_FILES;
    const files: GitCommitFile[] = (truncated ? stats.slice(0, GIT_COMMIT_MAX_FILES) : stats).map((entry) => ({
      path: entry.path,
      origPath: entry.origPath,
      status: statusByPath.get(entry.path) ?? 'M',
      additions: entry.additions,
      deletions: entry.deletions,
      binary: entry.binary,
    }));

    return {
      commit: detail.commit,
      body: detail.body,
      committerName: detail.committerName,
      committerEmail: detail.committerEmail,
      files,
      additions: stats.reduce((sum, f) => sum + (f.additions ?? 0), 0),
      deletions: stats.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
      truncated,
    };
  }

  /**
   * A diff, already parsed into hunks.
   *
   * Parsing here rather than in the browser is what lets hunk-level staging
   * post an index later instead of a patch the client reassembled — the client
   * never has to be able to rebuild something git will accept.
   */
  async diff(
    repo: ResolvedRepo,
    opts: { mode: GitDiffMode; sha?: string | null; base?: string | null; path?: string | null; context?: number },
    signal?: AbortSignal,
  ): Promise<GitDiffResponse> {
    const context = Math.min(50, Math.max(0, Math.floor(opts.context ?? 3)));
    const args = ['--no-color', `-U${context}`, '--find-renames'];

    let command: string[];
    switch (opts.mode) {
      case 'commit': {
        if (!opts.sha || !isValidSha(opts.sha)) throw new GitBadInput('That is not a commit id.');
        command = ['show', '--format=', '--diff-merges=first-parent', ...args, opts.sha];
        break;
      }
      case 'range': {
        if (!opts.sha || !isValidSha(opts.sha)) throw new GitBadInput('That is not a commit id.');
        if (!opts.base || !isValidSha(opts.base)) throw new GitBadInput('That is not a commit id.');
        command = ['diff', ...args, `${opts.base}..${opts.sha}`];
        break;
      }
      case 'staged':
        command = ['diff', '--cached', ...args];
        break;
      case 'worktree':
      case 'conflict':
      default:
        command = ['diff', ...args];
        break;
    }

    command.push('--');
    if (opts.path) command.push(opts.path);

    const res = await runGit({
      cwd: repo.path,
      repoKey: repo.key,
      readOnly: true,
      signal,
      label: `diff:${opts.mode}`,
      args: command,
      maxBytes: 24 * 1024 * 1024,
    });
    // `diff` answers 1 when there ARE differences, which is the normal case.
    if (!res.ok && res.exitCode !== 1) throw new GitFailed(res);

    const files = parseDiff(res.stdout, GIT_DIFF_MAX_LINES);
    const truncated = res.truncated || files.length > GIT_DIFF_MAX_FILES;
    return {
      mode: opts.mode,
      files: truncated ? files.slice(0, GIT_DIFF_MAX_FILES) : files,
      truncated,
    };
  }

  /**
   * Stage, unstage or discard ONE hunk.
   *
   * The patch handed to `git apply` is git's own bytes: the file is re-diffed
   * and its raw output split, rather than re-emitted from the parsed structure.
   * Measured rather than assumed — git forgives a wrong `@@` count, but not a
   * context line that lost its leading space, not a hunk that lost its trailing
   * newline, and not line endings altered in transit, which make the whole file
   * read as changed. Hence: assembled in memory, handed over on stdin, never
   * rebuilt from parsed lines and never through a shell pipeline.
   *
   * The index is resolved against a diff taken NOW, so a file that changed
   * since the page drew it produces a patch that will not apply, and git says
   * so. That is the desired outcome: better a refusal than the right hunk
   * number in the wrong file.
   */
  async applyHunk(
    repo: ResolvedRepo,
    body: { path?: unknown; hunkIndex?: unknown; staged?: unknown; discard?: unknown; confirm?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const discard = body.discard === true;
    if (discard) GitService.requireConfirm(body.confirm, 'Discarding a hunk');
    const fromIndex = body.staged === true;
    const op: GitOp = discard ? 'discard' : fromIndex ? 'unstage' : 'stage';

    const { result, status } = await this.mutate(repo, op, async (before) => {
      const [filePath] = this.validPaths(before, [body.path]);
      const index = Number(body.hunkIndex);
      if (!Number.isInteger(index) || index < 0) throw new GitBadInput('That is not a hunk.');

      const res = await runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        label: 'hunk-diff',
        args: ['diff', '--no-color', '-U3', '--find-renames', ...(fromIndex ? ['--cached'] : []), '--', filePath],
      });
      if (!res.ok && res.exitCode !== 1) throw new GitFailed(res);

      const { header, hunks } = splitRawHunks(res.stdout);
      if (!hunks[index]) throw new GitBadInput('That hunk is no longer there — reload and try again.');
      // A trailing newline is part of the patch format, not decoration.
      const patch = `${header}\n${hunks[index]}\n`.replace(/\n{2,}$/, '\n');

      const args = ['apply'];
      // --cached touches only the index; without it the working tree changes.
      if (!discard) args.push('--cached');
      if (fromIndex || discard) args.push('--reverse');
      args.push('-');
      const applied = await runGit({
        cwd: repo.path,
        repoKey: repo.key,
        mutation: true,
        label: `hunk:${op}`,
        args,
        stdin: patch,
      });
      if (!applied.ok) throw new GitFailed(applied);
      return hunks.length;
    });
    return { status, message: `Hunk ${Number(body.hunkIndex) + 1} of ${result}.` };
  }

  /**
   * The three sides of a conflicted file: the common ancestor, ours and theirs.
   *
   * A plain `git diff` answers a conflicted file badly — it shows the merge
   * markers as content. These are the actual stages git is holding, and any of
   * them can be absent (a file added on one side has no ancestor).
   */
  async conflictSides(repo: ResolvedRepo, filePath: string, signal?: AbortSignal): Promise<GitConflictSides> {
    const status = await this.status(repo, signal);
    const entry = status.entries.find((e) => e.path === filePath && e.conflicted);
    if (!entry) throw new GitBadInput('That file is not conflicted.');

    const stage = async (n: 1 | 2 | 3): Promise<string | null> => {
      const res = await runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        signal,
        label: `conflict:${n}`,
        expectFailure: true,
        args: ['show', `:${n}:${filePath}`],
        maxBytes: 2 * 1024 * 1024,
      });
      if (!res.ok) return null;
      return res.truncated ? null : res.stdout;
    };

    const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)]);
    return {
      path: filePath,
      base,
      ours,
      theirs,
      tooLarge: base === null && ours === null && theirs === null,
    };
  }

  async stashes(repo: ResolvedRepo, signal?: AbortSignal): Promise<GitStash[]> {
    const res = await runGit({
      cwd: repo.path,
      repoKey: repo.key,
      readOnly: true,
      signal,
      label: 'stashes',
      args: ['stash', 'list', `--format=${STASH_FORMAT}`],
    });
    return res.ok ? parseStashList(res.stdout) : [];
  }

  async tags(repo: ResolvedRepo, signal?: AbortSignal): Promise<GitTag[]> {
    const res = await runGit({
      cwd: repo.path,
      repoKey: repo.key,
      readOnly: true,
      signal,
      label: 'tags',
      args: ['for-each-ref', `--format=${TAG_FORMAT}`, '--sort=-creatordate', 'refs/tags'],
    });
    if (!res.ok) throw new GitFailed(res);
    return parseTags(res.stdout);
  }

  async remotes(repo: ResolvedRepo, signal?: AbortSignal): Promise<GitRemote[]> {
    const res = await runGit({
      cwd: repo.path,
      repoKey: repo.key,
      readOnly: true,
      signal,
      label: 'remotes',
      args: ['remote', '-v'],
    });
    if (!res.ok) throw new GitFailed(res);
    return parseRemotes(res.stdout);
  }

  async worktrees(repo: ResolvedRepo, signal?: AbortSignal): Promise<GitWorktree[]> {
    const res = await runGit({
      cwd: repo.path,
      repoKey: repo.key,
      readOnly: true,
      signal,
      label: 'worktrees',
      args: ['worktree', 'list', '--porcelain'],
    });
    if (!res.ok) throw new GitFailed(res);
    return parseWorktreeList(res.stdout);
  }

  // ------------------------------------------------------------- writing

  /**
   * Run something that CHANGES the repository.
   *
   * Refuses first, with the same string the disabled button showed — the check
   * and the tooltip are literally the same function, so they cannot drift. Then
   * holds the repository for the duration, drops the cached status, and reads a
   * fresh one AFTER the lock is released (reading inside it would wait on
   * itself). The caller gets that status back, so the UI never has to ask twice
   * and can never draw a stale one.
   */
  private async mutate<T>(
    repo: ResolvedRepo,
    op: GitOp,
    fn: (status: GitStatus) => Promise<T>,
  ): Promise<{ result: T; status: GitStatus }> {
    const before = await this.status(repo);
    const blocked = this.blockedFor(repo, op, before);
    if (blocked) {
      log.warn(`${op} refused in ${repo.name} — ${blocked}`);
      throw new GitBlocked(blocked);
    }
    let result: T;
    // Set BEFORE the command runs, not only after: git touches the gitdir while
    // it works, so the watcher's first event arrives long before this returns.
    this.quietUntil.set(repo.key, Date.now() + WATCH_QUIET_MS);
    try {
      result = await this.withRepoLock(repo.key, op, () => fn(before));
    } finally {
      // And extended past the end of it, because that is when the last write
      // lands. Ignoring our own echo is what stops every commit provoking a
      // refetch of the change it just made.
      this.quietUntil.set(repo.key, Date.now() + WATCH_QUIET_MS);
      this.invalidate(repo.key);
    }
    const status = await this.status(repo);
    return { result, status };
  }

  /** A mutating command that must succeed. */
  private async write(repo: ResolvedRepo, op: GitOp, args: string[], stdin?: string): Promise<GitRunResult> {
    const res = await runGit({
      cwd: repo.path,
      repoKey: repo.key,
      mutation: true,
      label: op,
      args,
      stdin,
    });
    if (!res.ok) throw new GitFailed(res);
    return res;
  }

  /**
   * A mutating command where a non-zero exit can be the ANSWER rather than a
   * failure: a merge that conflicts did exactly what it was asked to, and the
   * repository is now in a state the UI has to show rather than an error it has
   * to report.
   */
  private async writeAllowingConflict(
    repo: ResolvedRepo,
    op: GitOp,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<{ conflicted: boolean; message: string }> {
    const res = await runGit({ cwd: repo.path, repoKey: repo.key, mutation: true, label: op, args, env });
    const output = `${res.stdout}\n${res.stderr}`;
    if (res.ok) return { conflicted: false, message: res.stdout.trim() || res.stderr.trim() };
    if (/CONFLICT|Automatic merge failed|could not apply|error: could not apply/i.test(output)) {
      return { conflicted: true, message: output.trim().slice(0, 2_000) };
    }
    throw new GitFailed(res);
  }

  /**
   * Paths must appear in the status we just read. Anything else is refused
   * rather than passed on: it is the only way a path can reach git at all, and
   * it means a stale page cannot act on a file that has since changed.
   */
  private validPaths(status: GitStatus, raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new GitBadInput('No files were given.');
    if (raw.length > GIT_STATUS_MAX_ENTRIES) throw new GitBadInput('That is too many files for one call.');
    const known = new Set(status.entries.map((e) => e.path));
    const out: string[] = [];
    for (const path of raw) {
      if (typeof path !== 'string' || !known.has(path)) {
        throw new GitBadInput('Some of those files are not in the current status — reload and try again.');
      }
      out.push(path);
    }
    return out;
  }

  /** NUL-joined for `--pathspec-from-file=- --pathspec-file-nul`: no argv limit, no quoting. */
  private static pathspecStdin(paths: string[]): string {
    return `${paths.join('\0')}\0`;
  }

  /** A ref that must already exist. Checked against the repository, not just its shape. */
  private async assertRef(repo: ResolvedRepo, ref: string): Promise<string> {
    if (!isValidRefName(ref)) throw new GitBadInput('That is not a valid ref name.');
    const res = await runGit({
      cwd: repo.path,
      repoKey: repo.key,
      readOnly: true,
      label: 'verify-ref',
      args: ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`, '--'],
    });
    if (!res.ok) throw new GitBadInput(`There is no ref called ${ref}.`);
    return ref;
  }

  /** A name for a branch that does not exist yet. git's own grammar is the authority. */
  private async assertNewBranchName(repo: ResolvedRepo, name: string): Promise<string> {
    if (!isValidRefName(name)) throw new GitBadInput('That is not a valid branch name.');
    const res = await runGit({
      cwd: repo.path,
      repoKey: repo.key,
      readOnly: true,
      label: 'check-ref-format',
      args: ['check-ref-format', '--branch', name],
    });
    if (!res.ok) throw new GitBadInput(`git will not accept "${name}" as a branch name.`);
    return name;
  }

  private static requireConfirm(confirm: unknown, what: string): void {
    if (confirm !== true) throw new GitBadInput(`${what} cannot be undone — confirm it to go ahead.`);
  }

  async stage(repo: ResolvedRepo, paths: unknown): Promise<{ status: GitStatus }> {
    const { status } = await this.mutate(repo, 'stage', async (before) => {
      const list = this.validPaths(before, paths);
      await this.write(
        repo,
        'stage',
        ['add', '--pathspec-from-file=-', '--pathspec-file-nul', '--'],
        GitService.pathspecStdin(list),
      );
    });
    return { status };
  }

  async unstage(repo: ResolvedRepo, paths: unknown): Promise<{ status: GitStatus }> {
    const { status } = await this.mutate(repo, 'unstage', async (before) => {
      const list = this.validPaths(before, paths);
      await this.write(
        repo,
        'unstage',
        ['restore', '--staged', '--pathspec-from-file=-', '--pathspec-file-nul', '--'],
        GitService.pathspecStdin(list),
      );
    });
    return { status };
  }

  /**
   * Put files back the way HEAD has them, index and working tree both.
   *
   * Tracked and untracked files need different commands, and untracked ones are
   * the dangerous half: `git clean` deletes, and there is nothing to undo it
   * with. It is also the one command here that will NOT take a pathspec on
   * stdin, so its paths go in argv, in batches — deleting untracked files is a
   * handful at a time in practice, and a command line has a length limit.
   */
  async discard(repo: ResolvedRepo, paths: unknown, confirm: unknown): Promise<{ status: GitStatus }> {
    GitService.requireConfirm(confirm, 'Discarding changes');
    const { status } = await this.mutate(repo, 'discard', async (before) => {
      const list = this.validPaths(before, paths);
      const byPath = new Map(before.entries.map((e) => [e.path, e]));
      const untracked = list.filter((p) => byPath.get(p)?.unstaged === 'untracked');
      const tracked = list.filter((p) => byPath.get(p)?.unstaged !== 'untracked');

      if (tracked.length > 0) {
        await this.write(
          repo,
          'discard',
          ['restore', '--source=HEAD', '--staged', '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul', '--'],
          GitService.pathspecStdin(tracked),
        );
      }
      for (let i = 0; i < untracked.length; i += CLEAN_BATCH) {
        // -d because an untracked DIRECTORY is one status entry, and that entry
        // is what the user chose.
        await this.write(repo, 'discard', ['clean', '-f', '-d', '--', ...untracked.slice(i, i + CLEAN_BATCH)]);
      }
    });
    return { status };
  }

  async createCommit(
    repo: ResolvedRepo,
    body: { message?: unknown; amend?: unknown; noVerify?: unknown; confirm?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw new GitBadInput('The commit message is empty.');
    if (message.length > GIT_MESSAGE_MAX) throw new GitBadInput('That commit message is far too long.');
    const amend = body.amend === true;

    const { result, status } = await this.mutate(repo, amend ? 'amend' : 'commit', async (before) => {
      // Amending something already pushed rewrites published history; it is
      // allowed, but not by accident.
      if (amend && before.upstream && before.ahead === 0) {
        GitService.requireConfirm(body.confirm, 'Amending a commit that is already on the remote');
      }
      const args = ['commit', '-F', '-', '--cleanup=whitespace'];
      if (amend) args.push('--amend');
      // Never on by default: a hook that fails is telling you something, and
      // when it IS skipped the panel shows the flag that skipped it.
      if (body.noVerify === true) args.push('--no-verify');
      const res = await this.write(repo, amend ? 'amend' : 'commit', args, message);
      return res.stdout.trim();
    });
    return { status, message: result };
  }

  async checkout(
    repo: ResolvedRepo,
    body: { ref?: unknown; create?: unknown; from?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const ref = typeof body.ref === 'string' ? body.ref : '';
    const create = body.create === true;

    const { result, status } = await this.mutate(repo, 'checkout', async () => {
      const args = ['checkout'];
      if (create) {
        args.push('-b', await this.assertNewBranchName(repo, ref));
        if (typeof body.from === 'string' && body.from) args.push(await this.assertRef(repo, body.from));
      } else {
        args.push(await this.assertRef(repo, ref));
      }
      args.push('--');
      const res = await this.write(repo, 'checkout', args);
      return (res.stderr.trim() || res.stdout.trim()).slice(0, 500);
    });
    return { status, message: result };
  }

  async branchCreate(
    repo: ResolvedRepo,
    body: { name?: unknown; from?: unknown; checkout?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    if (body.checkout === true) {
      return this.checkout(repo, { ref: body.name, create: true, from: body.from });
    }
    const name = typeof body.name === 'string' ? body.name : '';
    const { status } = await this.mutate(repo, 'branchCreate', async () => {
      const args = ['branch', '--', await this.assertNewBranchName(repo, name)];
      if (typeof body.from === 'string' && body.from) args.push(await this.assertRef(repo, body.from));
      await this.write(repo, 'branchCreate', args);
    });
    return { status, message: `Created ${name}.` };
  }

  async branchDelete(
    repo: ResolvedRepo,
    body: { name?: unknown; force?: unknown; confirm?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const name = typeof body.name === 'string' ? body.name : '';
    const force = body.force === true;
    // `-d` refuses an unmerged branch on its own, so only `-D` throws work away.
    if (force) GitService.requireConfirm(body.confirm, 'Deleting a branch that is not merged');

    const { result, status } = await this.mutate(repo, 'branchDelete', async (before) => {
      if (name === before.branch) throw new GitBadInput('That is the branch you are on — check out another first.');
      await this.assertRef(repo, name);
      const res = await this.write(repo, 'branchDelete', ['branch', force ? '-D' : '-d', '--', name]);
      return res.stdout.trim();
    });
    return { status, message: result };
  }

  async branchRename(
    repo: ResolvedRepo,
    body: { from?: unknown; to?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const from = typeof body.from === 'string' ? body.from : '';
    const to = typeof body.to === 'string' ? body.to : '';
    const { status } = await this.mutate(repo, 'branchRename', async () => {
      await this.assertRef(repo, from);
      await this.write(repo, 'branchRename', ['branch', '-m', '--', from, await this.assertNewBranchName(repo, to)]);
    });
    return { status, message: `Renamed ${from} to ${to}.` };
  }

  async merge(
    repo: ResolvedRepo,
    body: { ref?: unknown; noFf?: unknown; squash?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const ref = typeof body.ref === 'string' ? body.ref : '';
    const { result, status } = await this.mutate(repo, 'merge', async () => {
      const target = await this.assertRef(repo, ref);
      const args = ['merge', '--no-edit'];
      if (body.noFf === true) args.push('--no-ff');
      if (body.squash === true) args.push('--squash');
      args.push('--', target);
      return this.writeAllowingConflict(repo, 'merge', args);
    });
    return {
      status,
      message: result.conflicted
        ? `The merge stopped on conflicts. Resolve them, stage the files, then continue.\n${result.message}`
        : result.message,
    };
  }

  async reset(
    repo: ResolvedRepo,
    body: { sha?: unknown; mode?: unknown; confirm?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const sha = typeof body.sha === 'string' ? body.sha : '';
    const mode = body.mode === 'soft' || body.mode === 'hard' ? body.mode : 'mixed';
    // Only --hard destroys work; soft and mixed leave every change on disk.
    if (mode === 'hard') GitService.requireConfirm(body.confirm, 'A hard reset');

    const { result, status } = await this.mutate(repo, 'reset', async () => {
      if (!isValidSha(sha)) throw new GitBadInput('That is not a commit id.');
      const verify = await runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        label: 'verify-sha',
        args: ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`, '--'],
      });
      if (!verify.ok) throw new GitBadInput('There is no commit with that id here.');
      const res = await this.write(repo, 'reset', ['reset', `--${mode}`, sha]);
      return (res.stdout.trim() || res.stderr.trim()).slice(0, 500);
    });
    return { status, message: result };
  }

  // ------------------------------------------------------------- rewriting

  async rebase(repo: ResolvedRepo, body: { onto?: unknown }): Promise<{ status: GitStatus; message: string }> {
    const onto = typeof body.onto === 'string' ? body.onto : '';
    const { result, status } = await this.mutate(repo, 'rebase', async () => {
      const target = await this.assertRef(repo, onto);
      return this.writeAllowingConflict(repo, 'rebase', ['-c', 'core.editor=true', 'rebase', '--', target], {
        GIT_EDITOR: 'true',
      });
    });
    return {
      status,
      message: result.conflicted
        ? `The rebase stopped on conflicts. Resolve them, stage the files, then continue.\n${result.message}`
        : result.message,
    };
  }

  /**
   * Copy commits onto the current branch.
   *
   * A merge commit has no single "the change it made", so git refuses one
   * without being told which parent to treat as the mainline. Rather than
   * passing 1 quietly, that refusal is turned into a sentence the user can act
   * on: it is a real question about what they meant.
   */
  async cherryPick(
    repo: ResolvedRepo,
    body: { shas?: unknown; mainline?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const { result, status } = await this.mutate(repo, 'cherryPick', async () => {
      const shas = await this.validShas(repo, body.shas);
      const args = ['-c', 'core.editor=true', 'cherry-pick'];
      if (typeof body.mainline === 'number' && body.mainline > 0) args.push('-m', String(Math.floor(body.mainline)));
      args.push('--', ...shas);
      return this.writeAllowingConflict(repo, 'cherryPick', args, { GIT_EDITOR: 'true' });
    });
    return {
      status,
      message: result.conflicted
        ? `The cherry-pick stopped on conflicts. Resolve them, stage the files, then continue.\n${result.message}`
        : result.message,
    };
  }

  async revert(
    repo: ResolvedRepo,
    body: { shas?: unknown; mainline?: unknown; noCommit?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const { result, status } = await this.mutate(repo, 'revert', async () => {
      const shas = await this.validShas(repo, body.shas);
      const args = ['-c', 'core.editor=true', 'revert', '--no-edit'];
      if (typeof body.mainline === 'number' && body.mainline > 0) args.push('-m', String(Math.floor(body.mainline)));
      if (body.noCommit === true) args.push('--no-commit');
      args.push('--', ...shas);
      return this.writeAllowingConflict(repo, 'revert', args, { GIT_EDITOR: 'true' });
    });
    return {
      status,
      message: result.conflicted
        ? `The revert stopped on conflicts. Resolve them, stage the files, then continue.\n${result.message}`
        : result.message,
    };
  }

  private async validShas(repo: ResolvedRepo, raw: unknown): Promise<string[]> {
    if (!Array.isArray(raw) || raw.length === 0) throw new GitBadInput('No commits were given.');
    if (raw.length > 100) throw new GitBadInput('That is too many commits for one go.');
    const out: string[] = [];
    for (const sha of raw) {
      if (typeof sha !== 'string' || !isValidSha(sha)) throw new GitBadInput('That is not a commit id.');
      const res = await runGit({
        cwd: repo.path,
        repoKey: repo.key,
        readOnly: true,
        label: 'verify-sha',
        expectFailure: true,
        args: ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`, '--'],
      });
      if (!res.ok) throw new GitBadInput(`There is no commit ${sha.slice(0, 7)} here.`);
      out.push(sha);
    }
    return out;
  }

  // ------------------------------------------------------------- stashes

  async stashPush(
    repo: ResolvedRepo,
    body: { message?: unknown; includeUntracked?: unknown; keepIndex?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const { result, status } = await this.mutate(repo, 'stash', async () => {
      const args = ['stash', 'push'];
      if (body.includeUntracked === true) args.push('--include-untracked');
      if (body.keepIndex === true) args.push('--keep-index');
      const text = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
      // The message goes after `-m`, and a message starting with a dash would
      // otherwise be read as a flag.
      if (text) args.push('-m', text);
      const res = await this.write(repo, 'stash', args);
      return res.stdout.trim() || 'Saved.';
    });
    return { status, message: result };
  }

  /**
   * `stash@{n}` is built here from a number, never taken as a string: a ref
   * arriving from a request is the one place an index could become something
   * else entirely.
   */
  private static stashRef(index: unknown): string {
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0 || n > 1_000) throw new GitBadInput('That is not a stash.');
    return `stash@{${n}}`;
  }

  async stashAction(
    repo: ResolvedRepo,
    action: 'apply' | 'pop' | 'drop',
    body: { index?: unknown; confirm?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    // Dropping is the only one that destroys: apply and pop put the work back
    // into the tree, and pop only removes the stash once it has landed.
    if (action === 'drop') GitService.requireConfirm(body.confirm, 'Dropping a stash');
    const op: GitOp = action === 'apply' ? 'stashApply' : action === 'pop' ? 'stashPop' : 'stashDrop';

    const { result, status } = await this.mutate(repo, op, async () => {
      const ref = GitService.stashRef(body.index);
      if (action === 'drop') {
        const res = await this.write(repo, op, ['stash', 'drop', '--', ref]);
        return { conflicted: false, message: res.stdout.trim() };
      }
      // Applying a stash can conflict exactly like a merge can.
      return this.writeAllowingConflict(repo, op, ['stash', action, '--', ref]);
    });
    return {
      status,
      message: result.conflicted
        ? `The stash came back with conflicts. Resolve them and stage the files.\n${result.message}`
        : result.message,
    };
  }

  // ------------------------------------------------------------- tags & worktrees

  async tagCreate(
    repo: ResolvedRepo,
    body: { name?: unknown; sha?: unknown; message?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const name = typeof body.name === 'string' ? body.name : '';
    const { status } = await this.mutate(repo, 'tagCreate', async () => {
      if (!isValidRefName(name)) throw new GitBadInput('That is not a valid tag name.');
      const args = ['tag'];
      const text = typeof body.message === 'string' ? body.message.trim() : '';
      // A message makes it an annotated tag, which is a different object.
      if (text) args.push('-a', '-m', text.slice(0, GIT_MESSAGE_MAX));
      args.push('--', name);
      if (typeof body.sha === 'string' && body.sha) {
        if (!isValidSha(body.sha)) throw new GitBadInput('That is not a commit id.');
        args.push(body.sha);
      }
      await this.write(repo, 'tagCreate', args);
    });
    return { status, message: `Created ${name}.` };
  }

  async tagDelete(
    repo: ResolvedRepo,
    body: { name?: unknown; confirm?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    GitService.requireConfirm(body.confirm, 'Deleting a tag');
    const name = typeof body.name === 'string' ? body.name : '';
    const { status } = await this.mutate(repo, 'tagDelete', async () => {
      await this.assertRef(repo, `refs/tags/${name}`);
      await this.write(repo, 'tagDelete', ['tag', '-d', '--', name]);
    });
    return { status, message: `Deleted ${name} locally. It may still be on a remote.` };
  }

  async worktreeAdd(
    repo: ResolvedRepo,
    body: { path?: unknown; ref?: unknown; create?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    const target = typeof body.path === 'string' ? body.path.trim().replace(/^"(.*)"$/, '$1') : '';
    const { status } = await this.mutate(repo, 'worktreeAdd', async () => {
      if (!path.isAbsolute(target)) throw new GitBadInput('Give an absolute path for the new worktree.');
      if (fs.existsSync(target)) throw new GitBadInput('Something is there already — give a path that does not exist.');
      const args = ['worktree', 'add'];
      if (body.create === true) {
        const name = typeof body.ref === 'string' ? body.ref : '';
        args.push('-b', await this.assertNewBranchName(repo, name), target);
      } else {
        args.push(target, await this.assertRef(repo, typeof body.ref === 'string' ? body.ref : ''));
      }
      await this.write(repo, 'worktreeAdd', args);
    });
    return { status, message: `Added a worktree at ${target}.` };
  }

  async worktreeRemove(
    repo: ResolvedRepo,
    body: { path?: unknown; force?: unknown; confirm?: unknown },
  ): Promise<{ status: GitStatus; message: string }> {
    GitService.requireConfirm(body.confirm, 'Removing a worktree');
    const target = typeof body.path === 'string' ? body.path : '';
    const { status } = await this.mutate(repo, 'worktreeRemove', async () => {
      // The path must be one git already lists, so this can never delete an
      // arbitrary folder.
      const known = await this.worktrees(repo);
      const match = known.find((w) => w.path.toLowerCase() === path.normalize(target).toLowerCase());
      if (!match) throw new GitBadInput('That is not one of this repository\'s worktrees.');
      if (match.isMain) throw new GitBadInput('That is the main working tree — it cannot be removed.');
      const args = ['worktree', 'remove'];
      if (body.force === true) args.push('--force');
      args.push('--', match.path);
      await this.write(repo, 'worktreeRemove', args);
    });
    return { status, message: `Removed the worktree at ${target}.` };
  }

  // ------------------------------------------------------------- the network

  /**
   * A remote must be one this repository actually has.
   *
   * That is not a formality: it is what makes "push to some URL of my choosing"
   * structurally impossible, so a page that got a body past the same-origin
   * check still cannot send anybody's code anywhere.
   */
  private async validRemote(repo: ResolvedRepo, name: unknown): Promise<string> {
    const known = await this.remotes(repo);
    if (known.length === 0) throw new GitBadInput('This repository has no remotes.');
    if (name === undefined || name === null || name === '') {
      return known.find((r) => r.name === 'origin')?.name ?? known[0].name;
    }
    if (typeof name !== 'string' || !known.some((r) => r.name === name)) {
      throw new GitBadInput(`This repository has no remote called ${String(name)}.`);
    }
    return name;
  }

  /** A network command: longer timeout, and cancellable by the caller going away. */
  private async network(
    repo: ResolvedRepo,
    op: GitOp,
    args: string[],
    signal?: AbortSignal,
  ): Promise<GitRunResult> {
    return runGit({
      cwd: repo.path,
      repoKey: repo.key,
      mutation: true,
      label: op,
      args,
      timeoutMs: GIT_NETWORK_TIMEOUT_MS,
      signal,
    });
  }

  /**
   * Update the remote-tracking refs. Never automatic — the app's network policy
   * allows exactly two background calls and this is not one of them.
   */
  async fetch(
    repo: ResolvedRepo,
    body: { remote?: unknown; all?: unknown; prune?: unknown },
    signal?: AbortSignal,
  ): Promise<{ status: GitStatus; message: string }> {
    const { result, status } = await this.mutate(repo, 'fetch', async () => {
      const args = ['fetch'];
      if (body.prune !== false) args.push('--prune');
      if (body.all === false) args.push(await this.validRemote(repo, body.remote));
      else args.push('--all');
      const res = await this.network(repo, 'fetch', args, signal);
      if (!res.ok) throw new GitFailed(res);
      // fetch says nothing when nothing moved, which IS the answer.
      return (res.stderr.trim() || res.stdout.trim() || 'Already up to date.').slice(0, 2_000);
    });
    return { status, message: result };
  }

  /**
   * Bring the upstream's commits in.
   *
   * `--ff-only` by default: the alternative silently writes a merge commit
   * nobody asked for, and the whole point of this tab is that nothing happens
   * to a repository without somebody choosing it. Rebase and merge are both
   * available, spelled out.
   */
  async pull(
    repo: ResolvedRepo,
    body: { rebase?: unknown; merge?: unknown },
    signal?: AbortSignal,
  ): Promise<{ status: GitStatus; message: string }> {
    const { result, status } = await this.mutate(repo, 'pull', async () => {
      const args = ['pull'];
      if (body.rebase === true) args.push('--rebase');
      else if (body.merge === true) args.push('--no-rebase', '--no-edit');
      else args.push('--ff-only');
      const res = await this.network(repo, 'pull', args, signal);
      const output = `${res.stdout}\n${res.stderr}`;
      if (res.ok) return { conflicted: false, message: (res.stdout.trim() || res.stderr.trim()).slice(0, 2_000) };
      if (/CONFLICT|Automatic merge failed|could not apply/i.test(output)) {
        return { conflicted: true, message: output.trim().slice(0, 2_000) };
      }
      // The one refusal worth translating: --ff-only saying the histories have
      // diverged is not an error, it is a decision waiting to be made.
      if (/Not possible to fast-forward|diverging|divergent/i.test(output)) {
        throw new GitBlocked(
          'Your branch and its upstream have both moved on, so this cannot be a fast-forward. ' +
            'Pull with rebase to replay your commits on top, or with merge to join them.',
        );
      }
      throw new GitFailed(res);
    });
    return {
      status,
      message: result.conflicted
        ? `The pull stopped on conflicts. Resolve them, stage the files, then continue.\n${result.message}`
        : result.message,
    };
  }

  /**
   * Send commits to a remote.
   *
   * There is no plain `--force` here and there never will be: `--force-with-lease`
   * refuses when the remote has moved since you last looked, which is the only
   * difference between overwriting your own mistake and overwriting somebody
   * else's work.
   */
  async push(
    repo: ResolvedRepo,
    body: {
      remote?: unknown;
      branch?: unknown;
      setUpstream?: unknown;
      forceWithLease?: unknown;
      delete?: unknown;
      tags?: unknown;
      confirm?: unknown;
    },
    signal?: AbortSignal,
  ): Promise<{ status: GitStatus; message: string }> {
    const force = body.forceWithLease === true;
    const remove = body.delete === true;
    if (force) GitService.requireConfirm(body.confirm, 'A force push');
    if (remove) GitService.requireConfirm(body.confirm, 'Deleting a branch on the remote');

    const op: GitOp = remove ? 'pushDelete' : force ? 'pushForce' : body.setUpstream === true ? 'pushUpstream' : 'push';
    const { result, status } = await this.mutate(repo, op, async (before) => {
      const remote = await this.validRemote(repo, body.remote);
      const branch = typeof body.branch === 'string' && body.branch ? body.branch : before.branch;
      if (!branch) throw new GitBadInput('HEAD is detached — there is no branch to push.');
      await this.assertRef(repo, remove ? branch : branch);

      const args = ['push', '--porcelain'];
      if (body.setUpstream === true) args.push('--set-upstream');
      if (force) args.push('--force-with-lease');
      if (remove) args.push('--delete');
      if (body.tags === true) args.push('--tags');
      args.push('--', remote, branch);

      const res = await this.network(repo, op, args, signal);
      if (!res.ok) throw new GitFailed(res);
      return (res.stdout.trim() || res.stderr.trim()).slice(0, 2_000);
    });
    return { status, message: result };
  }

  /** Publish one tag. Separate from a branch push: `--tags` sends all of them. */
  async pushTag(
    repo: ResolvedRepo,
    body: { name?: unknown; remote?: unknown },
    signal?: AbortSignal,
  ): Promise<{ status: GitStatus; message: string }> {
    const name = typeof body.name === 'string' ? body.name : '';
    const { result, status } = await this.mutate(repo, 'tagPush', async () => {
      const remote = await this.validRemote(repo, body.remote);
      if (!isValidRefName(name)) throw new GitBadInput('That is not a valid tag name.');
      await this.assertRef(repo, `refs/tags/${name}`);
      const res = await this.network(repo, 'tagPush', ['push', '--porcelain', '--', remote, `refs/tags/${name}`], signal);
      if (!res.ok) throw new GitFailed(res);
      return (res.stdout.trim() || res.stderr.trim()).slice(0, 2_000);
    });
    return { status, message: result };
  }

  /**
   * Continue, abort or skip whatever is in progress.
   *
   * The trap here is `core.editor=false` in BASE_FLAGS: `false` exits non-zero,
   * so a `--continue` that wants to open an editor fails with something nobody
   * can act on. Continuations put a working editor back — `true` accepts
   * whatever message is already there, which is what --no-edit would do anyway.
   */
  async continuation(repo: ResolvedRepo, action: 'continue' | 'abort' | 'skip'): Promise<{ status: GitStatus; message: string }> {
    const op: GitOp = action;
    const { result, status } = await this.mutate(repo, op, async (before) => {
      const kind = before.inProgress?.kind;
      if (!kind) throw new GitBadInput('Nothing is in progress.');
      const command =
        kind === 'merge'
          ? 'merge'
          : kind === 'cherry-pick'
            ? 'cherry-pick'
            : kind === 'revert'
              ? 'revert'
              : kind === 'am'
                ? 'am'
                : kind === 'bisect'
                  ? 'bisect'
                  : 'rebase';
      if (command === 'merge' && action !== 'abort') {
        throw new GitBadInput('A merge is finished by committing it, not by continuing.');
      }
      return this.writeAllowingConflict(
        repo,
        op,
        ['-c', 'core.editor=true', command, `--${action}`],
        { GIT_EDITOR: 'true' },
      );
    });
    return {
      status,
      message: result.conflicted
        ? `It stopped again on conflicts. Resolve them, stage the files, then continue.\n${result.message}`
        : result.message,
    };
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

  /**
   * Why `op` cannot run, given this status — or null.
   *
   * Deliberately NOT stricter than git. Blocking a checkout because some
   * unrelated file is modified would refuse an everyday, safe operation, and
   * when git does refuse it names the exact files, which is an answer we could
   * not produce. So the pre-checks here are only the rules git states outright:
   * a rebase with unstaged changes, a pull with no upstream, a commit with
   * nothing staged. Everything else is allowed to run and its refusal is
   * reported in git's own words.
   */
  blockedFor(repo: ResolvedRepo, op: GitOp, st: GitStatus): string | null {
    const base = this.baseBlockedReason(repo, op);
    if (base) return base;

    const conflicted = st.entries.filter((e) => e.conflicted).length;
    const staged = st.entries.filter((e) => e.staged && !e.conflicted).length;
    const dirty = st.entries.some((e) => !e.conflicted && (e.staged || e.unstaged === 'modified' || e.unstaged === 'deleted'));

    if (CONTINUATION_OPS.has(op)) {
      if (!st.inProgress) return 'Nothing is in progress.';
      if (op === 'continue') {
        if (!st.inProgress.canContinue) return `A ${st.inProgress.kind} is not continued that way.`;
        if (conflicted > 0) {
          return conflicted === 1
            ? '1 file is still conflicted — resolve it, then stage it.'
            : `${conflicted} files are still conflicted — resolve them, then stage them.`;
        }
      }
      if (op === 'skip' && !st.inProgress.canSkip) return `A ${st.inProgress.kind} has nothing to skip.`;
      return null;
    }

    // What must wait for the operation in flight to end. Staging and committing
    // are NOT on the list: staging is how a conflict is resolved, and a commit
    // is how a merge is concluded.
    if (st.inProgress && BLOCKED_WHILE_IN_PROGRESS.has(op)) {
      return `A ${st.inProgress.kind} is in progress — finish it or abort it first.`;
    }

    switch (op) {
      case 'commit':
        if (conflicted > 0) {
          return conflicted === 1
            ? '1 file is still conflicted — resolve it, then stage it.'
            : `${conflicted} files are still conflicted — resolve them, then stage them.`;
        }
        // Concluding a merge commits what git already staged, so an empty index
        // is only a problem outside one.
        if (staged === 0 && !st.inProgress) return 'Nothing is staged.';
        return null;

      case 'amend':
        if (conflicted > 0) return 'Resolve the conflicts first.';
        if (!st.headSha) return 'There is nothing to amend yet.';
        return null;

      case 'rebase':
        // git refuses this one outright, so saying it first costs nothing.
        if (dirty) return 'The working tree has changes — commit or stash them first.';
        return null;

      case 'pull':
        if (!st.branch) return 'HEAD is detached — check out a branch first.';
        if (!st.upstream) return 'This branch is not tracking anything yet.';
        return null;

      case 'push':
      case 'pushForce':
        if (!st.branch) return 'HEAD is detached — there is no branch to push.';
        if (!st.upstream) return 'This branch has no upstream yet — use "Push and set upstream".';
        return null;

      case 'pushUpstream':
        if (!st.branch) return 'HEAD is detached — there is no branch to push.';
        return null;

      case 'pushDelete':
        if (!st.upstream) return 'This branch is not on a remote.';
        return null;

      case 'stashApply':
      case 'stashPop':
      case 'stashDrop':
        if (st.stashCount === 0) return 'There are no stashes.';
        return null;

      case 'stash':
        if (!dirty && !st.entries.some((e) => e.unstaged === 'untracked')) return 'There is nothing to stash.';
        return null;

      default:
        return null;
    }
  }

  /** Every blocked operation, for the status payload. Only the blocked ones appear. */
  private blockedMap(repo: ResolvedRepo, st: GitStatus): Partial<Record<GitOp, string>> {
    const out: Partial<Record<GitOp, string>> = {};
    for (const op of REPORTED_OPS) {
      const reason = this.blockedFor(repo, op, st);
      if (reason) out[op] = reason;
    }
    return out;
  }
}

/** Re-exported so routes can build an id without importing the repo module. */
export { repoIdOf };
