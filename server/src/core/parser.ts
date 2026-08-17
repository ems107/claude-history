import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  ContentBlock,
  FileChange,
  FileEdit,
  MessageItem,
  MessageUsage,
  PlanOutcome,
  PrLink,
  SentAttachment,
  SessionDetail,
  SessionSummary,
  SubagentMeta,
  ToolResultInfo,
  Turn,
} from '@claude-history/shared';
import { isContextUsageAnsi, parseContextSnapshot } from './contextSnapshot.ts';
import { isRec, num, replayFilter, safeParse, str, streamLines, type RawLine } from './jsonl.ts';
import type { ScannedSession } from './scanner.ts';
import { extractPrompt, injectedOrigin, parseNotification, queuedPrompt } from './summarizer.ts';

const MAX_RESULT_CHARS = 20_000;

/**
 * `origin.kind` of a task notification, and the label a queued one is given: an
 * attachment line carries no `origin` of its own, and the two envelopes hold the
 * very same block (see the attachment branch below).
 */
const NOTIFICATION_ORIGIN = 'task-notification';

/** Stands in for the uuid of a line that carried none — never part of the message tree. */
const GEN_UUID_PREFIX = 'gen-';

type ToolBlock = Extract<ContentBlock, { kind: 'tool' }>;

export async function loadSubagents(sessionDir: string | null): Promise<SubagentMeta[]> {
  if (!sessionDir) return [];
  const dir = path.join(sessionDir, 'subagents');
  let files: string[];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const metas: SubagentMeta[] = [];
  for (const f of files.sort()) {
    if (!f.startsWith('agent-') || !f.endsWith('.meta.json')) continue;
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')) as RawLine;
      metas.push({
        agentId: f.slice('agent-'.length, -'.meta.json'.length),
        agentType: str(raw.agentType) ?? 'unknown',
        description: str(raw.description) ?? '',
        toolUseId: str(raw.toolUseId) ?? '',
        spawnDepth: num(raw.spawnDepth) ?? 1,
      });
    } catch {
      // unreadable meta — skip this subagent
    }
  }
  return metas;
}

/**
 * The billed tokens of one assistant message. Read from the FIRST line carrying
 * a given `message.id`, exactly as the enricher totals them: the streamed
 * chunks repeat the same usage object, so anything else would multiply it. Keep
 * the two in step — the per-message costs shown in the viewer only reconcile
 * with the session total because both dedupe the same way.
 */
export function toMessageUsage(usage: Record<string, unknown>): MessageUsage {
  const cacheCreation = isRec(usage.cache_creation) ? usage.cache_creation : null;
  return {
    input: num(usage.input_tokens) ?? 0,
    output: num(usage.output_tokens) ?? 0,
    cacheRead: num(usage.cache_read_input_tokens) ?? 0,
    cacheCreate: num(usage.cache_creation_input_tokens) ?? 0,
    cacheCreate1h: cacheCreation ? (num(cacheCreation.ephemeral_1h_input_tokens) ?? 0) : 0,
    cacheCreate5m: cacheCreation ? (num(cacheCreation.ephemeral_5m_input_tokens) ?? 0) : 0,
  };
}

function extractResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (isRec(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function toProjectsRelative(absPath: string, projectsDir: string): string | null {
  const rel = path.relative(projectsDir, absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replaceAll('\\', '/');
}

/**
 * The `AskUserQuestion` answers off the carrying line, question -> chosen.
 *
 * Only strings survive: the field is read straight from a transcript, and the
 * card that renders it must never be handed a shape it did not ask for.
 */
function toAnswers(raw: unknown): Record<string, string> | null {
  if (!isRec(raw)) return null;
  const answers: Record<string, string> = {};
  for (const [question, answer] of Object.entries(raw)) {
    if (typeof answer === 'string') answers[question] = answer;
  }
  return Object.keys(answers).length > 0 ? answers : null;
}

/**
 * The `AskUserQuestion` annotations off the carrying line: per question, the
 * drawing the user took and the note they wrote beside it.
 *
 * Same defensive shape as `toAnswers` — only strings survive — plus one rule of
 * its own: an entry holding neither is dropped rather than kept as `{}`. Claude
 * Code writes annotations only where there is something to say (24 of the 33
 * structured results here), and a viewer asking "is there a note?" must be able
 * to trust the presence of the key.
 */
function toAnnotations(raw: unknown): Record<string, { preview?: string; notes?: string }> | null {
  if (!isRec(raw)) return null;
  const out: Record<string, { preview?: string; notes?: string }> = {};
  for (const [question, value] of Object.entries(raw)) {
    if (!isRec(value)) continue;
    const preview = str(value.preview);
    const notes = str(value.notes);
    if (!preview && !notes) continue;
    out[question] = { ...(preview ? { preview } : {}), ...(notes ? { notes } : {}) };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The files `SendUserFile` handed over, off the carrying line's `attachments`.
 *
 * Same defensive shape as the two above: every field is read from a transcript,
 * so an entry without a `path` is dropped rather than passed on as a row with
 * nothing to open. `isImage` defaults to false and the rest to null — a viewer
 * saying "unknown size" is right, one saying "0 bytes" is not.
 */
function toSentAttachments(raw: unknown): SentAttachment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SentAttachment[] = [];
  for (const entry of raw) {
    if (!isRec(entry)) continue;
    const filePath = str(entry.path);
    if (!filePath) continue;
    out.push({
      path: filePath,
      sizeBytes: num(entry.size) ?? null,
      isImage: entry.isImage === true,
      mediaType: str(entry.media_type),
      pathValidated: typeof entry.pathValidated === 'boolean' ? entry.pathValidated : null,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * What the user did with a plan, off the `ExitPlanMode` result line.
 *
 * The two answers are two different types, not two shapes of one: approving
 * writes an object, refusing writes the generic rejection string. So the type
 * IS the verdict, and reading the prose (which starts "User has approved your
 * plan…" either way round) is never necessary.
 */
function toPlanOutcome(raw: unknown, line: RawLine): PlanOutcome | null {
  if (isRec(raw)) {
    return { status: 'approved', text: str(raw.plan), filePath: str(raw.filePath), feedback: null };
  }
  if (typeof raw === 'string') {
    return { status: 'rejected', text: null, filePath: null, feedback: planFeedback(raw, line) };
  }
  return null;
}

/** The generic refusal, which says nothing about why and is not feedback. */
const GENERIC_REFUSAL = /^(The user declined\.|The user doesn't want to proceed with this tool use)/;

/**
 * What the user said instead of approving, from whichever of the two places
 * this refusal used.
 *
 * A refusal typed in the terminal writes `userFeedback` beside
 * `toolDenialKind: "user-rejected"`. One sent from this app does NOT: a
 * `canUseTool` deny is recorded as `permission-rule` with no such field, and the
 * message travels inside `toolUseResult` as `"Error: <message>"` — verified end
 * to end against a real session. Reading only the field lost every note sent
 * from here, which is precisely the half of the exchange the card exists to
 * show.
 */
export function planFeedback(raw: string, line: RawLine): string | null {
  const explicit = str(line.userFeedback);
  if (explicit) return explicit;
  const text = raw.replace(/^Error:\s*/, '').trim();
  return text && !GENERIC_REFUSAL.test(text) ? text : null;
}

type PlanModeEvent = Extract<ContentBlock, { kind: 'plan-mode' }>['event'];

/**
 * Which plan-mode event an `attachment` line is, or null for the ones that are
 * not plan mode at all (`queued_command` and the context deltas).
 *
 * `plan_mode_exit` is the trap: it is written 60 times in this corpus against 11
 * entries, because Claude Code also emits one on the first prompt of every CLI
 * run — sessions that never planned included. Taken at face value the viewer
 * would announce a departure from a mode nothing ever entered, so an exit
 * counts only while an entry is open, which is what `open` is for.
 */
function planModeEvent(attachment: Record<string, unknown> | null, open: boolean): PlanModeEvent | null {
  switch (attachment?.type) {
    case 'plan_mode':
      return 'enter';
    case 'plan_mode_reentry':
      return 'reentry';
    case 'plan_mode_exit':
      return open ? 'exit' : null;
    // The plan re-injected so it survives a compaction — the only one carrying
    // the markdown itself, and it always lands beside a `compact_boundary`.
    case 'plan_file_reference':
      return 'reference';
    default:
      return null;
  }
}

/** The first `# heading` of a plan: what names it in a collapsed header or a list. */
export function planTitle(markdown: string): string | null {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : null;
}

function buildResult(
  c: Record<string, unknown>,
  projectsDir: string,
  persistedOutputPath: string | null,
  answers: Record<string, string> | null,
  annotations: Record<string, { preview?: string; notes?: string }> | null,
  response: string | null,
  plan: PlanOutcome | null,
  attachments: SentAttachment[] | null,
): ToolResultInfo {
  let text = extractResultText(c.content);
  const totalChars = text.length;
  const truncated = totalChars > MAX_RESULT_CHARS;
  if (truncated) text = text.slice(0, MAX_RESULT_CHARS);
  // Large outputs are offloaded to <session-dir>/tool-results/<name>.txt.
  // Primary source: the structured toolUseResult.persistedOutputPath on the
  // carrying line ("<persisted-output>...Full output saved to: <abs path>").
  // Fallback: the in-text reference (may even point into ANOTHER session's
  // dir when a subagent report quotes it). Kept projects-relative.
  let offloadedFile: string | null = null;
  if (persistedOutputPath && text.includes('<persisted-output>')) {
    offloadedFile = toProjectsRelative(persistedOutputPath, projectsDir);
  }
  if (!offloadedFile) {
    const m = /output saved to: (.+?[\\/]tool-results[\\/][^\s\\/"]+\.txt)/i.exec(text);
    if (m) offloadedFile = toProjectsRelative(m[1], projectsDir);
  }
  return {
    text,
    truncated,
    totalChars,
    isError: c.is_error === true,
    offloadedFile,
    answers,
    annotations,
    response,
    plan,
    attachments,
  };
}

/** One-line human summary of a tool invocation for the collapsed header. */
function summarizeInput(toolName: string, input: unknown): string {
  if (!isRec(input)) return '';
  const first = (...keys: string[]): string => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return '';
  };
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      return first('command');
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return first('file_path', 'notebook_path');
    case 'Glob':
    case 'Grep':
      return first('pattern');
    case 'Task':
    case 'Agent':
      return first('description', 'prompt');
    case 'WebFetch':
    case 'WebSearch':
      return first('url', 'query');
    // The input is the whole plan — up to 25 KB of markdown — so the default
    // below would stringify all of it into a one-line collapsed header. Its
    // first heading is what actually names it. (Newer Claude Code writes the
    // plan to the plan file and sends no input at all, hence the empty case.)
    case 'ExitPlanMode': {
      const plan = first('plan');
      return plan ? (planTitle(plan) ?? plan.slice(0, 120)) : '';
    }
    // Same trap as the plan above: the default would stringify the whole
    // questions array, and an option's `preview` is a drawing of up to 19 lines
    // — 58 of them in this corpus, so the collapsed header of a question with
    // previews was several KB of box-drawing characters on one line. What names
    // the call is what was asked.
    case 'AskUserQuestion': {
      const questions = Array.isArray(input.questions) ? input.questions : [];
      const asked = questions.map((q) => (isRec(q) ? str(q.question) : null)).filter((q): q is string => !!q);
      if (asked.length === 0) return '';
      return asked.length === 1 ? asked[0] : `${asked[0]} (+${String(asked.length - 1)} more)`;
    }
    // The paths are absolute and long — three of them run past 400 characters,
    // all sharing the same scratchpad prefix, so the default would fill the
    // header with the same directory written three times. The filenames are what
    // tells one delivery from another; the card below shows the whole paths.
    case 'SendUserFile': {
      const files = Array.isArray(input.files) ? input.files : [];
      const names = files
        .map((f) => (typeof f === 'string' ? (f.split(/[\\/]/).pop() ?? '') : ''))
        .filter((n) => n.length > 0);
      return names.join(', ');
    }
    default: {
      const s = first('description', 'command', 'file_path', 'pattern', 'query', 'url', 'prompt');
      if (s) return s;
      try {
        const json = JSON.stringify(input);
        return json === '{}' ? '' : json;
      } catch {
        return '';
      }
    }
  }
}

export interface ParsedTranscript {
  turns: Turn[];
  prLinks: PrLink[];
  /** From `forkedFrom`: the session this transcript's opening context was copied from. */
  forkedFrom: string | null;
  fileChanges: FileChange[];
}

/**
 * One line of the transcript, as the message tree sees it. Positions, not uuids:
 * a replayed line repeats its uuid, and which occurrence an edge meant depends on
 * where in the file it was written.
 */
interface TreeLine {
  uuid: string;
  /** `parentUuid`, or `logicalParentUuid` when a compaction left the first null. */
  parentRef: string | null;
  isBoundary: boolean;
}

/**
 * Which messages a `/rewind` left behind.
 *
 * Every line names its predecessor in `parentUuid`, so a transcript is a tree,
 * not a list — and a rewind is a second child: the abandoned branch stays in the
 * file forever and the new prompt hangs off the message the user went back to.
 * Claude Code renders only the branch still alive (verified: it showed none of
 * the 72 rewound lines of `c0f70eda`, which sit in the middle of the file), and
 * that branch is the one ending at the LAST line written. Trusting the
 * `last-prompt` sidecar instead is what Claude Code itself gets wrong — after
 * that rewind its `leafUuid` still pointed at the tail of the discarded branch.
 *
 * Three things were each bought with a wrong answer on real data:
 *
 * - **A compaction breaks `parentUuid`** (null on the boundary, 56 of 56 in this
 *   corpus) and `logicalParentUuid` is the bridge back. Without it the walk stops
 *   at the last compaction: 99.9% of `cae7f9f5` came out "discarded".
 * - **An edge resolves to the LAST occurrence of the parent before it**, because
 *   a replayed stretch repeats uuids verbatim and the conversation then continues
 *   from the COPY. Resolving to the first occurrence re-attached that edge a day
 *   and a thousand lines earlier and made the real conversation in between look
 *   abandoned — 2,147 lines of `0f5b1c8b`.
 * - **A branch holding a compaction boundary is never folded away.** A boundary
 *   is Claude Code stating that this stretch BECAME the context that followed, so
 *   it happened, whatever the tree says; and the viewer's "earlier context"
 *   sections are built from those very lines. This is what keeps the two big
 *   stretches of `0f5b1c8b` (4,163 lines) visible.
 *
 * Anything the walk cannot reach at all — a parent that is not in the file, which
 * happens in 3 sessions here — is left ALONE rather than hidden: showing an
 * abandoned message is a much smaller error than hiding a real one.
 *
 * The answer is a uuid → BRANCH map, not a flat set: rewinding twice to the same
 * message leaves two separate branches hanging off it, and they are two different
 * pieces of history. `c0f70eda` has exactly that — `/review PR 1968` (15:21, 9
 * turns) and `Estado actual?` (17:38, 2 turns) both hang off `277ac189`, with the
 * live conversation as its third child — and merging them read as one 11-turn
 * stretch running 15:21 → 17:39, which is a span nothing ever occupied.
 */
function discardedBranches(lines: TreeLine[]): Map<string, string> {
  /** uuid → the uuid of the line that starts the branch it was cut away with. */
  const discarded = new Map<string, string>();
  if (lines.length === 0) return discarded;

  const occurrences = new Map<string, number[]>();
  for (const [i, line] of lines.entries()) {
    const at = occurrences.get(line.uuid);
    if (at) at.push(i);
    else occurrences.set(line.uuid, [i]);
  }

  const parentAt = new Array<number>(lines.length).fill(-1);
  const children = new Map<number, number[]>();
  for (const [i, line] of lines.entries()) {
    if (!line.parentRef) continue;
    const at = occurrences.get(line.parentRef);
    if (!at) continue; // parent not in this file — the walk simply stops here
    let best = -1;
    for (const q of at) if (q < i && q > best) best = q;
    parentAt[i] = best;
    if (best >= 0) {
      const list = children.get(best);
      if (list) list.push(i);
      else children.set(best, [i]);
    }
  }

  const live = new Set<number>();
  for (let at = lines.length - 1; at >= 0 && !live.has(at); at = parentAt[at]) live.add(at);

  /** Line position → the branch it belongs to (the position that starts it). */
  const branchOf = new Map<number, number>();
  for (const i of live) {
    for (const child of children.get(i) ?? []) {
      if (live.has(child)) continue;
      // Collect the whole abandoned subtree first: the decision below is about
      // the branch, not about one line of it.
      const branch: number[] = [];
      const queue = [child];
      const seen = new Set<number>();
      while (queue.length > 0) {
        const at = queue.pop()!;
        if (seen.has(at)) continue;
        seen.add(at);
        branch.push(at);
        for (const next of children.get(at) ?? []) queue.push(next);
      }
      if (branch.some((at) => lines[at].isBoundary)) continue;
      for (const at of branch) branchOf.set(at, child);
    }
  }

  // A message is discarded only when NO copy of it is alive: a replay of a live
  // line is still that line.
  for (const [uuid, at] of occurrences) {
    if (at.some((i) => live.has(i))) continue;
    const cut = at.find((i) => branchOf.has(i));
    if (cut !== undefined) discarded.set(uuid, lines[branchOf.get(cut)!].uuid);
  }
  return discarded;
}

const MAX_EDIT_CHARS = 4000;

function editString(value: unknown): { text: string | null; truncated: boolean } {
  if (typeof value !== 'string') return { text: null, truncated: false };
  return value.length > MAX_EDIT_CHARS
    ? { text: value.slice(0, MAX_EDIT_CHARS), truncated: true }
    : { text: value, truncated: false };
}

/** Record file mutations from Edit/Write/NotebookEdit (and MultiEdit) tool calls. */
function recordFileEdits(
  changes: Map<string, FileEdit[]>,
  toolName: string,
  input: Record<string, unknown>,
  timestamp: string | null,
): void {
  const filePath = str(input.file_path) ?? str(input.notebook_path);
  if (!filePath) return;
  const list = changes.get(filePath) ?? [];
  const push = (oldValue: unknown, newValue: unknown) => {
    const oldS = editString(oldValue);
    const newS = editString(newValue);
    list.push({
      tool: toolName,
      timestamp,
      oldString: oldS.text,
      newString: newS.text,
      truncated: oldS.truncated || newS.truncated,
    });
  };
  if (toolName === 'Write') {
    push(null, input.content);
  } else if (Array.isArray(input.edits)) {
    // MultiEdit-style: several {old_string, new_string} in one call
    for (const e of input.edits) {
      if (isRec(e)) push(e.old_string, e.new_string);
    }
  } else {
    push(input.old_string, input.new_string ?? input.new_source);
  }
  changes.set(filePath, list);
}

/**
 * Full parse of a transcript (session or subagent file — same format) into
 * renderable turns. Turn boundary = a real (non-meta) user message; assistant
 * lines sharing message.id (streamed chunks) merge into one item.
 */
export async function parseTranscript(
  filePath: string,
  agentIdByToolUse: Map<string, string>,
  projectsDir: string,
): Promise<ParsedTranscript> {
  const turns: Turn[] = [];
  const prLinks: PrLink[] = [];
  /** Every uuid-bearing line, in file order — replayed copies included. See `discardedUuids`. */
  const treeLines: TreeLine[] = [];
  let forkedFrom: string | null = null;
  const toolBlocksById = new Map<string, ToolBlock>();
  const assistantItems = new Map<string, MessageItem>();
  const fileEdits = new Map<string, FileEdit[]>();
  const MUTATING_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
  const isReplay = replayFilter();
  let current: Turn | null = null;
  let fallbackId = 0;
  /** Whether a `plan_mode` entry is still open — see `planModeEvent`. */
  let planModeOpen = false;

  const newTurn = (promptId: string | null): Turn => {
    current = { promptId, items: [] };
    turns.push(current);
    return current;
  };
  const ensureTurn = (): Turn => current ?? newTurn(null);
  const makeUuid = (o: RawLine): string => str(o.uuid) ?? `${GEN_UUID_PREFIX}${fallbackId++}`;
  /** The last item emitted: every push goes into the last turn. */
  const lastItem = (): MessageItem | null => {
    const turn = turns[turns.length - 1];
    return turn && turn.items.length > 0 ? turn.items[turn.items.length - 1] : null;
  };

  /** An item with everything a line gives us and nothing a caller must decide. */
  const blankItem = (o: RawLine, carriedOver: boolean, runId: string | null): MessageItem => ({
    uuid: makeUuid(o),
    aliasUuids: [],
    role: 'system',
    timestamp: str(o.timestamp),
    endTimestamp: str(o.timestamp),
    model: null,
    isMeta: false,
    isCompactSummary: false,
    queued: false,
    systemSubtype: null,
    permissionMode: str(o.permissionMode),
    carriedOver,
    runId,
    discardedBranch: null,
    usage: null,
    effort: null,
    blocks: [],
  });

  /**
   * Something Claude Code injected into the conversation — today an Agent or a
   * background command reporting back. It OPENS a turn, because a real exchange
   * follows it, EXCEPT when the turn it would open was itself opened by one:
   * agents that finish together are delivered back to back (three in a row in
   * `980751cb`), and a turn each would leave all but the last holding nothing
   * but the news. Only notice-after-notice merges, so nothing can ever swallow a
   * prompt or an answer.
   */
  const pushNotice = (o: RawLine, origin: string, content: string, carriedOver: boolean, runId: string | null): void => {
    const previous = lastItem();
    const turn = previous?.blocks[0]?.kind === 'notice' ? ensureTurn() : newTurn(str(o.promptId));
    turn.items.push({
      uuid: makeUuid(o),
      aliasUuids: [],
      role: 'system',
      timestamp: str(o.timestamp),
      endTimestamp: str(o.timestamp),
      model: null,
      isMeta: false,
      isCompactSummary: false,
      queued: false,
      systemSubtype: origin,
      permissionMode: str(o.permissionMode),
      carriedOver,
      runId,
      discardedBranch: null,
      usage: null,
      effort: null,
      blocks: [{ kind: 'notice', origin, ...parseNotification(content) }],
    });
  };

  for await (const line of streamLines(filePath)) {
    const o = safeParse(line);
    if (!o) continue;
    const type = str(o.type);

    if (type === 'pr-link') {
      // Sidecar lines are re-appended over the session's life — dedupe by URL.
      const prNumber = num(o.prNumber);
      const prUrl = str(o.prUrl);
      if (prNumber !== null && prUrl && !prLinks.some((p) => p.prUrl === prUrl)) {
        prLinks.push({ prNumber, prUrl, prRepository: str(o.prRepository) ?? '' });
      }
      continue;
    }

    // The message tree is recorded BEFORE anything is dropped: it needs the lines
    // that render nothing (attachments — one was a rewind target — and
    // turn_duration) AND the replayed copies, since an edge written after a replay
    // points at the copy and not at the original.
    const lineUuid = str(o.uuid);
    if (lineUuid) {
      treeLines.push({
        uuid: lineUuid,
        parentRef: str(o.parentUuid) ?? str(o.logicalParentUuid),
        isBoundary: str(o.subtype) === 'compact_boundary',
      });
    }

    // A line already parsed, re-appended by a compaction (see `replayFilter`).
    // It has to go before anything else touches it: an assistant chunk would
    // otherwise be merged by `message.id` into the item written days earlier and
    // append its text to it a second time.
    if (isReplay(o)) continue;

    const fork = isRec(o.forkedFrom) ? str(o.forkedFrom.sessionId) : null;
    if (fork) forkedFrom ??= fork;
    const carriedOver = fork !== null;
    // The run that wrote this line, not an ancestor — see `MessageItem.runId`.
    const runId = str(o.session_id);

    if (type === 'user') {
      if (!isRec(o.message)) continue;
      // `/context` is re-injected as an isMeta line: the only record of the
      // window size and of the per-category split. So is a notification
      // delivered INSIDE a subagent transcript, which is how an agent learns
      // that an agent of its own has finished — 4 of the 37 notifications in
      // subagent files here are written that way, and not one of the 69 in a
      // session file is. Dropping every isMeta line took those reports with it,
      // which is why the nested agents of `15a86025` had a report nowhere.
      // Everything else isMeta is still noise (69 of 73 carry no `origin` at
      // all, so this test is exact).
      if (o.isMeta === true) {
        const meta = str(o.message.content);
        const injected = meta ? injectedOrigin(o) : null;
        if (meta && injected) {
          pushNotice(o, injected, meta, carriedOver, runId);
          continue;
        }
        const snapshot = meta ? parseContextSnapshot(meta) : null;
        if (snapshot) {
          ensureTurn().items.push({
            uuid: makeUuid(o),
            aliasUuids: [],
            role: 'system',
            timestamp: str(o.timestamp),
            endTimestamp: str(o.timestamp),
            model: null,
            isMeta: false,
            isCompactSummary: false,
            queued: false,
            systemSubtype: 'context',
            permissionMode: str(o.permissionMode),
            carriedOver,
            runId,
            discardedBranch: null,
            usage: null,
            effort: null,
            blocks: [{ kind: 'context', snapshot }],
          });
        }
        continue;
      }
      const content = o.message.content;

      if (typeof content === 'string') {
        // Injected by Claude Code, not typed: a background command reporting
        // back wears the `user` role and carries a plain string, so it drew a
        // prompt bubble nobody wrote. It still opens a turn — an exchange really
        // follows it — but as what it is, and `isPromptItem` stops counting it.
        const injected = injectedOrigin(o);
        if (injected) {
          pushNotice(o, injected, content, carriedOver, runId);
          continue;
        }
        const prompt = extractPrompt(content);
        if (!prompt) continue; // local-command stdout noise
        // A compaction replays the command that caused it into the fresh
        // context, keeping its ORIGINAL timestamp — so `/compact` is written
        // twice: once as the plain text that was typed, before the boundary,
        // and once as a `<command-name>` line after the summary. Verified on
        // both boundaries of f3384d17 (14:59:47 typed, 15:02:09 summary,
        // 14:59:47 replay). Drop the replay: the real one is already in the
        // transcript, on the side of the boundary where it happened.
        const previous = lastItem();
        if (
          prompt.isSlashCommand &&
          previous?.isCompactSummary &&
          (!str(o.timestamp) || !previous.timestamp || str(o.timestamp)! <= previous.timestamp)
        ) {
          continue;
        }
        newTurn(str(o.promptId)).items.push({
          uuid: makeUuid(o),
          aliasUuids: [],
          role: 'user',
          timestamp: str(o.timestamp),
          endTimestamp: str(o.timestamp),
          model: null,
          isMeta: false,
          // The compaction summary comes down this very path: a `user` line with
          // string content, indistinguishable from a typed prompt without it.
          isCompactSummary: o.isCompactSummary === true,
          queued: false,
          systemSubtype: null,
          permissionMode: str(o.permissionMode),
          carriedOver,
          runId,
          discardedBranch: null,
          usage: null,
          effort: null,
          blocks: [prompt.isSlashCommand ? { kind: 'command', text: prompt.text } : { kind: 'text', text: prompt.text }],
        });
      } else if (Array.isArray(content)) {
        const persistedOutputPath = isRec(o.toolUseResult) ? str(o.toolUseResult.persistedOutputPath) : null;
        // Guarded by tool name below: `answers` means what it means only on an
        // AskUserQuestion result, and a decline writes the line's whole prose
        // into `toolUseResult` as a character-keyed object (2 lines here).
        const askedAnswers = isRec(o.toolUseResult) ? toAnswers(o.toolUseResult.answers) : null;
        const askedAnnotations = isRec(o.toolUseResult) ? toAnnotations(o.toolUseResult.annotations) : null;
        const askedResponse = isRec(o.toolUseResult) ? str(o.toolUseResult.response) : null;
        // Guarded by tool name for the same reason: an object `toolUseResult`
        // means "approved" only on an ExitPlanMode result — everywhere else it
        // is just the structured output of whatever tool ran.
        const planOutcome = toPlanOutcome(o.toolUseResult, o);
        // And the same again: plenty of tools write an `attachments` array, and
        // only on a SendUserFile result does it mean "these were handed over".
        const sentAttachments = isRec(o.toolUseResult) ? toSentAttachments(o.toolUseResult.attachments) : null;
        const userBlocks: ContentBlock[] = [];
        for (const c of content) {
          if (!isRec(c)) continue;
          if (c.type === 'tool_result') {
            const toolUseId = str(c.tool_use_id);
            const tool = toolUseId ? toolBlocksById.get(toolUseId) : undefined;
            if (tool) {
              tool.result = buildResult(
                c,
                projectsDir,
                persistedOutputPath,
                tool.toolName === 'AskUserQuestion' ? askedAnswers : null,
                tool.toolName === 'AskUserQuestion' ? askedAnnotations : null,
                tool.toolName === 'AskUserQuestion' ? askedResponse : null,
                tool.toolName === 'ExitPlanMode' ? planOutcome : null,
                tool.toolName === 'SendUserFile' ? sentAttachments : null,
              );
            }
          } else if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
            userBlocks.push({ kind: 'text', text: c.text });
          } else if (c.type === 'image') {
            const source = isRec(c.source) ? c.source : null;
            userBlocks.push({
              kind: 'image',
              mediaType: source ? str(source.media_type) : null,
              // Only a base64 source carries the bytes; anything else is a
              // reference we have no way to resolve from a transcript line.
              data: source && source.type === 'base64' ? str(source.data) : null,
            });
          }
        }
        if (userBlocks.length > 0) {
          newTurn(str(o.promptId)).items.push({
            uuid: makeUuid(o),
            aliasUuids: [],
            role: 'user',
            timestamp: str(o.timestamp),
            endTimestamp: str(o.timestamp),
            model: null,
            isMeta: false,
            isCompactSummary: false,
            queued: false,
            systemSubtype: null,
            permissionMode: str(o.permissionMode),
            carriedOver,
            runId,
            discardedBranch: null,
            usage: null,
            effort: null,
            blocks: userBlocks,
          });
        }
      }
    } else if (type === 'attachment') {
      // Anything that lands while a turn is in flight is QUEUED, and comes back
      // in another envelope: an `attachment` line whose `queued_command` prompt
      // holds it. It arrives in two flavours and BOTH are messages.
      //
      // A `<task-notification>` — reading only the `user` lines left THREE of
      // the five agent reports in `980751cb` rendered nowhere at all, not even
      // as a summary line.
      const attachment = isRec(o.attachment) ? o.attachment : null;

      // Plan mode announces itself here, and this is the only record of it that
      // has a clock: the `permission-mode` sidecar carries no timestamp and no
      // uuid, so it can only ever be read positionally.
      const planEvent = planModeEvent(attachment, planModeOpen);
      if (planEvent) {
        planModeOpen = planEvent === 'exit' ? false : planEvent !== 'reference';
        // It joins the turn already open rather than starting one: the entry is
        // written with the SAME timestamp as the prompt that entered plan mode,
        // so it belongs to that exchange, and a turn of its own would cut the
        // conversation where nothing happened.
        ensureTurn().items.push({
          ...blankItem(o, carriedOver, runId),
          role: 'system',
          systemSubtype: 'plan-mode',
          blocks: [
            {
              kind: 'plan-mode',
              event: planEvent,
              planFilePath: str(attachment?.planFilePath),
              planExists: typeof attachment?.planExists === 'boolean' ? attachment.planExists : null,
              planContent: str(attachment?.planContent),
            },
          ],
        });
        continue;
      }

      const queued = attachment?.type === 'queued_command' ? str(attachment.prompt) : null;
      if (queued?.includes(`<${NOTIFICATION_ORIGIN}>`)) {
        pushNotice(o, NOTIFICATION_ORIGIN, queued, carriedOver, runId);
        continue;
      }
      // Or a prompt the user typed while Claude was working. `queuedPrompt` is
      // what tells the two apart, and the reason it does not reuse
      // `injectedOrigin` is written there.
      const typed = queuedPrompt(o);
      const prompt = typed ? extractPrompt(typed) : null;
      if (!prompt) continue;
      // It joins the turn already open (`ensureTurn`) instead of starting one,
      // because that is what Claude Code does with it: the `last-prompt` sidecar
      // written straight after delivery still names the PREVIOUS prompt, in both
      // cases here. A turn of its own also cut the conversation in half at a
      // point nothing had ended — in `b343d4ac` the line lands between a
      // `tool_result` and three more `tool_use` calls of the same piece of work,
      // and splitting that run in two invented a boundary the session never had.
      // The viewer draws it on the rail with the answers, as the interjection it
      // is. `promptId` is absent from these lines anyway, so nothing is lost.
      ensureTurn().items.push({
        uuid: makeUuid(o),
        aliasUuids: [],
        role: 'user',
        // When it was TYPED, which is before the answer above it ended — see
        // `MessageItem.queued`. 39 s earlier in `15a86025`.
        timestamp: str(o.timestamp),
        endTimestamp: str(o.timestamp),
        model: null,
        isMeta: false,
        isCompactSummary: false,
        queued: true,
        systemSubtype: null,
        permissionMode: str(o.permissionMode),
        carriedOver,
        runId,
        discardedBranch: null,
        usage: null,
        effort: null,
        blocks: [prompt.isSlashCommand ? { kind: 'command', text: prompt.text } : { kind: 'text', text: prompt.text }],
      });
    } else if (type === 'assistant') {
      if (!isRec(o.message)) continue;
      const messageId = str(o.message.id) ?? makeUuid(o);
      let item = assistantItems.get(messageId);
      if (!item) {
        const model = str(o.message.model);
        const synthetic = model === '<synthetic>';
        item = {
          uuid: makeUuid(o),
          aliasUuids: [],
          role: 'assistant',
          timestamp: str(o.timestamp),
          endTimestamp: str(o.timestamp),
          model: synthetic ? null : model,
          isMeta: false,
          isCompactSummary: false,
          queued: false,
          systemSubtype: null,
          permissionMode: str(o.permissionMode),
          carriedOver,
          runId,
          discardedBranch: null,
          // A synthetic message was not produced by a model and is excluded from
          // every total; an id-less line has no dedupe key, so counting it could
          // multiply a streamed message across its chunks.
          usage:
            !synthetic && model && str(o.message.id) && isRec(o.message.usage)
              ? toMessageUsage(o.message.usage)
              : null,
          effort: str(o.effort),
          blocks: [],
        };
        assistantItems.set(messageId, item);
        ensureTurn().items.push(item);
      } else {
        const u = str(o.uuid);
        if (u) item.aliasUuids.push(u);
        // Chunks arrive in order, so the newest line is the end of the answer.
        item.endTimestamp = str(o.timestamp) ?? item.endTimestamp;
      }
      if (Array.isArray(o.message.content)) {
        for (const c of o.message.content) {
          if (!isRec(c)) continue;
          if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
            item.blocks.push({ kind: 'text', text: c.text });
          } else if (c.type === 'thinking' && typeof c.thinking === 'string' && c.thinking.trim()) {
            item.blocks.push({ kind: 'thinking', text: c.thinking });
          } else if (c.type === 'tool_use') {
            const toolUseId = str(c.id) ?? '';
            const toolName = str(c.name) ?? 'tool';
            const block: ToolBlock = {
              kind: 'tool',
              toolName,
              toolUseId,
              inputSummary: summarizeInput(toolName, c.input),
              input: c.input ?? null,
              result: null,
              agentId: agentIdByToolUse.get(toolUseId) ?? null,
            };
            item.blocks.push(block);
            if (toolUseId) toolBlocksById.set(toolUseId, block);
            if (MUTATING_TOOLS.has(toolName) && isRec(c.input)) {
              recordFileEdits(fileEdits, toolName, c.input, str(o.timestamp));
            }
          }
        }
      }
    } else if (type === 'system') {
      const subtype = str(o.subtype) ?? '';
      if (subtype === 'turn_duration') continue; // per-turn timing noise
      if (subtype === 'compact_boundary') {
        // The one place a compaction is stated outright, with what it cost:
        // everything else can only be inferred from the context dropping.
        const meta = isRec(o.compactMetadata) ? o.compactMetadata : {};
        const preserved = isRec(meta.preservedMessages) ? meta.preservedMessages : null;
        ensureTurn().items.push({
          uuid: makeUuid(o),
          aliasUuids: [],
          role: 'system',
          timestamp: str(o.timestamp),
          endTimestamp: str(o.timestamp),
          model: null,
          isMeta: false,
          isCompactSummary: false,
          queued: false,
          systemSubtype: subtype,
          permissionMode: str(o.permissionMode),
          carriedOver,
          runId,
          discardedBranch: null,
          usage: null,
          effort: null,
          blocks: [
            {
              kind: 'compact',
              boundary: {
                trigger: str(meta.trigger),
                preTokens: num(meta.preTokens),
                postTokens: num(meta.postTokens),
                droppedTokens: num(meta.cumulativeDroppedTokens),
                durationMs: num(meta.durationMs),
                preservedMessages: Array.isArray(preserved?.uuids) ? preserved.uuids.length : null,
              },
            },
          ],
        });
        continue;
      }
      const text = str(o.content)
        ?.replace(/<\/?local-command-(?:stdout|stderr)>/g, '')
        .trim();
      if (!text) continue;
      // The same figures arrive twice: this ANSI grid and the markdown line the
      // snapshot is parsed from. Escape codes are all the viewer could show.
      if (isContextUsageAnsi(text)) continue;
      ensureTurn().items.push({
        uuid: makeUuid(o),
        aliasUuids: [],
        role: 'system',
        timestamp: str(o.timestamp),
        endTimestamp: str(o.timestamp),
        model: null,
        isMeta: o.isMeta === true,
        isCompactSummary: false,
        queued: false,
        systemSubtype: subtype,
        permissionMode: str(o.permissionMode),
        carriedOver,
        runId,
        discardedBranch: null,
        usage: null,
        effort: null,
        blocks: [{ kind: 'text', text }],
      });
    }
  }

  // What a rewind cut away, marked only once the whole tree is known. An item with
  // no line uuid at all (a generated fallback id) is left alone: nothing places it,
  // and a wrongly hidden message is worse than a wrongly shown one.
  const cutAway = discardedBranches(treeLines);
  if (cutAway.size > 0) {
    for (const turn of turns) {
      for (const item of turn.items) {
        // `makeUuid` invents a `gen-` id for a line that carried none; those are
        // not in the tree and must not decide anything.
        const real = [item.uuid, ...item.aliasUuids].filter((u) => !u.startsWith(GEN_UUID_PREFIX));
        if (real.length > 0 && real.every((u) => cutAway.has(u))) {
          item.discardedBranch = cutAway.get(item.uuid) ?? cutAway.get(real[0]) ?? null;
        }
      }
    }
  }

  const fileChanges: FileChange[] = [...fileEdits.entries()]
    .map(([path, edits]) => ({ path, edits }))
    .sort((a, b) => b.edits.length - a.edits.length);

  return { turns, prLinks, forkedFrom, fileChanges };
}

export async function parseSession(
  scanned: ScannedSession,
  summary: SessionSummary,
  projectsDir: string,
): Promise<SessionDetail> {
  const subagents = await loadSubagents(scanned.sessionDir);
  const agentIdByToolUse = new Map(subagents.filter((a) => a.toolUseId).map((a) => [a.toolUseId, a.agentId]));
  const { turns, prLinks, forkedFrom, fileChanges } = await parseTranscript(
    scanned.filePath,
    agentIdByToolUse,
    projectsDir,
  );
  return {
    summary,
    turns,
    subagents,
    ancestry: {
      // The enrichment may not have run yet; the parse just read the same field.
      forkedFrom: summary.enrichment?.forkedFrom ?? forkedFrom,
      descendants: summary.descendants,
    },
    prLinks: prLinks.length > 0 ? prLinks : (summary.enrichment?.prLinks ?? []),
    fileChanges,
  };
}
