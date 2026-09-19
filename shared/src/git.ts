/**
 * The GIT tab's contract: what the server reads out of a repository and what
 * the browser is allowed to ask it to do.
 *
 * The whole set lands at once, mutation bodies included, even though the
 * operations arrive over several phases — a shape that changes under a UI that
 * is already drawing it costs more than the lines it saves.
 */

// ---------------------------------------------------------------- repositories

/**
 * A repository the app knows about.
 *
 * `id` is the ONLY thing that travels in a URL or a request body: it is a hash,
 * so it cannot carry a `/`, a `..`, a drive letter or a `-` that git would read
 * as a flag. The path is looked up from it server-side, which is what keeps the
 * rule that a repository path never comes from the client — the same rule
 * `/api/sessions/:id/resume` follows for a session's cwd.
 */
export interface GitRepo {
  id: string;
  /** The work tree's top level, in the casing the filesystem reports. */
  path: string;
  name: string;
  /**
   * How the app came to know it. `scan` is a root you configured, `project` is
   * a folder Claude Code has run in, `manual` is a path you typed. A repo found
   * more than one way keeps every origin — it is not the same thing as being
   * found once, and removing it has to mean something different.
   */
  origins: GitRepoOrigin[];
  /** Projects of this app whose sessions live inside this repository. */
  projectKeys: string[];
  /**
   * Other repos here that share this one's remote — your `_0`/`_1` clones.
   * They are SEPARATE entries with separate working trees; this only lets the
   * picker group them visually. Merging them would make status meaningless.
   */
  siblings: string[];
  remoteUrl: string | null;
  currentBranch: string | null;
  bare: boolean;
  hidden: boolean;
  /** Set when the folder went away or git cannot read it. */
  error: string | null;
}

export type GitRepoOrigin = 'project' | 'scan' | 'manual';

export interface GitRepoRoot {
  path: string;
  addedAt: string;
  /** Repos found under it on the last scan — 0 is worth showing. */
  found: number;
  error: string | null;
}

export interface GitOverview {
  available: boolean;
  gitPath: string | null;
  gitVersion: string | null;
  repos: GitRepo[];
  scanRoots: GitRepoRoot[];
  /** Manually added paths, including any that no longer resolve. */
  manual: GitRepoRoot[];
  scannedAt: string | null;
  /** Non-null when git itself could not be found or run at all. */
  error: string | null;
}

export interface GitAddRepoRequest {
  path: string;
  /** A folder to scan for repositories rather than a repository itself. */
  asRoot?: boolean;
}

// ---------------------------------------------------------------- status

export type GitEntryState =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'ignored';

export interface GitFileEntry {
  path: string;
  /** Where a rename or copy came from. */
  origPath: string | null;
  /** The raw porcelain XY pair, kept so the panel can show what git actually said. */
  x: string;
  y: string;
  /** X resolved: what is staged for the next commit. */
  staged: GitEntryState | null;
  /** Y resolved: what the working tree has on top of that. */
  unstaged: GitEntryState | null;
  conflicted: boolean;
  /**
   * The unmerged case in plain words — "both modified", "deleted by them".
   * Resolved on the server so the UI never has to re-derive the DD/AU/UD table.
   */
  conflictKind: string | null;
  submodule: boolean;
}

/**
 * No `rebase-interactive`: git's own `rebase-merge/interactive` marker is
 * written for every rebase since the merge backend became the default, so it
 * cannot tell one apart, and guessing would be worse than not saying.
 */
export type GitInProgressKind = 'merge' | 'rebase' | 'am' | 'cherry-pick' | 'revert' | 'bisect';

/**
 * A multi-step operation the repository is sitting in the middle of. Detected
 * from the gitdir (MERGE_HEAD, rebase-merge/, CHERRY_PICK_HEAD…), never by
 * reading git's English.
 */
export interface GitInProgress {
  kind: GitInProgressKind;
  step: number | null;
  total: number | null;
  /** The branch being replayed, when there is one. */
  headName: string | null;
  ontoSha: string | null;
  canContinue: boolean;
  canAbort: boolean;
  canSkip: boolean;
}

