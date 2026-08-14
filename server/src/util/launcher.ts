import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Strip Claude Code session markers from the child environment. If this
 * server was itself started from inside a Claude Code session, the resumed
 * CLI would inherit CLAUDE_CODE_CHILD_SESSION (& friends) and disable
 * transcript persistence ("Transcript saving is off"). CLAUDE_CONFIG_DIR is
 * intentionally preserved.
 */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_)/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

function trySpawn(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: cleanEnv() });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** PATH as a list of real directories: deduplicated, unquoted, in order. */
function pathDirs(): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!dir) continue;
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  return dirs;
}

/**
 * The name `dir` really holds for `file`, or null.
 *
 * The question is asked of the DIRECTORY, never of the file: app-execution
 * aliases (`%LOCALAPPDATA%\Microsoft\WindowsApps\*.exe` — Windows Terminal,
 * and a winget install of anything) are ACL-blocked for stat, so
 * `fs.existsSync` answers **false** for a file that lists fine, spawns fine and
 * is right there (verified: `statSync` → EACCES, `readdirSync` → present,
 * `spawn` → OK). A stat-based lookup silently skips exactly the executables
 * this app has to launch. It also returns the on-disk casing, which is what
 * ends up in the log and in the settings panel.
 */
export function dirEntry(dir: string, file: string): string | null {
  const target = file.toLowerCase();
  try {
    return fs.readdirSync(dir).find((name) => name.toLowerCase() === target) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve an executable by name the way PATH does, without leaving the process.
 *
 * NEVER shell out to `where.exe` for this. Console tools write their output in
 * the OEM console codepage and Node decodes it as UTF-8, so a path through a
 * non-ASCII profile comes back destroyed rather than merely misspelt:
 * `C:\Users\JavierAñón\...\claude.exe` arrives as `C:\Users\JavierA\uFFFD\uFFFDn\...`
 * (bytes A4 A2, cp850) and no amount of care downstream can recover the name —
 * spawning it fails with ENOENT. That cost a user the entire auto-reload
 * feature: the CLI was found, reported as found, shown as found, and could not
 * be launched. `process.env` carries no such damage (Node reads the environment
 * as UTF-16), so the search happens here.
 */
export function whichExe(name: string): string | null {
  const file = `${name}.exe`;
  for (const dir of pathDirs()) {
    const entry = dirEntry(dir, file);
    if (entry) return path.join(dir, entry);
  }
  return null;
}

/**
 * Windows Terminal is a Store app reachable only through app-execution
 * aliases under %LOCALAPPDATA%\Microsoft\WindowsApps (the packaged exe in
 * Program Files\WindowsApps is ACL-blocked, EPERM). Alias names vary by
 * package: `wt.exe` (standard Windows Terminal) or `wtai.exe`
 * (Microsoft.IntelligentTerminal — the "Terminal" app on this machine; its
 * `wtcli.exe` sibling is a HEADLESS bridge that opens no window — never use
 * it). Both accept the classic wt CLI (`-d <dir> <command...>`). PATH lookup
 * may miss the aliases, so check the alias dir directly too.
 */
let wtPath: string | null | undefined;
function findWt(): string | null {
  if (wtPath !== undefined) return wtPath;
  const aliasDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps')
    : null;
  wtPath = null;
  for (const name of ['wt', 'wtai']) {
    const fromPath = whichExe(name);
    if (fromPath) {
      wtPath = fromPath;
      break;
    }
    const entry = aliasDir ? dirEntry(aliasDir, `${name}.exe`) : null;
    if (entry && aliasDir) {
      wtPath = path.join(aliasDir, entry);
      break;
    }
  }
  return wtPath;
}

/**
 * Where a Claude Code install leaves the CLI when PATH has yet to hear about
 * it. This server is started by a scheduled task at logon, so `process.env.PATH`
 * is a snapshot of that moment: install Claude Code afterwards and no PATH
 * search can see it until the next logon — `where.exe` inherited the same stale
 * environment, so shelling out never helped either. The winget entries are not
 * hypothetical: that is how the user who hit this had installed it.
 */
function claudeFallbacks(): string[] {
  const out: string[] = [];
  const home = process.env.USERPROFILE;
  if (home) out.push(path.join(home, '.local', 'bin', 'claude.exe'));
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const winget = path.join(local, 'Microsoft', 'WinGet');
    out.push(path.join(winget, 'Links', 'claude.exe'));
    // A portable package sits one level deeper, in a folder carrying the source
    // hash (Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe).
    try {
      const packages = path.join(winget, 'Packages');
      for (const pkg of fs.readdirSync(packages)) {
        if (/^Anthropic\.ClaudeCode/i.test(pkg)) out.push(path.join(packages, pkg, 'claude.exe'));
      }
    } catch {
      // no winget here
    }
  }
  return out;
}

/**
 * Resolve the Claude Code CLI for a headless (`-p`) run. It is a real native
 * exe — no .cmd shim — so it can be spawned directly; PATH wins, then the known
 * install locations. A miss is NOT cached: the CLI may be installed while the
 * server is running.
 */
let claudeCliPath: string | null = null;
export function findClaudeCli(): string | null {
  if (claudeCliPath) return claudeCliPath;
  claudeCliPath =
    whichExe('claude') ??
    claudeFallbacks().find((p) => dirEntry(path.dirname(p), path.basename(p)) !== null) ??
    null;
  return claudeCliPath;
}

/**
 * Drop the cached path, so the next call looks again. For the one case a cache
 * cannot survive: a path that resolved and then failed to spawn. Whatever the
 * reason — the CLI moved, was uninstalled mid-session, or came back mangled by
 * some future encoding trap — repeating a launch that already answered ENOENT
 * is the one thing that cannot work.
 */
export function forgetClaudeCli(): void {
  claudeCliPath = null;
}

/**
 * Where Git for Windows leaves its CLI when PATH has yet to hear about it —
 * the same logon-snapshot problem as the Claude CLI above, and the same answer.
 *
 * `cmd\git.exe` rather than `bin\git.exe` or the mingw64 one: that is the
 * wrapper Git for Windows intends to be invoked programmatically.
 */
function gitFallbacks(): string[] {
  const out: string[] = [];
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (programFiles) out.push(path.join(programFiles, 'Git', 'cmd', 'git.exe'));
  if (programFilesX86) out.push(path.join(programFilesX86, 'Git', 'cmd', 'git.exe'));
  const local = process.env.LOCALAPPDATA;
  if (local) {
    out.push(path.join(local, 'Programs', 'Git', 'cmd', 'git.exe'));
    const winget = path.join(local, 'Microsoft', 'WinGet');
    out.push(path.join(winget, 'Links', 'git.exe'));
    try {
      const packages = path.join(winget, 'Packages');
      for (const pkg of fs.readdirSync(packages)) {
        if (/^Git\.Git/i.test(pkg)) out.push(path.join(packages, pkg, 'cmd', 'git.exe'));
      }
    } catch {
      // no winget here
    }
  }
  return out;
}

/**
 * Resolve the git CLI. PATH first, then the known install locations. Like the
 * Claude CLI, a HIT is remembered and a MISS never is: git may be installed
 * while this server is running, and PATH is frozen at logon for a server the
 * scheduled task started.
 */
let gitExePath: string | null = null;
export function findGitExe(): string | null {
  if (gitExePath) return gitExePath;
  gitExePath =
    whichExe('git') ??
    gitFallbacks().find((p) => dirEntry(path.dirname(p), path.basename(p)) !== null) ??
    null;
  return gitExePath;
}

/**
 * Drop the cached git path. For the one case a cache cannot survive: a path
 * that resolved and then answered ENOENT when spawned.
 */
export function forgetGitExe(): void {
  gitExePath = null;
}

/** Prefer PowerShell 7 (pwsh) — the user's default shell — over Windows PowerShell. */
let shellPath: string | undefined;
function findShell(): string {
  shellPath ??= whichExe('pwsh') ?? 'powershell';
  return shellPath;
}

/**
 * Open a terminal in `cwd` running `claude --resume <sessionId>`.
 * Preferred: Windows Terminal (wt) hosting pwsh. Fallback: a classic console
 * window hosting pwsh. `-NoExit` keeps the shell open after claude exits so
 * errors stay readable. Inputs are validated by the route (UUID +
 * index-owned cwd).
 */
/** Open Windows Explorer at the project folder. */
export async function openInExplorer(cwd: string): Promise<void> {
  await trySpawn('explorer.exe', [cwd]);
}

/** Open VS Code at the project folder (`code` is a .cmd shim — go through cmd). */
export async function openInVsCode(cwd: string): Promise<void> {
  await trySpawn('cmd', ['/c', 'code', cwd]);
}

/**
 * Open a terminal sitting in `cwd`, with nothing running in it.
 *
 * This is the git tab's escape hatch: conflicts are resolved outside the app,
 * and an authentication failure is answered by running the command once by
 * hand. Handing someone a shell already in the right folder is the difference
 * between a guide and a dead end.
 */
export async function launchShell(cwd: string): Promise<{ method: 'wt' | 'cmd' }> {
  const shell = findShell();
  const wt = findWt();
  if (wt) {
    try {
      await trySpawn(wt, ['-d', cwd, shell, '-NoExit']);
      return { method: 'wt' };
    } catch {
      // fall through to the plain console window
    }
  }
  await trySpawn('cmd', ['/c', 'start', 'Git', '/D', cwd, shell, '-NoExit']);
  return { method: 'cmd' };
}

export async function launchResume(cwd: string, sessionId: string): Promise<{ method: 'wt' | 'cmd'; command: string }> {
  const command = `claude --resume ${sessionId}`;
  const shell = findShell();
  const shellArgs = ['-NoExit', '-Command', command];
  const wt = findWt();
  if (wt) {
    try {
      await trySpawn(wt, ['-d', cwd, shell, ...shellArgs]);
      return { method: 'wt', command };
    } catch {
      // fall through to the plain console window
    }
  }
  await trySpawn('cmd', ['/c', 'start', 'Claude Code', '/D', cwd, shell, ...shellArgs]);
  return { method: 'cmd', command };
}
