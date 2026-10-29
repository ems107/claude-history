import { createHash, type Hash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {
  REQUEST_PREVIEW_CHARS,
  type RequestBlockSummary,
  type RequestCacheMark,
  type RequestDetailResponse,
  type RequestListEntry,
  type RequestMessageResponse,
  type RequestMessageSummary,
  type RequestSystemBlock,
  type RequestTool,
} from '@claude-history/shared';
import { isRec, num, type RawLine, safeParse, str } from './jsonl.ts';
import { toMessageUsage } from './parser.ts';
import { thinkingKind } from './summarizer.ts';

/**
 * The exact request each reply answered, rebuilt from its transcript.
 *
 * Since CLI 2.1.300 a transcript records every API request, delta-encoded: an
 * `api-request` line names the request before it (`base`), how many of its
 * messages it sent again (`keep`) and the hashes of the ones it added (`tail`).
 * The system prompt and the tools are an `api-request-shape`, once per
 * `shapeHash`. A message is an `api-request-blob` ONLY when the transcript does
 * not already hold it as sent — injected context, a compaction's summary, a
 * message the CLI rewrote. Every other hash names the transcript itself: a run
 * of `user`/`assistant` lines, hashed the CLI's way (`runHash` below). Over the
 * whole corpus that resolves every message of every request, 22,922 of 22,922.
 *
 * Read lazily and only here: nothing else in the app needs the content, and a
 * request can carry megabytes. An index of WHERE everything is — byte offsets,
 * never the content — is kept for the two files read last, and follows a live
 * file by reading only what was appended.
 */

interface Loc {
  offset: number;
  length: number;
}

interface RawRequest {
  id: string;
  base: string | null;
  keep: number;
  tail: string[];
  params: Record<string, unknown>;
  shapeHash: string | null;
  cacheControl: RequestCacheMark[];
  querySource: string | null;
  version: string | null;
  timestamp: string | null;
  /** Where its line is: a message it sent was written before it. */
  offset: number;
}

/** A run of transcript lines, as a range of `FileIndex.msgLines`. */
interface RunRef {
  start: number;
  end: number;
}

interface OpenRun {
  role: string;
  messageId: string | undefined;
  hash: Hash;
  blocks: number;
  start: number;
}

interface FileIndex {
  filePath: string;
  identity: string;
  /** Bytes read so far: always the end of a complete line. */
  pos: number;
  requests: RawRequest[];
  byId: Map<string, number>;
  shapes: Map<string, Loc>;
  blobs: Map<string, Loc>;
  /**
   * Every run a hash names, in file order. One message can be there twice — a
   * prompt typed again, `/compact`'s caveat — and both share a hash, so a
   * request picks its own copies by position (`locate`).
   */
  runs: Map<string, RunRef[]>;
  /** Every `user`/`assistant` line that joined a run, in file order. */
  msgLines: Array<Loc & { uuid: string | null }>;
  /** By `requestRef`: the first line of the reply. */
  replies: Map<string, { uuid: string; usage: Record<string, unknown> }>;
  run: OpenRun | null;
}

/**
 * JSON with its keys sorted and every `cache_control` left out — the form the
 * CLI hashes a message in, so a breakpoint moving does not change a hash.
 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => k !== 'cache_control' && o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

function contentBlocks(content: unknown): unknown[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [content];
}

/**
 * Lines of the same message are one run: consecutive `user` lines, or
 * consecutive `assistant` lines of one `message.id` (a reply streams one block
 * per line). Lines of any other type between them do not break it.
 */
function continuesRun(run: OpenRun, role: string, messageId: string | undefined): boolean {
  return run.role === role && (role === 'user' || (messageId !== undefined && run.messageId === messageId));
}

function readRequest(o: RawLine, offset: number): RawRequest | null {
  const id = str(o.id);
  if (!id) return null;
  const cacheControl: RequestCacheMark[] = Array.isArray(o.cacheControl)
    ? o.cacheControl.filter(isRec).map((c) => {
        const v = isRec(c.value) ? c.value : {};
        return {
          path: Array.isArray(c.path) ? c.path.filter((p) => typeof p === 'string' || typeof p === 'number') : [],
          ttl: str(v.ttl),
          scope: str(v.scope),
        };
      })
    : [];
  return {
    id,
    base: str(o.base),
    keep: num(o.keep) ?? 0,
    tail: Array.isArray(o.tail) ? o.tail.filter((h): h is string => typeof h === 'string') : [],
    params: isRec(o.params) ? o.params : {},
    shapeHash: str(o.shapeHash),
    cacheControl,
    querySource: str(o.querySource),
    version: str(o.version),
    timestamp: str(o.timestamp),
    offset,
  };
}

/** Folds one complete line into the index. */
function note(index: FileIndex, line: string, loc: Loc): void {
  // A cheap test first: most lines are none of these, and parsing a megabyte of
  // screenshot to find out costs more than everything else here put together.
  if (!line.includes('"type":"api-request') && !line.includes('"type":"user"') && !line.includes('"type":"assistant"')
    && !line.includes('compact_boundary')) {
    return;
  }
  const o = safeParse(line);
  if (!o) return;
  const type = str(o.type);
  if (type === 'api-request') {
    const r = readRequest(o, loc.offset);
    if (r && !index.byId.has(r.id)) {
      index.byId.set(r.id, index.requests.length);
      index.requests.push(r);
    }
    return;
  }
  if (type === 'api-request-shape') {
    const hash = str(o.shapeHash);
    if (hash && !index.shapes.has(hash)) index.shapes.set(hash, loc);
    return;
  }
  if (type === 'api-request-blob') {
    const hash = str(o.hash);
    if (hash && !index.blobs.has(hash)) index.blobs.set(hash, loc);
    return;
  }
  if (type === 'system' && o.subtype === 'compact_boundary') {
    index.run = null;
    return;
  }
  if (type !== 'user' && type !== 'assistant') return;
  const m = isRec(o.message) ? o.message : null;
  if (!m || typeof m.role !== 'string' || m.content === undefined) {
    index.run = null;
    return;
  }
  const requestRef = str(o.requestRef);
  if (type === 'assistant' && requestRef && !index.replies.has(requestRef) && str(o.uuid)) {
    index.replies.set(requestRef, { uuid: str(o.uuid)!, usage: isRec(m.usage) ? m.usage : {} });
  }
  const messageId = str(m.id) ?? undefined;
  if (!index.run || !continuesRun(index.run, m.role, messageId)) {
    index.run = {
      role: m.role,
      messageId,
      hash: createHash('sha256').update('{"content":['),
      blocks: 0,
      start: index.msgLines.length,
    };
  }
  const run = index.run;
  for (const b of contentBlocks(m.content)) {
    if (run.blocks++ > 0) run.hash.update(',');
    run.hash.update(canonical(b));
  }
  index.msgLines.push({ ...loc, uuid: str(o.uuid) });
  // Every prefix of a run is a message the CLI may have sent: a reply is
  // hashed again with each block it streams.
  const hash = run.hash.copy().update(`],"role":${JSON.stringify(m.role)}}`).digest('hex');
  const ref = { start: run.start, end: index.msgLines.length };
  const known = index.runs.get(hash);
  if (known) known.push(ref);
  else index.runs.set(hash, [ref]);
}

/**
 * Reads complete lines from `from` on, with their byte offsets. Split on the
 * byte 0x0A, which never occurs inside a UTF-8 sequence. A last line with no
 * newline yet is left for the next read: the CLI may still be writing it.
 */
async function readFrom(index: FileIndex, from: number): Promise<void> {
  let pos = from;
  let rest: Buffer = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(index.filePath, { start: from })) {
    const buf = rest.length > 0 ? Buffer.concat([rest, chunk as Buffer]) : (chunk as Buffer);
    let start = 0;
    let nl: number;
    while ((nl = buf.indexOf(0x0a, start)) >= 0) {
      const lineEnd = nl > start && buf[nl - 1] === 0x0d ? nl - 1 : nl;
      note(index, buf.toString('utf8', start, lineEnd), { offset: pos + start, length: lineEnd - start });
      start = nl + 1;
    }
    pos += start;
    rest = buf.subarray(start);
  }
  index.pos = pos;
}

