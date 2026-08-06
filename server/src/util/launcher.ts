import { execFile, spawn } from 'node:child_process';

function trySpawn(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Windows Terminal is a Store app whose `wt.exe` is an app-execution alias
 * (reparse point) that Node's PATH lookup fails to spawn directly — resolve
 * the real path once via `where`.
 */
let wtPathPromise: Promise<string | null> | null = null;
function findWt(): Promise<string | null> {
  wtPathPromise ??= new Promise((resolve) => {
    execFile('where', ['wt'], (err, stdout) => {
      const first = stdout?.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('wt.exe'));
      resolve(err || !first ? null : first.trim());
    });
  });
  return wtPathPromise;
}

/**
 * Open a terminal in `cwd` running `claude --resume <sessionId>`.
 * Preferred: Windows Terminal (wt). Fallback: a classic cmd window.
 * `cmd /k` keeps the tab/window open after claude exits so errors stay
 * readable. Inputs are validated by the route (UUID + index-owned cwd).
 */
export async function launchResume(cwd: string, sessionId: string): Promise<{ method: 'wt' | 'cmd'; command: string }> {
  const command = `claude --resume ${sessionId}`;
  const wt = await findWt();
  if (wt) {
    try {
      await trySpawn(wt, ['-d', cwd, 'cmd', '/k', command]);
      return { method: 'wt', command };
    } catch {
      // fall through to the cmd fallback
    }
  }
  await trySpawn('cmd', ['/c', 'start', 'Claude Code', '/D', cwd, 'cmd', '/k', command]);
  return { method: 'cmd', command };
}
