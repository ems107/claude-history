import type { LogLevel } from '@claude-history/shared';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger, recordImported } from './logger.ts';

const log = createLogger('updates');

/**
 * Import the update helper's own log into ours.
 *
 * An update spans two processes: this server (download, verify, stage) and
 * `update-helper.ps1`, which runs AFTER we exit — it is the only one that can
 * report the junction swap, the restart, the health check and the rollback,
 * and it writes them to <install root>\update.log in its own PowerShell
 * format. Reading two files and lining up their clocks by hand is exactly the
 * kind of work a log is supposed to save, so the helper's lines are copied in
 * here, under `update-helper` and with their original timestamps.
 *
 * update.log stays the helper's source of truth (it is also what a failed
 * install has when the server never starts); this is a copy, not a move.
 */

/**
 * `2026-08-09 14:27:06  [warn] message` — local time, two spaces, ASCII
 * (PowerShell 5.1). The level tag is recent: lines written by older helpers
 * have none, so it is optional and `levelFor` covers them.
 */
const LINE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) {2}(?:\[(\w+)\] )?(.*)$/;

/**
 * The helper finishes AFTER the new server is up — its health check is what
 * waits for us — so a single pass at startup would always miss the ending,
 * including the rollback lines that matter most. Sweep for a while instead.
 */
const PASSES_MS = [0, 10_000, 30_000, 60_000, 120_000, 300_000];

/** A hand-edited or runaway file must not be replayed line by line into ours. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface ImportMarker {
  /** Lines already copied, counted from the top of the file. */
  lines: number;
  /** Size when we last looked — equal means nothing was appended. */
  size: number;
  /**
   * First line of the file we counted against. update.log is only ever
   * appended to, so a different opening line means a different file (the
   * uninstaller deletes it, and a person may too) and the count is worthless.
   * Size alone cannot tell: a replacement that is already longer than what we
   * had would silently skip its first lines.
   */
  firstLine?: string;
}

/** Levels a helper may tag a line with; anything else falls back to the words. */
const TAGGED: Record<string, LogLevel> = { debug: 'debug', info: 'info', warn: 'warn', error: 'error', fatal: 'error' };

/** Untagged lines (older helpers) say what went wrong in words — read those. */
function levelFor(message: string): LogLevel {
  const m = message.toLowerCase();
  if (m.startsWith('fatal') || m.includes('did not answer') || m.includes('rolling back') || m.includes('rollback')) {
    return 'error';
  }
  if (m.includes('still alive') || m.includes('killing') || m.includes('could not')) return 'warn';
  return 'info';
}

function readMarker(file: string): ImportMarker {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ImportMarker>;
    if (typeof parsed.lines === 'number' && typeof parsed.size === 'number') {
      return { lines: parsed.lines, size: parsed.size, firstLine: parsed.firstLine };
    }
  } catch {
    // No marker yet, or an unreadable one: start from the top.
  }
  return { lines: 0, size: 0 };
}

/** Enough of the first line to identify the file, short enough to store. */
const fingerprint = (line: string | undefined): string => (line ?? '').slice(0, 120);

function importOnce(updateLog: string, markerFile: string): void {
  const stat = fs.statSync(updateLog); // throws when there is no update.log yet
  const marker = readMarker(markerFile);
  // Same size AND same opening line: nothing happened since the last pass.
  // (A replacement that lands on exactly the same size is not worth a read of
  // the whole file on every pass; the next appended line settles it.)
  if (stat.size === marker.size) return;
  if (stat.size > MAX_FILE_BYTES) {
    log.warn(`update.log is ${Math.round(stat.size / 1024)} KB — too big to import, read it directly at ${updateLog}`);
    fs.writeFileSync(markerFile, JSON.stringify({ lines: Number.MAX_SAFE_INTEGER, size: stat.size }));
    return;
  }

  const lines = fs.readFileSync(updateLog, 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
  const head = fingerprint(lines[0]);
  // A replaced file (different opening line, or simply shorter) starts over:
  // carrying the old count forward would hide however many lines it names.
  const replaced = stat.size < marker.size || (marker.firstLine !== undefined && marker.firstLine !== head);
  const already = replaced ? 0 : marker.lines;
  if (replaced && marker.lines > 0) log.debug('update.log was replaced — importing it from the top');
  let imported = 0;
  for (const line of lines.slice(already)) {
    const m = LINE_RE.exec(line);
    if (!m) {
      recordImported('update-helper', 'warn', line, new Date());
      imported++;
      continue;
    }
    const [, y, mo, d, h, mi, s, tag, message] = m;
    const when = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    const level = (tag ? TAGGED[tag.toLowerCase()] : undefined) ?? levelFor(message);
    recordImported('update-helper', level, message, when);
    imported++;
  }
  fs.writeFileSync(
    markerFile,
    JSON.stringify({ lines: lines.length, size: stat.size, firstLine: head } satisfies ImportMarker),
  );
  if (imported > 0) log.info(`imported ${imported} line${imported === 1 ? '' : 's'} from ${updateLog}`);
}

/**
 * Start the import passes. Silent and harmless when there is no managed
 * install, no update.log, or nothing new in it.
 */
export function startUpdateLogImport(installRoot: string | null, cacheDir: string): void {
  if (!installRoot) return;
  const updateLog = path.join(installRoot, 'update.log');
  const markerFile = path.join(cacheDir, 'update-log-import.json');
  const pass = () => {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      importOnce(updateLog, markerFile);
    } catch (err) {
      // Missing update.log is the normal case on a machine that never updated.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.debug(`could not import update.log: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  for (const delay of PASSES_MS) setTimeout(pass, delay).unref();
}
