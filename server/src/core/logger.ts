import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, LogLevel, LogRecord } from '@claude-history/shared';
import { APP_VERSION } from '../version.ts';

/**
 * Application logging: one JSONL file per local day under the app's own data
 * folder, shared by every way of running the server (installed release, source,
 * portable). One place means the trail survives switching between them — the
 * previous design wrote to a file next to whichever build was running, so
 * alternating between them split the evidence in two and made an
 * after-the-fact "why did it not fire?" unanswerable.
 *
 * JSONL, not text, because the log viewer in the app is the intended reader:
 * levels, sources, pid and structured extras stay queryable, and a multi-line
 * stack trace cannot corrupt the format.
 *
 * Records are timestamped in LOCAL time with the offset (`2026-08-08T21:31:45
 * .207+02:00`): still ISO-8601, still sortable, still `Date.parse`-able, but a
 * person reading a raw line does not have to do timezone arithmetic.
 */

/** Records below this are not written. Overridden by the user setting. */
let threshold: LogLevel = 'info';
let retentionDays = 14;
let logsDir: string | null = null;

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
/** A runaway warning in a loop must not be able to fill the disk. */
const MAX_DAY_BYTES = 16 * 1024 * 1024;
const FILE_RE = /^\d{4}-\d{2}-\d{2}\.log$/;

/** Emits 'appended' after every written record, for the SSE feed. */
export const logEvents = new EventEmitter();

// The real console, captured before the patch below replaces it.
const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let stream: fs.WriteStream | null = null;
let streamDate = '';
let streamBytes = 0;
let dayCapped = false;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Local calendar date — how a person looks for "last night's log". */
function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `dd/MM/yyyy HH:mm:ss` local — the app's convention for an absolute datetime,
 * and what log MESSAGES must use. Anthropic's timestamps arrive in UTC, and
 * pasting one straight into a message makes it unreadable next to the record's
 * own local `t`: two different clocks on the same line.
 */
export function localStamp(when: string | number | Date): string {
  const d = when instanceof Date ? when : new Date(typeof when === 'number' ? when : Date.parse(when));
  if (Number.isNaN(d.getTime())) return String(when);
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function localIso(d = new Date()): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function logFilePath(dir: string, date: string): string {
  return path.join(dir, `${date}.log`);
}

/** Drop day files outside the retention window. Dates are ISO, so string compare works. */
function prune(): void {
  if (!logsDir) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (retentionDays - 1));
  const oldest = localDate(cutoff);
  try {
    for (const name of fs.readdirSync(logsDir)) {
      if (!FILE_RE.test(name)) continue;
      if (name.slice(0, 10) < oldest) fs.rmSync(path.join(logsDir, name), { force: true });
    }
  } catch {
    // A missing or unreadable logs dir is not worth failing over.
  }
}

/** Open (or roll over to) today's file. Returns null when it cannot be written. */
function ensureStream(): fs.WriteStream | null {
  if (!logsDir) return null;
  const today = localDate();
  if (stream && streamDate === today) return stream;
  if (stream) {
    stream.end();
    stream = null;
  }
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const file = logFilePath(logsDir, today);
    streamBytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
    stream = fs.createWriteStream(file, { flags: 'a' });
    // A stream error (disk full, permissions) must not become an unhandled
    // 'error' event and take the process down with it.
    stream.on('error', (err) => rawConsole.error('[log] cannot write the log file:', err));
    streamDate = today;
    dayCapped = false;
    prune(); // also covers the midnight rollover
    return stream;
  } catch (err) {
    rawConsole.error('[log] cannot open the log file:', err);
    return null;
  }
}