const cache = new Map<string, FileIndex>();
const building = new Map<string, Promise<FileIndex>>();
/** Two: the session open in this tab, and the one it was opened from. */
const CACHED_FILES = 2;

async function indexFor(filePath: string): Promise<FileIndex> {
  const pending = building.get(filePath);
  if (pending) return pending;
  const job = (async () => {
    const st = await fsp.stat(filePath);
    const identity = `${st.ino}:${st.birthtimeMs}`;
    let index = cache.get(filePath);
    if (index && (index.identity !== identity || st.size < index.pos)) index = undefined;
    if (!index) {
      index = {
        filePath,
        identity,
        pos: 0,
        requests: [],
        byId: new Map(),
        shapes: new Map(),
        blobs: new Map(),
        runs: new Map(),
        msgLines: [],
        replies: new Map(),
        run: null,
      };
    }
    if (st.size > index.pos) {
      try {
        await readFrom(index, index.pos);
      } catch (err) {
        // Half-folded: the lines read so far are in the index and `pos` is not
        // past them, so the next read would fold them twice. Start over then.
        cache.delete(filePath);
        throw err;
      }
    }
    cache.delete(filePath);
    cache.set(filePath, index);
    while (cache.size > CACHED_FILES) cache.delete(cache.keys().next().value!);
    return index;
  })();
  building.set(filePath, job);
  try {
    return await job;
  } finally {
    building.delete(filePath);
  }
}

