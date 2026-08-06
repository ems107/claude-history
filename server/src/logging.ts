import fs from 'node:fs';
import path from 'node:path';

const MAX_LOG_BYTES = 1024 * 1024;

/**
 * Mirror console output into a file and record fatal errors. The installed
 * instance runs hidden under a scheduled task, so anything written to the
 * console — including the reason it died — is otherwise lost.
 */
export function installFileLogging(logFile: string): void {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    // Keep one previous log around instead of growing forever.
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
      fs.rmSync(`${logFile}.old`, { force: true });
      fs.renameSync(logFile, `${logFile}.old`);
    }
  } catch {
    return; // no writable log location — keep running without one
  }

  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  const write = (level: string, args: unknown[]) => {
    const text = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a)))
      .join(' ');
    stream.write(`${new Date().toISOString()} ${level} ${text}\n`);
  };

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      write(level.toUpperCase(), args);
      original(...args);
    };
  }

  process.on('uncaughtException', (err) => {
    write('FATAL', ['uncaughtException', err]);
    stream.end(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    write('FATAL', ['unhandledRejection', reason]);
    stream.end(() => process.exit(1));
  });
  process.on('exit', (code) => write('INFO', [`process exiting with code ${code}`]));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(sig, () => {
      write('INFO', [`received ${sig}`]);
      stream.end(() => process.exit(0));
    });
  }

  write('INFO', [`--- claude-history starting (pid ${process.pid}, parent ${process.ppid}) ---`]);
}
