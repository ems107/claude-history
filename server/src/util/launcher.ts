import { type SpawnOptions, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../core/logger.ts';

const log = createLogger('launcher');

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

function trySpawn(cmd: string, args: string[], opts?: SpawnOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: cleanEnv(), ...opts });
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
function dirEntry(dir: string, file: string): string | null {
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
 * Open one file with whatever Windows associates with it.
 *
 * Explorer is the launcher here rather than `cmd /c start`: it needs no shell,
 * no empty-title argument, and it is already how this app opens a folder.
 */
export async function openFile(file: string): Promise<void> {
  await trySpawn('explorer.exe', [file]);
}

/**
 * Explorer at the file's folder, with the file selected. Answers whether it
 * really selected it: false means the `/select` launch failed and the plain
 * folder was opened instead, and the UI must not claim otherwise.
 *
 * `/select,<path>` has to reach Explorer as ONE argument with the switch
 * OUTSIDE the quotes, and Node quotes any argument containing a space — which
 * turns `/select,C:\a b\c.ts` into `"/select,C:\a b\c.ts"`, an argument Explorer
 * does not recognise at all, so it opens Documents and looks like a bug in us.
 * `windowsVerbatimArguments` is the only way to write that command line
 * ourselves; the quotes around the path are added here on purpose. (The same
 * trap is documented in routes/retention.ts, which sidesteps it by opening the
 * folder — this is the version that does not have to.)
 */
export async function revealInExplorer(file: string): Promise<boolean> {
  try {
    await trySpawn('explorer.exe', [`/select,"${file}"`], { windowsVerbatimArguments: true });
    return true;
  } catch {
    await openInExplorer(path.dirname(file));
    return false;
  }
}

/**
 * VS Code at a file, on a line (`code` is a .cmd shim — go through cmd).
 * `-g` is what makes `path:line` a position rather than a filename.
 */
export async function openFileInVsCode(file: string, line?: number): Promise<void> {
  await trySpawn('cmd', ['/c', 'code', '-g', line ? `${file}:${line}` : file]);
}

/**
 * How long the folder dialog may stay open before it is abandoned.
 *
 * Generous, because the thing at the other end is a person browsing a disk, and
 * a dialog closed under their hand is worse than a request that waited. It is a
 * backstop against a dialog nobody will ever answer — the page having been
 * closed, say — not a pace this is meant to keep.
 */
const PICK_FOLDER_TIMEOUT_MS = 5 * 60_000;

/** One dialog at a time: a second would open behind the first and be invisible. */
let picking = false;

/**
 * The folder browser, as a script rather than a `-Command` one-liner.
 *
 * Written to a temp `.ps1` and run with `-File`, and that is not a style
 * preference: joined into one line with `;` separators, this same code reached
 * neither `ShowDialog` nor an error — the process simply sat there with no
 * window and no output, and the request hung until the timeout. As a file every
 * statement ran first time. One line of PowerShell is a parser to be argued
 * with; a file is not.
 *
 * Everything variable travels as an environment variable — `CH_PICK_DIR` in,
 * `CH_PICK_OUT` out — so a folder containing a quote or a `$` can never become
 * part of the script.
 */
const PICK_FOLDER_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
# GetWindow(owner, GW_ENABLEDPOPUP) names the dialog exactly: no title to match,
# no guess about which process owns it.
Add-Type -Name Win -Namespace ChPick -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);'

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose the folder for the new Claude Code session'
$dialog.ShowNewFolderButton = $true
if ($env:CH_PICK_DIR) { try { $dialog.SelectedPath = $env:CH_PICK_DIR } catch {} }

# 1x1, fully transparent, off the taskbar, at the centre of the working area —
# the dialog centres itself on its owner, so an off-screen owner would take it
# off screen with it.
$global:chOwner = New-Object System.Windows.Forms.Form
$global:chOwner.FormBorderStyle = 'None'
$global:chOwner.StartPosition = 'Manual'
$global:chOwner.ShowInTaskbar = $false
$global:chOwner.Opacity = 0
$global:chOwner.TopMost = $true
$global:chOwner.Width = 1
$global:chOwner.Height = 1
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$global:chOwner.Left = [int]($area.X + $area.Width / 2)
$global:chOwner.Top = [int]($area.Y + $area.Height / 2)
$global:chOwner.Show()
$global:chOwner.Activate()

# ShowDialog pumps messages, so this keeps ticking underneath it — which is the
# only moment the dialog's own window exists to be raised.
#
# The '-ne $own' test is the whole correctness of this: GW_ENABLEDPOPUP does NOT
# answer NULL when there is no popup yet, it answers the window you asked about.
# Without the test the first tick "found" the 1x1 owner, raised THAT, stopped the
# timer, and the real dialog was born afterwards with nobody left to lift it —
# which is why this looked like it worked whenever .NET happened to be warm
# enough to have the dialog up inside 200 ms, and did nothing otherwise.
#
# SWP_NOACTIVATE is in the flags because activation is the one thing a background
# process may not do; z-order is all that is being asked for here.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.add_Tick({
  $own = $global:chOwner.Handle
  $popup = [ChPick.Win]::GetWindow($own, 6)
  if ($popup -ne [IntPtr]::Zero -and $popup -ne $own) {
    $this.Stop()
    [void][ChPick.Win]::SetWindowPos($popup, [IntPtr](-1), 0, 0, 0, 0, 0x0013)
  }
})
$timer.Start()