async function readLines(filePath: string, locs: readonly Loc[]): Promise<Array<RawLine | null>> {
  if (locs.length === 0) return [];
  const fh = await fsp.open(filePath, 'r');
  try {
    const out: Array<RawLine | null> = [];
    for (const loc of locs) {
      const buf = Buffer.alloc(loc.length);
      await fh.read(buf, 0, loc.length, loc.offset);
      out.push(safeParse(buf.toString('utf8')));
    }
    return out;
  } finally {
    await fh.close();
  }
}

/** The hashes of a request's messages, in order: its chain replayed from the first request that kept nothing. */
function messageHashes(index: FileIndex, r: RawRequest): string[] {
  const chain: RawRequest[] = [];
  for (let cur: RawRequest | undefined = r; cur; ) {
    chain.push(cur);
    const at: number | undefined = cur.base ? index.byId.get(cur.base) : undefined;
    cur = at === undefined ? undefined : index.requests[at];
  }
  let hashes: string[] = [];
  for (let i = chain.length - 1; i >= 0; i--) hashes = [...hashes.slice(0, chain[i].keep), ...chain[i].tail];
  return hashes;
}

interface ResolvedMessage {
  role: string;
  source: 'conversation' | 'request';
  uuid: string | null;
  content: unknown[];
}

type Plan = { kind: 'blob' | 'run'; locs: Array<Loc & { uuid?: string | null }> } | null;

/**
 * Where each of a request's messages is: its blob, or the transcript lines its
 * hash names. A hash the transcript holds more than once is handed out by
 * position — the request's n copies of it are the last n written before it,
 * in order — so a jump to "this message" lands on the copy that was sent.
 */
function locate(index: FileIndex, r: RawRequest, hashes: readonly string[]): Plan[] {
  const wanted = new Map<string, number>();
  for (const h of hashes) if (!index.blobs.has(h) && index.runs.has(h)) wanted.set(h, (wanted.get(h) ?? 0) + 1);
  const copies = new Map<string, RunRef[]>();
  for (const [h, n] of wanted) {
    const all = index.runs.get(h)!;
    const before = all.filter((ref) => index.msgLines[ref.start].offset < r.offset);
    const pool = before.length > 0 ? before : all;
    copies.set(h, pool.slice(Math.max(0, pool.length - n)));
  }
  const handed = new Map<string, number>();
  return hashes.map((h) => {
    const blob = index.blobs.get(h);
    if (blob) return { kind: 'blob', locs: [blob] };
    const pool = copies.get(h);
    if (!pool) return null;
    const k = handed.get(h) ?? 0;
    handed.set(h, k + 1);
    const ref = pool[Math.min(k, pool.length - 1)];
    return { kind: 'run', locs: index.msgLines.slice(ref.start, ref.end) };
  });
}

