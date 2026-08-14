import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { cleanEnv, findGitExe, forgetGitExe } from './launcher.ts';

/**
 * The one place a git process is ever started.
 *
 * Everything the GIT tab does comes through here — reads included — for two
 * reasons. The flags and the environment below are not optional extras: get one
 * of them wrong in one call site and that call site quietly misbehaves in a way
 * the others do not. And the command panel records from inside this function
 * rather than from its callers, so a command missing from the panel means the
 * runner was bypassed, which is exactly the thing the panel exists to make
 * visible.
 */

/**
 * Passed to every invocation, without exception.
 *
 * - `--no-pager` / `GIT_PAGER=cat`: a pager would wait for a keypress forever.
 * - `--literal-pathspecs`: a file genuinely called `foo[1].txt` is a file, not
 *   a glob. Without it that file can never be staged.
 * - `core.quotepath=false`: paths come back as raw UTF-8 instead of
 *   `acci\303\263n.txt` octal escapes.
 * - `color.ui=false`: a user with `color.ui=always` would feed ANSI escapes
 *   into every parser here.
 * - `i18n.logOutputEncoding=UTF-8`: messages arrive in the encoding we decode.
 * - `gc.auto=0`: reading a repository must never trigger a repack of it.
 * - the three credential/editor settings: see `gitEnv` — a prompt on a hidden
 *   server does not fail, it hangs forever holding the repository lock.
 */
export const BASE_FLAGS = [
  '--no-pager',
  '--literal-pathspecs',
  '-c',
  'core.quotepath=false',
  '-c',
  'color.ui=false',
  '-c',
  'i18n.logOutputEncoding=UTF-8',
  '-c',
  'advice.detachedHead=false',
  '-c',
  'gc.auto=0',
  '-c',
  'credential.interactive=false',
  '-c',
  'core.askPass=',
  '-c',
  'core.editor=false',
];

/**
 * Added to reads only: it stops a background `status` from taking `index.lock`
 * and losing a race with the git you have open in a terminal.
 */
const READ_ONLY_FLAGS = ['--no-optional-locks'];

/** Local commands. Long enough for a big `status`, short enough to catch a wedged hook. */
export const GIT_TIMEOUT_MS = 30_000;
/** Anything that talks to a remote. */
export const GIT_NETWORK_TIMEOUT_MS = 120_000;

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const STDERR_MAX_BYTES = 256_000;

/**
 * The environment every git process gets.
 *
 * A `git push` that needs credentials on a server running hidden under wscript
 * does not fail — it **hangs forever**, invisibly, holding the repository's
 * lock. Four separate doors have to be shut because each covers a case the
 * others do not:
 *
 *  - `GIT_TERMINAL_PROMPT=0` — git's own "Username for…" prompt.
 *  - `GIT_ASKPASS` / `core.askPass` — the askpass helper protocol.
 *  - `GCM_INTERACTIVE=Never` / `credential.interactive=false` — Git Credential
 *    Manager, which is the helper actually configured on this machine and whose
 *    prompt is a SEPARATE GUI process, so `windowsHide` does nothing to it.
 *  - `ssh -o BatchMode=yes` — the ssh transport, plus `SSH_ASKPASS_REQUIRE` and
 *    an empty `DISPLAY`, the classic way an askpass window appears anyway.
 *
 * The inherited `GIT_*` family is also removed: a `GIT_DIR` in the environment
 * silently retargets every command at whatever repository started this server,
 * which in development is this one.
 */
export function gitEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = cleanEnv();
  for (const key of Object.keys(env)) {
    if (/^(GIT_|GCM_)/i.test(key)) delete env[key];
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    DISPLAY: '',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10',
    GCM_INTERACTIVE: 'Never',
    GIT_PAGER: 'cat',
    GIT_FLUSH: '1',
    ...extra,
  };
}

export interface GitRunOptions {
  cwd: string;
  args: string[];
  /**
   * Fed on stdin. Commit messages and pathspec lists go here, never in argv:
   * it removes the command-line length limit and every quoting question at
   * once.
   */
  stdin?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** From the RESPONSE closing — see util/replyAbort.ts. */
  signal?: AbortSignal;
  /** Per-operation environment, e.g. GIT_EDITOR for a `--continue`. */
  env?: NodeJS.ProcessEnv;
  readOnly?: boolean;
  /** It changes the repository. Colours the panel and feeds the busy check. */
  mutation?: boolean;
  repoKey?: string | null;
  label?: string;
  /**
   * A non-zero exit is an ordinary answer here, not something worth a warning
   * in the daily log — `remote get-url origin` on a repository with no remote
   * is the case this exists for. The command panel still shows it in full: the
   * panel's promise is completeness, the log's is signal.
   */
  expectFailure?: boolean;
}

export interface GitRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
  /** The full argv as it ran, BASE_FLAGS included — what the panel shows. */
  argv: string[];
}

export type GitCommandSink = (result: GitRunResult, opts: GitRunOptions) => void;

let sink: GitCommandSink | null = null;

