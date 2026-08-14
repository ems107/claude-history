import {
  GIT_LOG_PAGE,
  GIT_STATUS_MAX_ENTRIES,
  isValidRefName,
  type GitBranchesResponse,
  type GitCommandLogEntry,
  type GitCommandLogResponse,
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
  redact,
  runGit,
  setGitCommandSink,
  type GitRunOptions,
  type GitRunResult,
} from '../util/git.ts';
import { findGitExe } from '../util/launcher.ts';
import {
  BRANCH_FORMAT,
  LOG_FORMAT,
  REMOTE_BRANCH_FORMAT,
  STASH_FORMAT,
  TAG_FORMAT,
  parseLocalBranches,
  parseLogRecords,
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
      return make(exists('rebase-merge', 'interactive') ? 'rebase-interactive' : 'rebase', {
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
      // An empty repository has no HEAD to walk, which is not a failure.
      if (/does not have any commits yet|unknown revision/i.test(res.stderr)) {
        return { commits: [], hasMore: false, offset };
      }
      throw new GitFailed(res);
    }

    const all = parseLogRecords(res.stdout);
    const hasMore = all.length > limit;
    return { commits: hasMore ? all.slice(0, limit) : all, hasMore, offset };
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