/** Each planned message's content, read from where `locate` found it. */
async function resolveMessages(index: FileIndex, plan: readonly Plan[]): Promise<Array<ResolvedMessage | null>> {
  const lines = await readLines(
    index.filePath,
    plan.flatMap((p) => p?.locs ?? []),
  );
  let at = 0;
  return plan.map((p) => {
    if (!p) return null;
    const got = lines.slice(at, at + p.locs.length);
    at += p.locs.length;
    if (p.kind === 'blob') {
      const m = got[0] && isRec(got[0].message) ? got[0].message : null;
      return m ? { role: str(m.role) ?? '?', source: 'request', uuid: null, content: contentBlocks(m.content) } : null;
    }
    const content: unknown[] = [];
    let role = '?';
    for (const line of got) {
      const m = line && isRec(line.message) ? line.message : null;
      if (!m) return null;
      role = str(m.role) ?? role;
      content.push(...contentBlocks(m.content));
    }
    return { role, source: 'conversation', uuid: p.locs[0].uuid ?? null, content };
  });
}

function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('\n');
  if (isRec(v)) {
    if (typeof v.text === 'string') return v.text;
    if (v.type === 'image') return '[image]';
  }
  return v === undefined ? '' : JSON.stringify(v);
}

function summariseBlock(b: unknown, callNames: Map<string, string>): RequestBlockSummary {
  const rec = isRec(b) ? b : {};
  const type = str(rec.type) ?? typeof b;
  let name: string | null = null;
  let toolUseId: string | null = null;
  let text = '';
  if (type === 'text') text = str(rec.text) ?? '';
  else if (type === 'thinking') text = str(rec.thinking) ?? '';
  else if (type === 'tool_use') {
    name = str(rec.name);
    toolUseId = str(rec.id);
    if (toolUseId && name) callNames.set(toolUseId, name);
    text = JSON.stringify(rec.input ?? {});
  } else if (type === 'tool_result') {
    toolUseId = str(rec.tool_use_id);
    name = toolUseId ? (callNames.get(toolUseId) ?? null) : null;
    text = textOf(rec.content);
  } else if (type === 'tool_addition') {
    const tool = isRec(rec.tool) ? rec.tool : {};
    const def = isRec(tool.definition) ? tool.definition : tool;
    name = str(def.name);
    text = str(def.description) ?? '';
  } else if (type === 'image') text = '[image]';
  else text = JSON.stringify(b);
  return {
    type,
    name,
    toolUseId,
    chars: JSON.stringify(b).length,
    preview: text.slice(0, REQUEST_PREVIEW_CHARS),
    narration: type === 'thinking' && thinkingKind(rec) === 'narration',
  };
}

/** The request with that id, or null when the file does not hold it. */
export async function requestDetail(filePath: string, requestId: string): Promise<RequestDetailResponse | null> {
  const index = await indexFor(filePath);
  const at = index.byId.get(requestId);
  if (at === undefined) return null;
  const r = index.requests[at];
  const hashes = messageHashes(index, r);
  const resolved = await resolveMessages(index, locate(index, r, hashes));
  // New is a POSITION, not a hash: the list is the kept messages and then the
  // tail, and two identical messages (an empty result, read twice) share one.
  const firstNew = hashes.length - r.tail.length;
  const callNames = new Map<string, string>();
  const messages: RequestMessageSummary[] = resolved.map((m, i) => {
    if (!m) return { role: '?', source: 'request', uuid: null, isNew: i >= firstNew, chars: 0, blocks: [] };
    const blocks = m.content.map((b) => summariseBlock(b, callNames));
    return {
      role: m.role,
      source: m.source,
      uuid: m.uuid,
      isNew: i >= firstNew,
      chars: blocks.reduce((n, b) => n + b.chars, 0),
      blocks,
    };
  });

  let system: RequestSystemBlock[] | null = null;
  let tools: RequestTool[] | null = null;
  const shapeLoc = r.shapeHash ? index.shapes.get(r.shapeHash) : undefined;
  if (shapeLoc) {
    const [line] = await readLines(filePath, [shapeLoc]);
    const shape = line && isRec(line.shape) ? line.shape : null;
    if (shape) {
      system = contentBlocks(shape.system ?? []).map((b) => {
        const text = isRec(b) ? (str(b.text) ?? '') : String(b);
        return { text, chars: JSON.stringify(b).length };
      });
      tools = (Array.isArray(shape.tools) ? shape.tools : []).filter(isRec).map((t) => ({
        name: str(t.name) ?? '?',
        chars: JSON.stringify(t).length,
        description: str(t.description) ?? '',
        inputSchema: t.input_schema ?? null,
      }));
    }
  }

  const reply = index.replies.get(r.id);
  return {
    id: r.id,
    index: at + 1,
    count: index.requests.length,
    prevId: at > 0 ? index.requests[at - 1].id : null,
    nextId: at + 1 < index.requests.length ? index.requests[at + 1].id : null,
    timestamp: r.timestamp,
    querySource: r.querySource,
    version: r.version,
    params: r.params,
    kept: r.keep,
    added: r.tail.length,
    newChain: r.base === null,
    system,
    tools,
    messages,
    cacheMarks: r.cacheControl,
    reply: reply ? { uuid: reply.uuid, usage: toMessageUsage(reply.usage) } : null,
    unresolved: resolved.filter((m) => !m).length,
  };
}

