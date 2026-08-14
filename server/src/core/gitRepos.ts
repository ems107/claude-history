import {
  GIT_SCAN_DEPTH,
  GIT_SCAN_MAX_REPOS,
  GIT_SCAN_SKIP_DIRS,
  type GitRepo,
  type GitRepoOrigin,
} from '@claude-history/shared';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dirEntry } from '../util/launcher.ts';
import { runGit } from '../util/git.ts';
import { normalizeProjectKey } from './projects.ts';

/**
 * Finding the repositories the GIT tab can work on, and deciding what counts as
 * one repository.
 *
 * The identity rule is the load-bearing one: a repository IS its work tree's
 * top level, never its remote. Ten clones of the same project share one
 * `origin` on this machine, and keying on the URL would fold ten independent
 * working trees into a single entry — status, staging and checkout would all
 * become meaningless. They stay ten entries that know about each other.
 */

/** A path the user asked us to remember, as stored in userdata.json. */
export interface GitStoredPath {
  path: string;
  addedAt: string;
}

/** A repository resolved on disk. The server-side shape; `toApi` trims it for the wire. */
export interface ResolvedRepo {
  /** normalizeProjectKey(topLevel) — the identity, and the map key. */
  key: string;
  /** sha1 of the key. The ONLY thing that travels in a URL or a request body. */
  id: string;
  path: string;
  name: string;
  gitDir: string;
  bare: boolean;
  origins: Set<GitRepoOrigin>;
  projectKeys: string[];
  remoteUrl: string | null;
  /** Normalized remote, for grouping sibling clones. */
  remoteKey: string | null;
  currentBranch: string | null;
  hidden: boolean;
  error: string | null;
}

/**
 * The id a repository is addressed by.
 *
 * Opaque on purpose: it cannot contain a slash, a `..`, a drive letter or a
 * leading `-` that git would read as a flag, so a request naming one can never
 * become a path or an argument. The path is looked up from it server-side,
 * which is how the "never take a path from the client" rule is enforced
 * structurally rather than by validation.
 */
export function repoIdOf(repoKey: string): string {
  return crypto.createHash('sha1').update(repoKey).digest('hex').slice(0, 12);
}

/** Remotes compared for sibling grouping: case- and suffix-insensitive, credentials dropped. */
function remoteKeyOf(url: string | null): string | null {
  if (!url) return null;
  return url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/@]*@/i, (m) => m.replace(/\/\/[^/@]*@/, '//'))
    .replace(/\.git$/i, '')
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

interface Candidate {
  path: string;
  origin: GitRepoOrigin;
  projectKey: string | null;
}

/**
 * Walk a scan root looking for work trees.
 *
 * Two levels deep by default, and a directory holding a `.git` is NOT descended
 * into: its subdirectories are part of it, not repositories of their own. The
 * skip list is about cost — a `node_modules` can hide hundreds of vendored
 * repos nobody means to manage. Dotted directories are deliberately NOT
 * skipped: `.claude-history` is itself a repository.
 */
export function scanRootForRepos(root: string, limit = GIT_SCAN_MAX_REPOS): string[] {
  const skip = new Set<string>(GIT_SCAN_SKIP_DIRS.map((d) => d.toLowerCase()));
  const found: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (found.length >= limit) return;
    // `.git` can be a directory or a file (a linked worktree, a submodule), and
    // the question goes to the directory rather than to the file — the same
    // rule the executable lookup follows.
    if (dirEntry(dir, '.git')) {
      found.push(dir);
      return;
    }
    if (depth <= 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder: not an error worth reporting per directory
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skip.has(entry.name.toLowerCase())) continue;
      walk(path.join(dir, entry.name), depth - 1);
      if (found.length >= limit) return;
    }
  };

  walk(root, GIT_SCAN_DEPTH);
  return found;
}

/** What git says about a folder. Null when it is not a work tree at all. */
async function probe(dir: string): Promise<{
  top: string;
  gitDir: string;
  bare: boolean;
  branch: string | null;
} | null> {
  const res = await runGit({
    cwd: dir,
    args: ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--is-bare-repository', '--abbrev-ref', 'HEAD'],
    readOnly: true,
    timeoutMs: 10_000,
    label: 'probe',
  });
  if (!res.ok) return null;
  const lines = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const [top, gitDir, bare, head] = lines;
  return {
    // rev-parse answers with forward slashes on Windows; everything downstream
    // compares paths, so normalise here and only here.
    top: path.normalize(top),
    gitDir: path.normalize(gitDir),
    bare: bare === 'true',
    // A repository with no commits answers HEAD, and a detached one answers the sha.
    branch: !head || head === 'HEAD' ? null : head,
  };
}

async function remoteOf(dir: string): Promise<string | null> {
  const res = await runGit({
    cwd: dir,
    args: ['remote', 'get-url', 'origin'],
    readOnly: true,
    timeoutMs: 10_000,
    label: 'remote',
  });
  return res.ok ? (res.stdout.trim() || null) : null;
}

/** Run `work` over `items`, `limit` at a time. Fifty repos serially is a second of nothing. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface DiscoverInput {
  /** Project paths the app already knows, from session cwds. */
  projects: { key: string; path: string }[];
  scanRoots: GitStoredPath[];
  manual: GitStoredPath[];
  /** Repo keys the user hid. They stay resolved, just flagged. */
  hidden: Set<string>;
}

export interface DiscoverResult {
  repos: ResolvedRepo[];
  /** Repos found under each scan root, by root path — the count the UI shows. */
  rootCounts: Map<string, number>;
  rootErrors: Map<string, string>;
  /** Repo key -> ids of the other clones of the same remote. */
  siblings: Map<string, string[]>;
}