$picked = $dialog.ShowDialog($global:chOwner)
$timer.Stop()
$timer.Dispose()
$global:chOwner.Close()
if ($picked -eq [System.Windows.Forms.DialogResult]::OK) {
  [System.IO.File]::WriteAllText($env:CH_PICK_OUT, $dialog.SelectedPath, (New-Object System.Text.UTF8Encoding $false))
}
$global:chOwner.Dispose()
# The last statement, and not a formality: this process holding a shown WinForms
# window has been observed outliving the closed dialog, and while it lives the
# server's lock stays set and every later click is refused — a button answering
# "already open" about a window nobody can see.
[System.Environment]::Exit(0)
`;

/**
 * The Windows folder browser, on the server's own desktop. Resolves to the
 * chosen path, or null if it was cancelled.
 *
 * **The answer comes back through a FILE, never through stdout.** A console
 * child writes in the OEM codepage and Node decodes it as UTF-8, which does not
 * merely misspell a path through a non-ASCII profile — it destroys it (the trap
 * documented on `whichExe`, which cost a user the whole auto-reload feature).
 * PowerShell writes UTF-8 bytes to a temp file and we read them here, so the
 * console encoding never enters into it. The two inputs travel as environment
 * variables for the same reason quoting is avoided everywhere else: a path with
 * a quote or a `$` in it must not be able to become part of the script.
 *
 * `-STA` is not optional — WinForms needs a single-threaded apartment and pwsh
 * does not start in one.
 *
 * **The dialog has to be raised after it exists, and an owner cannot do it for
 * you.** A dialog opened by a background process cannot take the foreground —
 * that belongs to whatever the user last clicked, which is the browser — so the
 * only thing that puts it where it can be seen is z-order. A topmost owner is
 * not enough: Windows propagates `WS_EX_TOPMOST` to the windows an owner ALREADY
 * has at the moment it becomes topmost, not to ones created afterwards, and the
 * dialog is always created afterwards. Measured both ways — with an unshown
 * owner and with a shown topmost one, `#32770 "Select Folder"` came up
 * `visible=True topmost=False`, behind the browser, invisible to the person who
 * asked for it and hanging the request until it was found by hand.
 *
 * So a `Timer` started before `ShowDialog` — which pumps messages, so it keeps
 * ticking underneath — finds the dialog through `GetWindow(owner,
 * GW_ENABLEDPOPUP)` (exact: no title to match, no guess about the process) and
 * calls `SetWindowPos(HWND_TOPMOST)` on it. That needs no foreground rights,
 * which is the whole point. The owner is still shown and still topmost, 1×1 and
 * fully transparent at the centre of the working area, because the dialog
 * centres itself on its owner and an off-screen owner takes it off screen too.
 * **Read the `-ne $own` test in the script before touching that timer** — it is
 * the difference between raising the dialog and raising the invisible owner, and
 * it only shows up on a cold start.
 *
 * `findShell()` prefers pwsh, which matters here beyond taste: on .NET the
 * dialog is the modern one, while Windows PowerShell 5.1 draws the old
 * tree-view. Both work; only one looks like this decade.
 */
export async function pickFolder(initial?: string): Promise<string | null> {
  // Says what to do about it: the dialog is on that desktop and is the only
  // thing that can release this, so "already open" alone would be a dead end.
  if (picking) {
    throw new Error('A folder browser is already open on that machine — finish or close it first.');
  }
  picking = true;
  const out = path.join(os.tmpdir(), `claude-history-pick-${randomUUID()}.txt`);
  const scriptFile = `${out}.ps1`;

  let stderr = '';
  try {
    // Inside the try, so the `finally` below always gets to release `picking`.
    // Outside it, an unwritable temp dir would lock this for the life of the
    // process — the same shape of bug as a host outliving its dialog.
    fs.writeFileSync(scriptFile, PICK_FOLDER_SCRIPT, 'utf8');
    await new Promise<void>((resolve, reject) => {
      // stderr is captured and nothing else is: a script that cannot run writes
      // no file, which is indistinguishable from Cancel, and the whole failure
      // would otherwise be a button that quietly does nothing.
      const child = spawn(findShell(), ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        env: { ...cleanEnv(), CH_PICK_OUT: out, CH_PICK_DIR: initial ?? '' },
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('The folder browser was left open and has been closed.'));
      }, PICK_FOLDER_TIMEOUT_MS);
      timer.unref();
      child.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    // No file means Cancel — unless the script said why it could not run, and
    // then it never got as far as a dialog, so "cancelled" would be a lie. Asked
    // of the filesystem rather than caught as ENOENT: that code also comes from
    // an unwritable temp dir, and answering "cancelled" to THAT is how a broken
    // button becomes a silent one.
    if (!fs.existsSync(out)) {
      const said = stderr.trim();
      if (!said) return null;
      log.warn(`the folder browser failed: ${said.slice(0, 500)}`);
      throw new Error(`The folder browser could not be opened: ${said.split('\n')[0].slice(0, 200)}`);
    }
    return fs.readFileSync(out, 'utf8').trim() || null;
  } finally {
    picking = false;
    for (const file of [out, scriptFile]) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // nothing to clean up
      }
    }
  }
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