/** Every request the transcript holds, in order. */
export async function requestList(filePath: string): Promise<RequestListEntry[]> {
  const index = await indexFor(filePath);
  /** Messages each request sent, to tell a rewritten history from a grown one. */
  const sent = new Map<string, number>();
  return index.requests.map((r, i) => {
    const baseSent = r.base ? sent.get(r.base) : undefined;
    sent.set(r.id, r.keep + r.tail.length);
    return {
      id: r.id,
      index: i + 1,
      at: r.timestamp,
      querySource: r.querySource,
      model: str(r.params.model),
      kept: r.keep,
      added: r.tail.length,
      newChain: r.base === null,
      rewritten: baseSent !== undefined && r.keep < baseSent,
      replyUuid: index.replies.get(r.id)?.uuid ?? null,
    };
  });
}

/** One message of a request, in full. */
export async function requestMessage(
  filePath: string,
  requestId: string,
  messageIndex: number,
): Promise<RequestMessageResponse | null> {
  const index = await indexFor(filePath);
  const at = index.byId.get(requestId);
  if (at === undefined) return null;
  const r = index.requests[at];
  const hashes = messageHashes(index, r);
  if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= hashes.length) return null;
  // Located among all of them, so a repeated message is the same copy the outline named.
  const [m] = await resolveMessages(index, [locate(index, r, hashes)[messageIndex]]);
  return m ? { role: m.role, source: m.source, uuid: m.uuid, content: m.content } : null;
}

/** Puts a breakpoint back where the request had it: `["messages", 107, "content", 0]`. */
function applyCacheMark(body: Record<string, unknown>, mark: RequestCacheMark): void {
  let target: unknown = body;
  for (const step of mark.path) {
    if (Array.isArray(target) && typeof step === 'number') target = target[step];
    else if (isRec(target) && typeof step === 'string') target = target[step];
    else return;
  }
  if (!isRec(target)) return;
  target.cache_control = {
    type: 'ephemeral',
    ...(mark.ttl ? { ttl: mark.ttl } : {}),
    ...(mark.scope ? { scope: mark.scope } : {}),
  };
}

/**
 * The whole request as an API body: the recorded parameters, the shape, and
 * every message, with each breakpoint put back on the block it marked. Null
 * when the file does not hold it, or a part of it cannot be found.
 */
export async function requestBody(filePath: string, requestId: string): Promise<Record<string, unknown> | null> {
  const index = await indexFor(filePath);
  const at = index.byId.get(requestId);
  if (at === undefined) return null;
  const r = index.requests[at];
  const hashes = messageHashes(index, r);
  const resolved = await resolveMessages(index, locate(index, r, hashes));
  if (resolved.some((m) => !m)) return null;
  const shapeLoc = r.shapeHash ? index.shapes.get(r.shapeHash) : undefined;
  const [line] = shapeLoc ? await readLines(filePath, [shapeLoc]) : [null];
  const shape = line && isRec(line.shape) ? line.shape : {};
  const body: Record<string, unknown> = {
    ...r.params,
    ...(shape.system !== undefined && { system: contentBlocks(shape.system).map((b) => (isRec(b) ? { ...b } : b)) }),
    ...(shape.tools !== undefined && { tools: shape.tools }),
    messages: resolved.map((m) => ({ role: m!.role, content: m!.content.map((b) => (isRec(b) ? { ...b } : b)) })),
  };
  for (const mark of r.cacheControl) applyCacheMark(body, mark);
  return body;
}