/** Installed by GitService. Recording lives here so no call site can forget it. */
export function setGitCommandSink(fn: GitCommandSink | null): void {
  sink = fn;
}

/** Thrown only when the process would not start. A non-zero exit is a result, not an error. */
export class GitSpawnError extends Error {}

/**
 * Strip anything that must never reach the command panel or the daily log.
 *
 * The realistic leak is a remote URL carrying a token — it appears in
 * `git remote -v` output and in a push's argv — so both the userinfo form and
 * the well-known token shapes go. Applied to argv, stdout, stderr and the stdin
 * preview, by the same function on both sides, so the panel and the log cannot
 * disagree about what was hidden.
 */
export function redact(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1***@')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g, '***');
}

/**
 * Run git and come back with what it said.
 *
 * Never rejects on a non-zero exit: several exit codes ARE the answer.
 * `diff --quiet` returns 1 for "there are changes", `merge` returns 1 for
 * "conflicts", `rev-parse --verify --quiet` returns 1 for "no such ref". Each
 * caller decides what its own codes mean. A rejection means the process could
 * not be started at all.
 */
export function runGit(opts: GitRunOptions): Promise<GitRunResult> {
  const exe = findGitExe();
  if (!exe) {
    return Promise.reject(new GitSpawnError('Git could not be found on this machine.'));
  }
  // A missing `cwd` makes Node report ENOENT for the EXECUTABLE, which is a lie
  // with consequences: taken at face value it condemns a perfectly good git.exe
  // and tells the user git is broken when what actually happened is that a
  // repository folder was deleted or renamed while the app had it open.
  if (!fs.existsSync(opts.cwd)) {
    return Promise.reject(new GitSpawnError(`That folder no longer exists: ${opts.cwd}`));
  }

  const argv = [...BASE_FLAGS, ...(opts.readOnly ? READ_ONLY_FLAGS : []), ...opts.args];
  const started = Date.now();
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  return new Promise((resolve, reject) => {
    const child = spawn(exe, argv, {
      cwd: opts.cwd,
      env: gitEnv(opts.env),
      windowsHide: true,
      stdio: [opts.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    // Buffers, decoded ONCE at the end. Decoding per chunk splits a multi-byte
    // sequence at the 64 KB boundary and destroys precisely the accented paths,
    // branch names and author names this output is full of.
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    // The optional chaining is only because `stdio` is computed above, so the
    // types cannot see that both pipes are always there.
    child.stdout?.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes <= maxBytes) out.push(chunk);
      else truncated = true;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes <= STDERR_MAX_BYTES) err.push(chunk);
    });

    // git spawns children of its own — git-remote-https, ssh, the credential
    // helper — so the tree goes, not just the pid.
    const killTree = (): void => {
      if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, opts.timeoutMs ?? GIT_TIMEOUT_MS);
    const onAbort = (): void => {
      aborted = true;
      killTree();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    };

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => {
        // git can exit before reading it all (a rejected pathspec list); the
        // exit code is the answer, a broken pipe is not.
      });
      child.stdin.end(Buffer.from(opts.stdin, 'utf8'));
    }

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Only now is the executable genuinely suspect — the cwd was checked
      // above. A path that resolved and then would not spawn must not stay
      // cached.
      forgetGitExe();
      reject(new GitSpawnError(`git could not be started: ${error.message}`));
    });

    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      const result: GitRunResult = {
        ok: exitCode === 0,
        exitCode,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        stdoutBytes: outBytes,
        truncated,
        timedOut,
        aborted,
        durationMs: Date.now() - started,
        argv,
      };
      try {
        sink?.(result, opts);
      } catch {
        // The panel must never be able to break a command that already ran.
      }
      resolve(result);
    });
  });
}

/**
 * The stderr shapes that mean "git wanted credentials and we would not let it
 * ask". They are answered with one sentence and a terminal, never with a retry:
 * nothing about running it again would make the prompt possible.
 */
const AUTH_PATTERNS =
  /could not read (Username|Password)|terminal prompts disabled|Authentication failed|Permission denied \(publickey\)|Host key verification failed|no supported authentication|could not read from remote repository/i;

export const GIT_AUTH_HINT =
  'Git needs credentials and this server has no way to ask you for them. ' +
  'Run the same command once in a terminal so the credential manager stores them, then try again.';

export function isAuthFailure(stderr: string): boolean {
  return AUTH_PATTERNS.test(stderr);
}

/** A push refused because the remote has moved on. */
export function isNonFastForward(stderr: string): boolean {
  return /non-fast-forward|stale info|fetch first|Updates were rejected/i.test(stderr);
}

/**
 * The one line worth showing from a failed command. git puts the useful
 * sentence last as often as first, so prefer a `fatal:`/`error:` line and fall
 * back to the final non-empty one.
 */
export function gitErrorLine(result: GitRunResult): string {
  const lines = result.stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    if (result.timedOut) return 'git did not finish in time and was stopped.';
    if (result.aborted) return 'The command was cancelled.';
    return `git exited with code ${result.exitCode}.`;
  }
  return lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines[lines.length - 1];
}
