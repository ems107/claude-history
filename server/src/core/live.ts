import fsp from 'node:fs/promises';
import path from 'node:path';
import type { LiveSessionEntry } from '@claude-history/shared';
import { powershell } from '../util/elevate.ts';
import { num, str } from './jsonl.ts';
import { createLogger } from './logger.ts';

const log = createLogger('live');

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
 * A pid file names its CLI by the pid AND by the moment that process started,
 * and only the pair is the CLI. Windows hands a freed pid to whatever starts
 * next — after a crash, and to everything at once after a reboot — so a file
 * left behind by a CLI that never cleaned up passes `pidAlive` for as long as
 * some unrelated program holds its number: the session shows LIVE, and the
 * guard refuses to open it. `procStart` is that process's creation time as a
 * FILETIME, written by the CLI for exactly this. Its own list skips a record
 * whose pid started at another moment, but leaves the file on disk (2.1.312
 * calls it `"recycled"`), so the file is still there for us to read.
 *
 * Asking Windows costs a PowerShell launch — about 650 ms, for any number of
 * pids at once — so each pid is asked once per `procStart`, and the answer is
 * kept only while that pid is alive in every read: one seen dead may come back
 * as another program, and its file is asked about afresh when it does.
 */
interface StartCheck {
  procStart: string;
  /** Null when Windows could not say: the pid is trusted, as it was before, and asked again later. */
  same: boolean | null;
  at: number;
}

const startChecks = new Map<number, StartCheck>();
let checking: Promise<void> | null = null;

const CHECK_TIMEOUT_MS = 5_000;
const RETRY_UNKNOWN_MS = 60_000;
/**
 * A FILETIME counts 100 ns from 1601 and stays under this until 2551. Above it
 * is .NET's `DateTime.Ticks`, counted from year 1 in LOCAL time, which the CLI
 * writes when it had to ask PowerShell itself — not comparable, so the CLI
 * trusts such a record, and so do we.
 */
const FILETIME_LIMIT = 300_000_000_000_000_000;
/**
 * WMI keeps microseconds and the CLI the full 100 ns, so the same start reads
 * a fraction of a microsecond apart; a recycled pid started after its CLI died,
 * which is seconds later at the very least. One millisecond, in 100 ns units.
 */
const SAME_START = 10_000;

function comparableStart(v: unknown): string | null {
  return typeof v === 'string' && /^\d{1,20}$/.test(v) && Number(v) < FILETIME_LIMIT ? v : null;
}

async function checkStarts(records: ReadonlyArray<{ pid: number; procStart: string }>): Promise<void> {
  if (process.platform !== 'win32') return;
  // One question in flight at a time: a busy CLI rewrites its file constantly,
  // and every one of those reads would otherwise launch its own PowerShell.
  while (checking) await checking;
  const now = Date.now();
  const todo = records.filter((r) => {
    const c = startChecks.get(r.pid);
    return !c || c.procStart !== r.procStart || (c.same === null && now - c.at >= RETRY_UNKNOWN_MS);
  });
  if (todo.length === 0) return;
  checking = askStarts(todo).finally(() => {
    checking = null;
  });
  await checking;
}

async function askStarts(todo: ReadonlyArray<{ pid: number; procStart: string }>): Promise<void> {
  // Win32_Process rather than Get-Process: WMI answers for an elevated CLI too,
  // where `StartTime` is access denied to a process that is not.
  const filter = todo.map((r) => `ProcessId=${r.pid}`).join(' OR ');
  const script = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId) $($_.CreationDate.ToFileTimeUtc())" }`;
  const started = new Map<number, number>();
  try {
    const { stdout } = await powershell(script, CHECK_TIMEOUT_MS);
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^(\d+) (\d+)$/.exec(line.trim());
      if (m) started.set(Number(m[1]), Number(m[2]));
    }
  } catch (err) {
    log.warn('could not ask Windows when the running CLIs started — their pids are trusted', err);
  }
  const at = Date.now();
  for (const r of todo) {
    const real = started.get(r.pid);
    const same = real === undefined ? null : Math.abs(real - Number(r.procStart)) < SAME_START;
    startChecks.set(r.pid, { procStart: r.procStart, same, at });
    if (same === false) log.info(`pid ${r.pid} is another program now — its session file is left over, not live`);
  }
}

/**
 * Currently-running Claude Code processes from ~/.claude/sessions/<pid>.json.
 * Files can outlive crashed processes, so pid liveness is verified — and so is
 * the pid still being the same process (`StartCheck` above).
 *
 * `previous` is what the last read returned, and it is what an unreadable file
 * falls back to. A busy CLI rewrites its own status file constantly, and this
 * runs off a watcher event on the very write that is still in flight: catching
 * one half-written is not an edge case, it is the normal shape of the race. A
 * `catch` that drops the entry says the process is GONE — the row loses its
 * LIVE and WORKING badges outright, and gets them back on the next event — so
 * a file we merely failed to read keeps the last thing it said, as long as the
 * pid behind it is still alive. Nothing here waits or retries: the next write
 * is milliseconds away, and it is the one that will be read cleanly.
 */
export async function readLiveSessions(
  sessionsDir: string,
  previous: readonly LiveSessionEntry[] = [],
): Promise<LiveSessionEntry[]> {
  let files: string[];
  try {
    files = await fsp.readdir(sessionsDir);
  } catch {
    return [];
  }
  const before = new Map(previous.map((l) => [l.pid, l]));
  const found: Array<{ entry: LiveSessionEntry; procStart: string | null }> = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await fsp.readFile(path.join(sessionsDir, f), 'utf8')) as Record<string, unknown>;
    } catch {
      // The file is named after the pid, which is the only thing left to
      // identify it by when its contents cannot be read. What the last read
      // returned had already passed the start check.
      const kept = before.get(Number(f.slice(0, -'.json'.length)));
      if (kept && pidAlive(kept.pid)) found.push({ entry: { ...kept, busySince: null }, procStart: null });
      continue;
    }
    const pid = num(raw.pid);
    const sessionId = str(raw.sessionId);
    if (pid === null || !sessionId || !pidAlive(pid)) continue;
    found.push({
      entry: {
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
      },
      procStart: comparableStart(raw.procStart),
    });
  }
  await checkStarts(found.flatMap((f) => (f.procStart ? [{ pid: f.entry.pid, procStart: f.procStart }] : [])));
  const alive = new Set(found.map((f) => f.entry.pid));
  for (const pid of startChecks.keys()) if (!alive.has(pid)) startChecks.delete(pid);
  return found.filter((f) => f.procStart === null || startChecks.get(f.entry.pid)?.same !== false).map((f) => f.entry);
}