function emit(record: LogRecord): void {
  if (RANK[record.lvl] < RANK[threshold]) return;
  const line = `${JSON.stringify(record)}\n`;
  const out = ensureStream();
  if (out && !dayCapped) {
    streamBytes += Buffer.byteLength(line);
    if (streamBytes > MAX_DAY_BYTES) {
      dayCapped = true;
      out.write(
        `${JSON.stringify({
          t: localIso(),
          lvl: 'error',
          src: 'log',
          pid: process.pid,
          msg: `today's log passed ${Math.round(MAX_DAY_BYTES / 1024 / 1024)} MB — nothing more will be written until tomorrow`,
        } satisfies LogRecord)}\n`,
      );
    } else {
      out.write(line);
      logEvents.emit('appended');
    }
  }
  // Keep printing: `pnpm dev` watches a terminal, and the installed instance
  // costs nothing for a write to a hidden console.
  const text = `${record.src ? `[${record.src}] ` : ''}${record.msg}${record.err ? `\n${record.err}` : ''}`;
  if (record.lvl === 'error' || record.lvl === 'fatal') rawConsole.error(text);
  else if (record.lvl === 'warn') rawConsole.warn(text);
  else rawConsole.log(text);
}

function record(src: string, lvl: LogLevel, msg: string, extra?: unknown): void {
  const rec: LogRecord = { t: localIso(), lvl, src, pid: process.pid, msg };
  if (extra instanceof Error) rec.err = extra.stack ?? extra.message;
  else if (extra !== undefined) rec.data = extra;
  emit(rec);
}

/**
 * Write a record whose timestamp is NOT now, for lines imported from a log we
 * did not write (the installer's update.log). Keeping the original time is the
 * whole point: an update has to read as one ordered timeline, not as our
 * records plus a block of foreign ones stamped whenever we happened to import
 * them.
 */
export function recordImported(src: string, lvl: LogLevel, msg: string, when: Date, extra?: unknown): void {
  const rec: LogRecord = { t: localIso(when), lvl, src, pid: process.pid, msg };
  if (extra !== undefined) rec.data = extra;
  emit(rec);
}

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

/**
 * A logger bound to one subsystem. `extra` is either an Error (stored as a
 * stack under `err`) or anything JSON-serializable (stored under `data`).
 */
export function createLogger(src: string): Logger {
  return {
    debug: (msg, extra) => record(src, 'debug', msg, extra),
    info: (msg, extra) => record(src, 'info', msg, extra),
    warn: (msg, extra) => record(src, 'warn', msg, extra),
    error: (msg, extra) => record(src, 'error', msg, extra),
  };
}

/** Apply the user's logging settings (called at startup and on every save). */
export function applyLogSettings(settings: Pick<AppSettings, 'logLevel' | 'logRetentionDays'>): void {
  threshold = settings.logLevel;
  retentionDays = Math.max(1, Math.round(settings.logRetentionDays));
  prune();
}

/**
 * Delete every daily file, including the one being written: the stream is
 * closed first and reopened on the next record, so "clear" really clears
 * instead of leaving today behind because the file was locked.
 */
export function clearLogs(): number {
  if (!logsDir) return 0;
  if (stream) {
    stream.end();
    stream = null;
    streamDate = '';
  }
  let deleted = 0;
  for (const name of fs.readdirSync(logsDir)) {
    if (!FILE_RE.test(name)) continue;
    fs.rmSync(path.join(logsDir, name), { force: true });
    deleted++;
  }
  createLogger('log').info(`cleared ${deleted} log file${deleted === 1 ? '' : 's'}`);
  return deleted;
}

/**
 * Start logging. Also routes stray `console.*` (ours or a dependency's) into
 * the same files, and makes sure a crash leaves a record: the installed
 * instance runs hidden, so without this it dies without a trace.
 */
export function initLogging(dir: string): void {
  logsDir = dir;
  const log = createLogger('server');

  for (const level of ['log', 'warn', 'error'] as const) {
    const mapped: LogLevel = level === 'log' ? 'info' : level;
    console[level] = (...args: unknown[]) => {
      const err = args.find((a) => a instanceof Error);
      const msg = args
        .filter((a) => !(a instanceof Error))
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      record('console', mapped, msg, err);
    };
  }

  const fatal = (kind: string, err: unknown) => {
    record('server', 'fatal', kind, err instanceof Error ? err : { value: String(err) });
    if (stream) stream.end(() => process.exit(1));
    else process.exit(1);
  };
  process.on('uncaughtException', (err) => fatal('uncaughtException', err));
  process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));

  // Written synchronously: by exit time the stream can no longer flush.
  process.on('exit', (code) => {
    if (!logsDir) return;
    try {
      fs.appendFileSync(
        logFilePath(logsDir, localDate()),
        `${JSON.stringify({ t: localIso(), lvl: 'info', src: 'server', pid: process.pid, msg: `process exiting with code ${code}` } satisfies LogRecord)}\n`,
      );
    } catch {
      // Nothing useful left to do while exiting.
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(signal, () => {
      log.info(`received ${signal}`);
      if (stream) stream.end(() => process.exit(0));
      else process.exit(0);
    });
  }

  log.info(`--- started: claude-history ${APP_VERSION} (pid ${process.pid}, parent ${process.ppid}) ---`);
}
