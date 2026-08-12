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

/** How far back to look for the newline that starts a straddled line. */
const ALIGN_LOOKBACK = 64 * 1024;

/**
 * The text appended to a file since it was `from` bytes long — how a change is
 * classified without re-reading the file. Capped at `cap` (the tail of the
 * delta, which is the recent end) because a session that grew by megabytes
 * between two scans is not worth reading in full to answer a yes/no question.
 *
 * The start is pulled back to a line boundary. Transcripts are appended while
 * we watch them, so a scan can land mid-line — and a delta beginning inside a
 * line hides what that line was, since the `type` is at its start. The price is
 * re-reading one line we may already have seen, which is exactly the right
 * trade when the alternative is silently missing it. The END can still be
 * partial, so callers must parse defensively (`safeParse` rejects fragments).
 */
export async function appendedText(filePath: string, from: number, cap = 512 * 1024): Promise<string> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    let start = Math.max(0, Math.min(from, size));
    // One byte settles the common case: whole lines are appended, so `from`
    // usually sits right after a newline and no look-back is needed at all.
    if (start > 0) {
      const prev = Buffer.alloc(1);
      await fh.read(prev, 0, 1, start - 1);
      if (prev[0] !== 0x0a) {
        const back = Math.max(0, start - ALIGN_LOOKBACK);
        const probe = Buffer.alloc(start - back);
        await fh.read(probe, 0, probe.length, back);
        const nl = probe.lastIndexOf(0x0a);
        // No newline within the look-back: one line longer than that is not
        // worth chasing further, so take the delta as it is.
        if (nl >= 0) start = back + nl + 1;
      }
    }
    // Past the cap, keep the recent end: "did Claude just answer?" is a
    // question about the last thing written, not the first.
    start = Math.max(start, size - cap);
    const len = Math.max(0, size - start);
    if (len === 0) return '';
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

/** Stream every line of the file (for full parses). */
export async function* streamLines(filePath: string): AsyncGenerator<string> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

/**
 * Tells a re-appended line from a new one, and every full parse of a transcript
 * must apply it — identically.
 *
 * When Claude Code compacts, it does not only write the boundary and the
 * summary: it replays the stretch of conversation it carries into the fresh
 * context by appending those lines AGAIN, re-parented onto the summary and
 * keeping their ORIGINAL timestamps. Verified on two boundaries of
 * `0f5b1c8b` (2,072 lines, the previous segment in full, boundary and summary
 * included) and 23 of `cae7f9f5` (17,678). Read as new messages they invent
 * whole segments of conversation, duplicate the boundary that closes them so a
 * segment ends before it starts, and repeat text into answers given days
 * earlier.
 *
 * A uuid identifies a line and the copies keep theirs, so a uuid seen twice is
 * a replay of the first. Keep the FIRST: that is where the exchange really
 * happened, and the one carrying the billed `usage` — a replay's top-level
 * token counts are zeroed (only its `iterations[]` keeps the figures), so
 * Claude Code does not bill it either.
 */
export function replayFilter(): (o: RawLine) => boolean {
  const seen = new Set<string>();
  return (o) => {
    const uuid = str(o.uuid);
    if (!uuid) return false;
    if (seen.has(uuid)) return true;
    seen.add(uuid);
    return false;
  };
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