/**
 * Resolve every source into one deduplicated list.
 *
 * Several projects can live inside one repository (this app's own sessions run
 * in subfolders of it), so they collapse into a single entry that remembers all
 * of them. A project whose key starts with `encoded:` is skipped outright: that
 * is a lossy directory name Claude Code left behind, not a path.
 */
export async function discoverRepos(input: DiscoverInput): Promise<DiscoverResult> {
  const candidates: Candidate[] = [];
  const rootCounts = new Map<string, number>();
  const rootErrors = new Map<string, string>();

  for (const project of input.projects) {
    if (project.key.startsWith('encoded:')) continue;
    candidates.push({ path: project.path, origin: 'project', projectKey: project.key });
  }

  for (const root of input.scanRoots) {
    try {
      if (!fs.statSync(root.path).isDirectory()) {
        rootErrors.set(root.path, 'Not a folder.');
        rootCounts.set(root.path, 0);
        continue;
      }
    } catch {
      rootErrors.set(root.path, 'That folder no longer exists.');
      rootCounts.set(root.path, 0);
      continue;
    }
    const found = scanRootForRepos(root.path);
    rootCounts.set(root.path, found.length);
    for (const dir of found) candidates.push({ path: dir, origin: 'scan', projectKey: null });
  }

  for (const entry of input.manual) {
    candidates.push({ path: entry.path, origin: 'manual', projectKey: null });
  }

  // Cheap pre-dedupe on the raw paths, so ten candidates pointing at one folder
  // do not each cost two spawns.
  const byRawPath = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const k = normalizeProjectKey(c.path);
    const list = byRawPath.get(k);
    if (list) list.push(c);
    else byRawPath.set(k, [c]);
  }

  const probed = await pool([...byRawPath.entries()], 8, async ([, group]) => {
    const probe1 = await probe(group[0].path);
    return { group, probe: probe1 };
  });

  const repos = new Map<string, ResolvedRepo>();
  for (const { group, probe: info } of probed) {
    if (!info) continue; // not a work tree — a scratch folder, a deleted project
    const key = normalizeProjectKey(info.top);
    let repo = repos.get(key);
    if (!repo) {
      repo = {
        key,
        id: repoIdOf(key),
        path: info.top,
        name: path.basename(info.top) || info.top,
        gitDir: info.gitDir,
        bare: info.bare,
        origins: new Set<GitRepoOrigin>(),
        projectKeys: [],
        remoteUrl: null,
        remoteKey: null,
        currentBranch: info.branch,
        hidden: input.hidden.has(key),
        error: null,
      };
      repos.set(key, repo);
    }
    for (const c of group) {
      repo.origins.add(c.origin);
      if (c.projectKey && !repo.projectKeys.includes(c.projectKey)) repo.projectKeys.push(c.projectKey);
    }
  }

  const list = [...repos.values()];
  const remotes = await pool(list, 8, (repo) => remoteOf(repo.path));
  list.forEach((repo, i) => {
    repo.remoteUrl = remotes[i];
    repo.remoteKey = remoteKeyOf(remotes[i]);
  });

  // Sibling clones: same remote, different work tree. Grouping only — they are
  // never merged, which is the point.
  const byRemote = new Map<string, ResolvedRepo[]>();
  for (const repo of list) {
    if (!repo.remoteKey) continue;
    const group = byRemote.get(repo.remoteKey);
    if (group) group.push(repo);
    else byRemote.set(repo.remoteKey, [repo]);
  }

  const siblingsOf = new Map<string, string[]>();
  for (const group of byRemote.values()) {
    if (group.length < 2) continue;
    for (const repo of group) {
      siblingsOf.set(
        repo.key,
        group.filter((other) => other.key !== repo.key).map((other) => other.id),
      );
    }
  }

  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path));
  return { repos: list, rootCounts, rootErrors, siblings: siblingsOf };
}

/** The wire shape. `siblings` comes from the service, which holds the grouping. */
export function toApiRepo(repo: ResolvedRepo, siblings: string[]): GitRepo {
  return {
    id: repo.id,
    path: repo.path,
    name: repo.name,
    origins: [...repo.origins],
    projectKeys: repo.projectKeys,
    siblings,
    remoteUrl: repo.remoteUrl,
    currentBranch: repo.currentBranch,
    bare: repo.bare,
    hidden: repo.hidden,
    error: repo.error,
  };
}

export interface PathCheck {
  ok: boolean;
  /** The resolved top level for a repository, or the folder itself for a root. */
  path: string;
  error: string | null;
}

/**
 * Validate a path the user typed.
 *
 * Windows' "Copy as path" wraps the path in quotes, which is why they are
 * stripped here as they already are for the auto-reload folder. A repository
 * resolves to its TOP LEVEL before being stored: typing a path to some folder
 * deep inside a checkout should add the checkout, not that folder.
 */
export async function checkPath(input: string, asRoot: boolean): Promise<PathCheck> {
  const raw = input.trim().replace(/^"(.*)"$/, '$1');
  if (!raw) return { ok: false, path: raw, error: 'Give a path.' };
  if (!path.isAbsolute(raw)) return { ok: false, path: raw, error: 'Give an absolute path.' };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(raw);
  } catch {
    return { ok: false, path: raw, error: 'That folder does not exist.' };
  }
  if (!stat.isDirectory()) return { ok: false, path: raw, error: 'That is a file, not a folder.' };

  const normalized = path.normalize(raw).replace(/[\\/]+$/, '');
  if (asRoot) return { ok: true, path: normalized, error: null };

  const info = await probe(normalized);
  if (!info) return { ok: false, path: normalized, error: 'That folder is not inside a git repository.' };
  return { ok: true, path: info.top, error: null };
}