export interface GitStatus {
  repoId: string;
  /** Null when HEAD is detached. */
  branch: string | null;
  detachedAt: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  headSha: string | null;
  headSubject: string | null;
  entries: GitFileEntry[];
  /**
   * The working tree has more changes than the cap, and `entries` is a prefix.
   * A trimmed answer must never read like a complete one.
   */
  truncated: boolean;
  inProgress: GitInProgress | null;
  stashCount: number;
  /**
   * Why each operation cannot run right now, one string per blocked operation.
   * The UI disables the control by its key and shows this text; the endpoint
   * recomputes the same map and refuses with the identical string. One reason,
   * two consumers — a disabled control that cannot say why is the bug.
   */
  blocked: Partial<Record<GitOp, string>>;
  readAt: string;
  /**
   * These figures came from cache because the repository was busy. A read never
   * queues behind a two-minute fetch, and it never discards what it had.
   */
  stale: boolean;
}

// ---------------------------------------------------------------- refs

export interface GitBranch {
  name: string;
  fullRef: string;
  sha: string;
  current: boolean;
  upstream: string | null;
  /** The upstream is configured but no longer exists on the remote. */
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  lastCommitAt: string | null;
  lastSubject: string | null;
  /** Checked out in a linked worktree, so it cannot be checked out here. */
  worktreePath: string | null;
}

export interface GitRemoteBranch {
  name: string;
  remote: string;
  fullRef: string;
  sha: string;
  lastCommitAt: string | null;
  /** No local branch tracks it and none shares its name. */
  localMissing: boolean;
}

