// Surveys the transcript corpus for the SHAPES it contains, and the first and
// last Claude Code version each one was written by.
//
// Usage:  node scripts/corpus-shapes.mjs [--since <version>] [--data-root <dir>] [--json]
//
// It exists for the review rounds in docs/AI_CLAUDE_CODE_VERSIONS.md. The
// changelog says what Claude Code added; it almost never says what changed on
// disk, because the format is undocumented. So a round asks the corpus too:
// `--since <last reviewed version>` lists every shape no older line carries,
// and each one is checked against the parser and the area docs.
//
// A shape is one of:
//
//   line:<type>                 a line's `type`
//   system:<subtype>            a system line's `subtype`
//   attachment:<type>           an attachment line's `attachment.type`
//   block:<role>:<type>         a content block in `message.content`
//   tool:<name>                 a `tool_use` block's tool
//   key:<type>.<key>            a top-level key of a line of that type
//   message:<type>.<key>        a key of that line's `message`
//   usage:<key>                 a key of an assistant line's `message.usage`
//   iteration:<type>            an entry of `message.usage.iterations`
//
// "First seen" is not "introduced". A shape shows up when something on this
// machine first used it, and `cleanupPeriodDays` has swept the older
// transcripts, so a date here is a hint to verify — never a fact to cite.
//
// Read-only: every file is opened for reading, nothing is written anywhere, and
// a line that does not parse (a corrupt one, or the half-written end of an
// active file) is counted and skipped.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

// Resolved exactly as server/src/config.ts resolves it.
const DATA_ROOT = path.resolve(arg('data-root') || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const PROJECTS = path.join(DATA_ROOT, 'projects');
const SINCE = arg('since', null);
const JSON_OUT = flag('json');

const parts = (v) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
function cmpVersion(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

function* jsonlFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

const isRec = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** shape → { first, last, lines, example } */
const shapes = new Map();
/** version → lines */
const versions = new Map();
let files = 0;
let unparseable = 0;
let inherited = 0;
let undated = 0;

function see(shape, version, example) {
  const s = shapes.get(shape);
  if (!s) {
    shapes.set(shape, { first: version, last: version, lines: 1, example });
    return;
  }
  s.lines++;
  if (cmpVersion(version, s.first) < 0) {
    s.first = version;
    s.example = example;
  }
  if (cmpVersion(version, s.last) > 0) s.last = version;
}

function survey(line, version, example) {
  const type = typeof line.type === 'string' ? line.type : '(none)';
  const seen = new Set();
  const add = (shape) => {
    if (!seen.has(shape)) {
      seen.add(shape);
      see(shape, version, example);
    }
  };

  add(`line:${type}`);
  for (const k of Object.keys(line)) add(`key:${type}.${k}`);
  if (type === 'system' && typeof line.subtype === 'string') add(`system:${line.subtype}`);
  if (type === 'attachment' && isRec(line.attachment) && typeof line.attachment.type === 'string') {
    add(`attachment:${line.attachment.type}`);
  }

  const message = line.message;
  if (!isRec(message)) return;
  for (const k of Object.keys(message)) add(`message:${type}.${k}`);
  if (type === 'assistant' && isRec(message.usage)) {
    for (const k of Object.keys(message.usage)) add(`usage:${k}`);
    // Every iteration here is a plain `message` so far; anything else (an
    // advisor's sub-call, say) is a request priced inside another one.
    if (Array.isArray(message.usage.iterations)) {
      for (const it of message.usage.iterations) if (isRec(it)) add(`iteration:${it.type ?? '(none)'}`);
    }
  }
  if (!Array.isArray(message.content)) return;
  const role = typeof message.role === 'string' ? message.role : type;
  for (const c of message.content) {
    if (!isRec(c) || typeof c.type !== 'string') continue;
    add(`block:${role}:${c.type}`);
    // MCP tools are named by whoever configured the server: one shape for all.
    if (c.type === 'tool_use' && typeof c.name === 'string') add(`tool:${c.name.startsWith('mcp__') ? 'mcp__*' : c.name}`);
  }
}

// Split on "\n" alone. `readline` would also break a line at U+2028 and U+2029,
// which Claude Code writes raw inside JSON strings, and both halves would then
// fail to parse.
async function* lines(file) {
  let rest = '';
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8' })) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop();
    yield* parts;
  }
  if (rest) yield rest;
}

// A third of the lines carry no `version` — the sidecars (`ai-title`,
// `last-prompt`, `mode`, …) — and those are where new line types tend to
// appear. Each one is dated by the nearest versioned line in the same file: the
// one before it, or the first one after it at the top of a file. Lines in a
// file with no versioned line at all are only counted.
async function readFile(file) {
  const fallbackId = path.basename(file, '.jsonl');
  let current = null;
  const pending = [];
  for await (const text of lines(file)) {
    if (!text.trim()) continue;
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      unparseable++;
      continue;
    }
    if (!isRec(line)) {
      unparseable++;
      continue;
    }
    const example = typeof line.sessionId === 'string' ? line.sessionId : fallbackId;
    if (typeof line.version === 'string') {
      current = line.version;
      versions.set(current, (versions.get(current) ?? 0) + 1);
      for (const p of pending.splice(0)) survey(p.line, current, p.example);
      survey(line, current, example);
    } else if (current) {
      inherited++;
      survey(line, current, example);
    } else {
      inherited++;
      pending.push({ line, example });
    }
  }
  inherited -= pending.length;
  undated += pending.length;
}

for (const file of jsonlFiles(PROJECTS)) {
  files++;
  await readFile(file);
}

const rows = [...shapes.entries()]
  .map(([shape, s]) => ({ shape, ...s }))
  .filter((r) => !SINCE || cmpVersion(r.first, SINCE) > 0)
  .sort((a, b) => cmpVersion(a.first, b.first) || a.shape.localeCompare(b.shape));
const versionRows = [...versions.entries()].sort((a, b) => cmpVersion(a[0], b[0]));

if (JSON_OUT) {
  const out = {
    dataRoot: DATA_ROOT,
    since: SINCE,
    files,
    unparseable,
    inherited,
    undated,
    versions: Object.fromEntries(versionRows),
    shapes: rows,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
  const total = versionRows.reduce((n, [, c]) => n + c, 0);
  console.log(`Corpus: ${PROJECTS}`);
  console.log(
    `${files} files, ${total} lines with a version, ${inherited} dated by a neighbour, ${undated} undated, ${unparseable} unparseable`,
  );
  console.log('');
  console.log('Versions in the corpus (lines):');
  console.log(versionRows.map(([v, c]) => `${v} (${c})`).join(' · '));
  console.log('');
  console.log(SINCE ? `Shapes first seen after ${SINCE}:` : 'All shapes:');
  if (!rows.length) {
    console.log('None.');
  } else {
    console.log('');
    console.log('| Shape | First | Last | Lines | Example |');
    console.log('| --- | --- | --- | --- | --- |');
    for (const r of rows) {
      console.log(`| \`${r.shape}\` | ${r.first} | ${r.last} | ${r.lines} | \`${r.example.slice(0, 8)}\` |`);
    }
  }
}
