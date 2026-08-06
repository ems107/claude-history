import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'node:readline';

// Transcript lines can be huge (~27 KB observed) and files are appended while
// we read them, so head/tail readers work on byte chunks and only ever return
// complete lines.

const HEAD_CHUNK = 128 * 1024;
const TAIL_CHUNK = 256 * 1024;
const MAX_CHUNK = 4 * 1024 * 1024;

export type RawLine = Record<string, unknown>;

export function safeParse(line: string): RawLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== '{') return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return typeof value === 'object' && value !== null ? (value as RawLine) : null;
  } catch {
    return null;
  }
}

async function readChunk(filePath: string, start: number, length: number): Promise<{ buf: Buffer; fileSize: number }> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    const realStart = Math.min(start, size);
    const realLen = Math.max(0, Math.min(length, size - realStart));
    const buf = Buffer.alloc(realLen);
    if (realLen > 0) await fh.read(buf, 0, realLen, realStart);
    return { buf, fileSize: size };
  } finally {
    await fh.close();
  }
}

function cleanLines(lines: string[]): string[] {
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter((l) => l.trim() !== '');
}

/** First `n` complete lines of the file. */
export async function headLines(filePath: string, n: number): Promise<string[]> {
  let chunk = HEAD_CHUNK;
  for (;;) {
    const { buf, fileSize } = await readChunk(filePath, 0, chunk);
    const atEof = buf.length >= fileSize;
    const parts = buf.toString('utf8').split('\n');
    const complete = cleanLines(atEof ? parts : parts.slice(0, -1));
    if (complete.length >= n || atEof || chunk >= MAX_CHUNK) return complete.slice(0, n);
    chunk *= 4;
  }
}

/** Last `n` complete lines of the file. The very last line may still be a partial append; safeParse will reject it. */
export async function tailLines(filePath: string, n: number): Promise<string[]> {
  let chunk = TAIL_CHUNK;
  for (;;) {
    const fh = await fsp.open(filePath, 'r');
    let buf: Buffer;
    let start: number;
    try {
      const { size } = await fh.stat();
      start = Math.max(0, size - chunk);
      const len = size - start;
      buf = Buffer.alloc(len);
      if (len > 0) await fh.read(buf, 0, len, start);
    } finally {
      await fh.close();
    }
    const parts = buf.toString('utf8').split('\n');
    // Drop the first (potentially partial) line unless we read from byte 0.
    const lines = cleanLines(start > 0 ? parts.slice(1) : parts);
    if (lines.length >= n || start === 0 || chunk >= MAX_CHUNK) return lines.slice(-n);
    chunk *= 4;
  }
}

/** Stream every line of the file (for full parses). */
export async function* streamLines(filePath: string): AsyncGenerator<string> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

// ---- loose accessors over parsed lines ----

export function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
