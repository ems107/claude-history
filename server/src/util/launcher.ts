import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Strip Claude Code session markers from the child environment. If this
 * server was itself started from inside a Claude Code session, the resumed
 * CLI would inherit CLAUDE_CODE_CHILD_SESSION (& friends) and disable
 * transcript persistence ("Transcript saving is off"). CLAUDE_CONFIG_DIR is
 * intentionally preserved.
 */
function cleanEnv(): NodeJS.ProcessEnv {
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

function whereFirst(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('where', [name], (err, stdout) => {
      const first = stdout?.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith(`${name}.exe`));
      resolve(err || !first ? null : first.trim());
    });
  });
}

/**
 * Windows Terminal is a Store app whose `wt.exe` is an app-execution alias
 * (reparse point) that Node's PATH lookup fails to spawn directly — resolve
 * the real path via `where`, falling back to the well-known alias location
 * (the server's inherited PATH may lack WindowsApps).
 */
let wtPathPromise: Promise<string | null> | null = null;
function findWt(): Promise<string | null> {
  wtPathPromise ??= (async () => {
    const fromPath = await whereFirst('wt');
    if (fromPath) return fromPath;
    const alias = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe')
      : null;
    return alias && fs.existsSync(alias) ? alias : null;
  })();
  return wtPathPromise;
}

/** Prefer PowerShell 7 (pwsh) — the user's default shell — over Windows PowerShell. */
let shellPromise: Promise<string> | null = null;
function findShell(): Promise<string> {
  shellPromise ??= whereFirst('pwsh').then((p) => p ?? 'powershell');
  return shellPromise;
}

/**
 * Open a terminal in `cwd` running `claude --resume <sessionId>`.
 * Preferred: Windows Terminal (wt) hosting pwsh. Fallback: a classic console
 * window hosting pwsh. `-NoExit` keeps the shell open after claude exits so
 * errors stay readable. Inputs are validated by the route (UUID +
 * index-owned cwd).
 */
export async function launchResume(cwd: string, sessionId: string): Promise<{ method: 'wt' | 'cmd'; command: string }> {
  const command = `claude --resume ${sessionId}`;
  const shell = await findShell();
  const shellArgs = ['-NoExit', '-Command', command];
  const wt = await findWt();
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
