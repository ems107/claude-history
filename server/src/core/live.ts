import fsp from 'node:fs/promises';
import path from 'node:path';
import type { LiveSessionEntry } from '@claude-history/shared';
import { num, str } from './jsonl.ts';

/**
 * Exported because the cached list goes stale in one direction that matters: a
 * CLI killed outright leaves its file behind, and nothing writes to the
 * directory again, so no watcher event ever comes to drop it. Anything making
 * a decision on that list has to re-ask at the moment it decides.
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission to signal it.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Currently-running Claude Code processes from ~/.claude/sessions/<pid>.json.
 * Files can outlive crashed processes, so pid liveness is verified.
 */
export async function readLiveSessions(sessionsDir: string): Promise<LiveSessionEntry[]> {
  let files: string[];
  try {
    files = await fsp.readdir(sessionsDir);
  } catch {
    return [];
  }
  const out: LiveSessionEntry[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(sessionsDir, f), 'utf8')) as Record<string, unknown>;
      const pid = num(raw.pid);
      const sessionId = str(raw.sessionId);
      if (pid === null || !sessionId || !pidAlive(pid)) continue;
      out.push({
        pid,
        sessionId,
        cwd: str(raw.cwd) ?? '',
        status: str(raw.status) ?? 'unknown',
        // Written only while a dialog is up, which is exactly when it is worth
        // having: it is the only thing on disk that says WHY a session stopped.
        waitingFor: str(raw.waitingFor),
        name: str(raw.name),
        startedAt: num(raw.startedAt),
        updatedAt: num(raw.updatedAt),
        statusUpdatedAt: num(raw.statusUpdatedAt),
        // Not on disk: the index fills it from its own memory of the flips
        // (`refreshLive`), which is the only place turns can be told apart.
        busySince: null,
        entrypoint: str(raw.entrypoint),
      });
    } catch {
      // unreadable/corrupt session file — ignore
    }
  }
  return out;
}
