import fs from 'node:fs';
import path from 'node:path';
import type { LogDay, LogDayResponse, LogRecord } from '@claude-history/shared';
import { logFilePath } from './logger.ts';
import { foldText } from './search.ts';

/** YYYY-MM-DD, validated before any path is built from it. */
export const LOG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_RE = /^\d{4}-\d{2}-\d{2}\.log$/;

interface DayCache {
  size: number;
  mtimeMs: number;
  records: LogRecord[];
  /** Bytes already parsed — always ending on a line break. */
  offset: number;
}

/**
 * Parsed days, keyed by date. Live-following the current day would otherwise
 * re-parse the whole file every second; with this, a file that only grew costs
 * a read of the appended bytes.
 */
const cache = new Map<string, DayCache>();

function parseLines(text: string, fallbackTime: string): { records: LogRecord[]; consumedBytes: number } {
  // Whatever follows the last newline is a half-written line: leave its bytes
  // unconsumed so the next read picks it up complete.
  const lastBreak = text.lastIndexOf('\n');
  const complete = lastBreak < 0 ? '' : text.slice(0, lastBreak + 1);
  const records: LogRecord[] = [];
  let lastTime = fallbackTime;
  for (const line of complete.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as LogRecord;
      if (typeof parsed.msg !== 'string' || typeof parsed.lvl !== 'string') throw new Error('shape');
      lastTime = parsed.t ?? lastTime;
      records.push(parsed);
    } catch {
      // Never drop a line silently: a truncated or hand-edited file should
      // still be readable, with the damage visible rather than invisible.
      records.push({
        t: lastTime,
        lvl: 'warn',
        src: 'log',
        pid: 0,
        msg: `unreadable log line: ${line.slice(0, 500)}`,
      });
    }
  }
  return { records, consumedBytes: Buffer.byteLength(complete) };
}

export function listDays(logsDir: string): LogDay[] {
  try {
    return fs
      .readdirSync(logsDir)
      .filter((name) => FILE_RE.test(name))
      .map((name) => ({
        date: name.slice(0, 10),
        sizeBytes: fs.statSync(path.join(logsDir, name)).size,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return []; // nothing logged yet
  }
}

export async function readDay(logsDir: string, date: string): Promise<LogRecord[]> {
  const file = logFilePath(logsDir, date);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    cache.delete(date);
    return [];
  }
  const prev = cache.get(date);
  if (prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) return prev.records;

  // Only grew: read the tail. Anything else (truncated, cleared, rewritten)
  // invalidates what we had.
  if (prev && stat.size > prev.size) {
    const handle = await fs.promises.open(file, 'r');
    try {
      const length = stat.size - prev.offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, prev.offset);
      const { records, consumedBytes } = parseLines(buffer.toString('utf8'), prev.records.at(-1)?.t ?? '');
      prev.records.push(...records);
      prev.offset += consumedBytes;
      prev.size = stat.size;
      prev.mtimeMs = stat.mtimeMs;
      return prev.records;
    } finally {
      await handle.close();
    }
  }

  const text = await fs.promises.readFile(file, 'utf8');
  const { records, consumedBytes } = parseLines(text, `${date}T00:00:00.000`);
  cache.set(date, { size: stat.size, mtimeMs: stat.mtimeMs, records, offset: consumedBytes });
  return records;
}

export interface LogFilters {
  levels: Set<string> | null;
  sources: Set<string> | null;
  /** Diacritic- and case-insensitive substring, like the session search. */
  query: string | null;
  limit: number;
}

/**
 * Filter one day and count the facets. Level and source counts are taken AFTER
 * the text search but BEFORE the chips themselves are applied, so unticking a
 * level does not make its own count vanish.
 */
export function queryDay(all: LogRecord[], filters: LogFilters): Omit<LogDayResponse, 'date'> {
  const needle = filters.query ? foldText(filters.query) : null;
  const searched = needle
    ? all.filter((r) =>
        foldText(`${r.msg} ${r.src} ${r.err ?? ''} ${r.data === undefined ? '' : JSON.stringify(r.data)}`).includes(
          needle,
        ),
      )
    : all;

  const levels: Record<string, number> = {};
  const sources: Record<string, number> = {};
  for (const r of searched) {
    levels[r.lvl] = (levels[r.lvl] ?? 0) + 1;
    sources[r.src] = (sources[r.src] ?? 0) + 1;
  }

  const matching = searched.filter(
    (r) => (!filters.levels || filters.levels.has(r.lvl)) && (!filters.sources || filters.sources.has(r.src)),
  );
  // Newest first: a log viewer is read from the most recent line backwards.
  const records = matching.slice(-filters.limit).reverse();
  return { records, total: matching.length, truncated: matching.length > records.length, levels, sources };
}