export interface GitBranchesResponse {
  current: string | null;
  detached: boolean;
  local: GitBranch[];
  remote: GitRemoteBranch[];
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitTag {
  name: string;
  sha: string;
  annotated: boolean;
  subject: string | null;
  at: string | null;
}

export interface GitStash {
  index: number;
  ref: string;
  sha: string;
  message: string;
  /** The branch it was taken on, when the message still says so. */
  branch: string | null;
  at: string;
}

export interface GitWorktree {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  isMain: boolean;
}

// ---------------------------------------------------------------- commits

export type GitRefKind = 'head' | 'branch' | 'remote' | 'tag';

export interface GitRef {
  kind: GitRefKind;
  name: string;
  fullRef: string;
  /** HEAD points at this ref. */
  isHead: boolean;
}

/**
 * One row of the graph. `parents` IS the graph — everything else is text beside
 * it. Lane assignment happens in the browser, over the pages loaded so far: it
 * depends on the viewport, it has to re-run whenever a page is appended, and
 * doing it here would mean holding per-viewer layout state on the server.
 */
export interface GitCommit {
  sha: string;
  shortSha: string;
  parents: string[];
  refs: GitRef[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
  subject: string;
}

export interface GitLogResponse {
  commits: GitCommit[];
  hasMore: boolean;
  offset: number;
}

export interface GitCommitFile {
  path: string;
  origPath: string | null;
  /** A, M, D, R, C, T — git's own letter. */
  status: string;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface GitCommitDetail {
  commit: GitCommit;
  /** The message below the subject line, empty when there is none. */
  body: string;
  committerName: string;
  committerEmail: string;
  files: GitCommitFile[];
  additions: number;
  deletions: number;
  /** More files than the cap; `files` is a prefix. */
  truncated: boolean;
}

// ---------------------------------------------------------------- diffs

export type GitDiffLineKind = 'ctx' | 'add' | 'del' | 'meta' | 'conflict';

export interface GitDiffLine {
  kind: GitDiffLineKind;
  /** Null on an added line. */
  oldNo: number | null;
  /** Null on a removed line. */
  newNo: number | null;
  text: string;
}

export interface GitHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Unchanged lines hidden before this hunk, for the "⋮ N lines" strip. */
  gapBefore: number;
  lines: GitDiffLine[];
}

export interface GitFileDiff {
  path: string;
  origPath: string | null;
  status: string;
  binary: boolean;
  additions: number;
  deletions: number;
  /** Past the size cap: no hunks, and the UI must say so rather than show nothing. */
  tooLarge: boolean;
  hunks: GitHunk[];
}

export type GitDiffMode = 'worktree' | 'staged' | 'commit' | 'range' | 'conflict';

export interface GitDiffResponse {
  mode: GitDiffMode;
  files: GitFileDiff[];
  truncated: boolean;
}

/**
 * A copy kept before something was discarded.
 *
 * Discarding is the only thing this tab does that git cannot undo — the content
 * was in the working file and nowhere else. So the bytes are kept for a few
 * days and this is how they are offered back.
 */
export interface GitDiscardEntry {
  id: string;
  at: string;
  /** What was thrown away, in the words the user saw: "3 lines of src/app.ts". */
  what: string;
  files: { path: string; bytes: number; missing: boolean }[];
}

/** The three sides of a conflicted file, for the guide. */
export interface GitConflictSides {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** Either side is binary or past the cap. */
  tooLarge: boolean;
}

// ---------------------------------------------------------------- command panel

/**
 * One git invocation, exactly as it ran.
 *
 * Every command goes through the server's single runner, and the runner records
 * here unconditionally — not the call sites, which can forget. A command missing
 * from this panel therefore means the runner was bypassed, and that is the whole
 * point of having it.
 */
export interface GitCommandLogEntry {
  seq: number;
  at: string;
  repoId: string | null;
  repoName: string | null;
  /** The full argv, `-c` flags included, with credentials redacted. */
  argv: string[];
  cwd: string;
  /** First bytes of anything fed on stdin (a commit message, a pathspec list). */
  stdinPreview: string | null;
  /**
   * It is still going. A field of its own rather than `exitCode === null`,
   * because those are two different facts: a process killed by a signal also
   * comes back with a null code, and reading one as the other would have
   * drawn a command that was stopped as a command still running.
   *
   * An entry is written when the process is SPAWNED and filled in when it
   * closes, keeping its `seq` — which is the whole reason a two-minute fetch
   * is visible in this panel while it is happening rather than after it.
   */
  running: boolean;
  /** What the command was for — `status`, `log`, `branches`, `fetch`. */
  label: string | null;
  /**
   * A non-zero exit is an ordinary answer for this one.
   *
   * `remote get-url origin` on a repository without an `origin` exits 2, and
   * the app asks it of every repository it finds. Drawn as failures those
   * probes were most of what a filtered panel showed — seven red rows saying
   * nothing went wrong. The daily log has always made this distinction
   * (`expectFailure` logs at debug); the panel had no word for it.
   */
  expected: boolean;
  exitCode: number | null;
  durationMs: number;
  /** It changed the repository, as opposed to reading it. */
  mutation: boolean;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  /** Output was longer than what is kept here. */
  truncated: boolean;
}

export interface GitCommandLogResponse {
  entries: GitCommandLogEntry[];
  newestSeq: number;
  /** Entries the ring dropped before `since` — "42 not shown" beats silence. */
  dropped: number;
}

// ---------------------------------------------------------------- operations

export type GitOp =
  | 'read'
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'amend'
  | 'checkout'
  | 'branchCreate'
  | 'branchDelete'
  | 'branchRename'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'pushUpstream'
  | 'pushDelete'
  | 'pushForce'
  | 'merge'
  | 'rebase'
  | 'cherryPick'
  | 'revert'
  | 'reset'
  | 'stash'
  | 'stashApply'
  | 'stashPop'
  | 'stashDrop'
  | 'tagCreate'
  | 'tagDelete'
  | 'tagPush'
  | 'worktreeAdd'
  | 'worktreeRemove'
  | 'continue'
  | 'abort'
  | 'skip';

/** Every mutation answers with the freshly re-read status, so the UI cannot draw a stale one. */
export interface GitMutationResponse {
  ok: true;
  status: GitStatus;
  /** What git printed, when it is worth showing (a push's summary, a merge's report). */
  message?: string;
  /** Set when something was discarded: the copy that can put it back. */
  undoId?: string | null;
}

export interface GitPathsRequest {
  paths: string[];
  confirm?: boolean;
}

export interface GitCommitRequest {
  message: string;
  amend?: boolean;
  /** Skip the repository's own hooks. Explicit only — it shows up in the panel. */
  noVerify?: boolean;
  confirm?: boolean;
}

export interface GitCheckoutRequest {
  ref: string;
  /** Create it first, starting from `from` (or HEAD). */
  create?: boolean;
  from?: string;
}

export interface GitBranchCreateRequest {
  name: string;
  from?: string;
  checkout?: boolean;
}

export interface GitBranchDeleteRequest {
  name: string;
  /** `-D`: delete it even though it is not merged. Needs `confirm`. */
  force?: boolean;
  confirm?: boolean;
}

export interface GitBranchRenameRequest {
  from: string;
  to: string;
}

/**
 * The variants of the four operations that have more than one sensible answer.
 *
 * Each one is a whole git command rather than a flag, because that is the unit
 * the user chooses in: a button's main click runs the one named in the
 * settings, and its dropdown offers the rest. The lists live here so the
 * settings validation, the server's fallback and the menu labels cannot drift
 * apart — and the ORDER matters twice: it is the order the menu shows, and the
 * FIRST entry is the shipped default that an unknown stored value falls back
 * to.
 */
export const GIT_FETCH_MODES = ['all-prune', 'all', 'current'] as const;
export type GitFetchMode = (typeof GIT_FETCH_MODES)[number];

export const GIT_PULL_MODES = ['ff-only', 'rebase', 'merge'] as const;
export type GitPullMode = (typeof GIT_PULL_MODES)[number];

export const GIT_MERGE_MODES = ['ff', 'no-ff', 'squash'] as const;
export type GitMergeMode = (typeof GIT_MERGE_MODES)[number];

/**
 * Push is the odd one out: its variants are not one command each but a flow.
 * `push` sends the current branch straight away (setting the upstream when
 * there is none to set, which is the only thing that could stop it); `dialog`
 * opens the options window every time. Force and deleting a remote branch are
 * NOT here on purpose — they exist in the dropdown, behind their confirmation,
 * and nothing destructive may become what a button does by default.
 */
export const GIT_PUSH_MODES = ['push', 'dialog'] as const;
export type GitPushMode = (typeof GIT_PUSH_MODES)[number];

/**
 * What each mode IS, said once: the command in its plain form, and one clause
 * about the trade it makes.
 *
 * Here rather than in the settings page because two screens say it — the `▾`
 * beside every one of these buttons, and the row in Settings that picks what
 * the main click does — and the first time those two disagreed about what
 * `--ff-only` means, one of them would be lying.
 *
 * The toolbar's own menu resolves these against the repository open at the time
 * (`git fetch --prune origin`, `git push --set-upstream origin my-branch`),
 * which is a different and more useful fact in that place. This is the form
 * that is true of every repository, which is the only form a SETTING can have.
 */
export interface GitModeLabel {
  command: string;
  gist: string;
}

export const GIT_FETCH_LABELS: Record<GitFetchMode, GitModeLabel> = {
  'all-prune': { command: 'git fetch --prune --all', gist: 'every remote, and drop the branches somebody deleted' },
  all: { command: 'git fetch --all', gist: 'every remote, keeping stale branches for ever' },
  current: { command: 'git fetch --prune <remote>', gist: "only this branch's remote" },
};

export const GIT_PULL_LABELS: Record<GitPullMode, GitModeLabel> = {
  'ff-only': { command: 'git pull --ff-only', gist: 'refuse rather than invent a merge commit' },
  rebase: { command: 'git pull --rebase', gist: 'replay my commits on top of theirs' },
  merge: { command: 'git pull --no-rebase', gist: 'join the two with a merge commit' },
};

export const GIT_MERGE_LABELS: Record<GitMergeMode, GitModeLabel> = {
  ff: { command: 'git merge', gist: 'fast-forward where it can' },
  'no-ff': { command: 'git merge --no-ff', gist: 'always leave a merge commit' },
  squash: { command: 'git merge --squash', gist: 'stage the result and commit nothing' },
};

export const GIT_PUSH_LABELS: Record<GitPushMode, GitModeLabel> = {
  push: { command: 'git push', gist: 'send it, setting the upstream where there is none' },
  dialog: { command: '(the options window)', gist: 'ask every time, with the command shown' },
};

export interface GitFetchRequest {
  remote?: string;
  /** Omitted means "whatever the settings say" — the setting is the default, not the UI. */
  mode?: GitFetchMode;
  /**
   * Also `--prune-tags --tags`: bring every tag the remote has, and DELETE
   * every local tag it does not.
   *
   * Deliberately not a `GitFetchMode`. That list is what the settings choose
   * from, and this one deletes local objects — including a tag made here and
   * never pushed — so it lives where force pushing and deleting a remote
   * branch live: an entry in the menu, behind its own confirmation, and
   * impossible to make the thing a button does by default.
   */
  pruneTags?: boolean;
  confirm?: boolean;
}

export interface GitPullRequest {
  /**
   * `ff-only` refuses rather than inventing a commit, `rebase` replays your
   * commits on top of theirs, `merge` joins the histories. Omitted means
   * whatever the settings say.
   */
  mode?: GitPullMode;
}

export interface GitPushRequest {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  /** Never a bare `--force`. Needs `confirm`. */
  forceWithLease?: boolean;
  /** Delete the branch on the remote. Needs `confirm`. */
  delete?: boolean;
  tags?: boolean;
  confirm?: boolean;
}

export interface GitMergeRequest {
  ref: string;
  /**
   * `ff` lets git fast-forward when it can, `no-ff` always leaves a merge
   * commit, `squash` stages the result without committing. Omitted means
   * whatever the settings say.
   */
  mode?: GitMergeMode;
  message?: string;
}

export interface GitRebaseRequest {
  onto: string;
}

export interface GitCherryPickRequest {
  shas: string[];
  /** A merge commit needs a mainline; 1 is the usual answer. */
  mainline?: number;
}

export interface GitRevertRequest {
  shas: string[];
  mainline?: number;
  noCommit?: boolean;
}

export type GitResetMode = 'soft' | 'mixed' | 'hard';

export interface GitResetRequest {
  sha: string;
  mode: GitResetMode;
  confirm?: boolean;
}

export interface GitStashRequest {
  message?: string;
  includeUntracked?: boolean;
  keepIndex?: boolean;
}

export interface GitStashActionRequest {
  index: number;
  confirm?: boolean;
}

export interface GitTagCreateRequest {
  name: string;
  sha?: string;
  /** Annotated when present. */
  message?: string;
}

export interface GitTagDeleteRequest {
  name: string;
  confirm?: boolean;
}

export interface GitTagPushRequest {
  name: string;
  remote?: string;
}

export interface GitWorktreeAddRequest {
  path: string;
  ref: string;
  create?: boolean;
}

export interface GitWorktreeRemoveRequest {
  path: string;
  force?: boolean;
  confirm?: boolean;
}

export type GitOpenTarget = 'explorer' | 'vscode' | 'terminal';

export interface GitOpenRequest {
  target: GitOpenTarget;
}

// ---------------------------------------------------------------- limits

/** A commit message longer than this is not a commit message. */
export const GIT_MESSAGE_MAX = 20_000;

/**
 * Working-tree entries returned at once. A repo with an untracked node_modules
 * can produce tens of thousands; past this the list is a prefix and says so.
 */
export const GIT_STATUS_MAX_ENTRIES = 5_000;

/** Commits per page of the graph. Measured: 200 rows read in ~64 ms at 5,000 commits. */
export const GIT_LOG_PAGE = 200;

/** Diff lines kept for one file before it is reported as too large to show. */
export const GIT_DIFF_MAX_LINES = 20_000;

/** Files in one diff response. Past this the list is a prefix and says so. */
export const GIT_DIFF_MAX_FILES = 500;

/** Files listed for one commit. A generated-code commit can touch thousands. */
export const GIT_COMMIT_MAX_FILES = 2_000;

/** How deep a scan root is walked looking for repositories. */
export const GIT_SCAN_DEPTH = 2;

/** Directories a scan never descends into. Dotted names are NOT skipped — `.claude-history` is a repo. */
export const GIT_SCAN_SKIP_DIRS = [
  'node_modules',
  '.git',
  'bin',
  'obj',
  'dist',
  'packages',
  'vendor',
  'target',
  '.vs',
  '.venv',
] as const;

/** Repositories a single scan may return. */
export const GIT_SCAN_MAX_REPOS = 200;

/**
 * A branch whose name alone is reason to ask twice before a force push. Not a
 * permission system — a speed bump on the names that usually mean "shared".
 */
export const GIT_PROTECTED_BRANCHES = [/^main$/, /^master$/, /^dev$/, /^develop$/, /^release\//] as const;

export function isProtectedBranch(name: string): boolean {
  return GIT_PROTECTED_BRANCHES.some((re) => re.test(name));
}

/**
 * Is this safe to hand to git as a ref?
 *
 * The rule that matters most is the leading `-`: a ref starting with a dash is
 * read as a flag, which is argument injection with extra steps. The rest is
 * git's own ref-name grammar, checked here so an obviously bad name never costs
 * a spawn. A name that must ALREADY exist is checked against the repository as
 * well; a NEW branch name goes through `git check-ref-format`, which is the
 * authoritative answer.
 */
export function isValidRefName(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name.startsWith('-')) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) return false;
  if (name.endsWith('.') || name.endsWith('.lock')) return false;
  if (name.includes('..') || name.includes('@{')) return false;
  // Control characters, space, and every character git lists as forbidden.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  return true;
}

/** A commit-ish the client may name: a hex sha, nothing else. */
export function isValidSha(sha: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(sha);
}
