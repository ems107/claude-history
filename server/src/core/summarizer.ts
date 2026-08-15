import path from 'node:path';
import type { SessionSummary, TitleSource } from '@claude-history/shared';
import { headLines, isRec, num, safeParse, str, tailLines, type RawLine } from './jsonl.ts';
import { normalizeProjectKey } from './projects.ts';
import type { ScannedSession } from './scanner.ts';

// Cheap per-session metadata from head-25 + tail-40 lines only.
// Format rules: see CLAUDE.md "Claude Code data format rules".

const HEAD_N = 25;
const TAIL_N = 40;
const PREVIEW_LEN = 200;
/** Stub sessions observed at ≤16 lines / ≤~3 KB; leave margin for a couple of sidecar rewrites. */
const EMPTY_MAX_BYTES = 20_000;

function truncate(text: string, len: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= len ? clean : `${clean.slice(0, len - 1)}…`;
}

/**
 * What put a `user` line in the transcript, when it was not the human: the
 * `origin.kind` Claude Code stamps on it, or null when the user really typed it.
 *
 * The role says `user` and the content is a plain string, so nothing in the line
 * itself tells a typed prompt from something the harness injected — and 219 lines
 * in this corpus are injected, across 18 sessions (80 in one, 56 in another).
 * They are `<task-notification>` blocks: a background command finished, and
 * Claude Code hands the model the news the same way it hands it a prompt. Counted
 * as prompts they inflated one session's total from ~12 to 92.
 *
 * `origin.kind` is exact where it exists — all 219 carry it, not one is labelled
 * `human` — and absent only in older transcripts, which had no background tasks
 * to notify about. So: no `origin` means the human typed it (what this app always
 * assumed), and any kind other than `human` means it did not. `promptSource`
 * (`typed` / `queued` / `sdk` / `system`) is NOT the discriminator: a human prompt
 * sent through the SDK reads `sdk` there, and so do most notifications.
 */
export function injectedOrigin(o: RawLine): string | null {
  const kind = isRec(o.origin) ? str(o.origin.kind) : null;
  return kind === null || kind === 'human' ? null : kind;
}

/** The line a `<task-notification>` is worth showing: its own summary of itself. */
function notificationText(content: string): string {
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(content);
  return (summary?.[1] ?? content).trim();
}

/** Everything a `<task-notification>` carries besides its summary line. */
export interface ParsedNotification {
  text: string;
  taskId: string | null;
  toolUseId: string | null;
  status: string | null;
  result: string | null;
}

function tagged(content: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(content);
  const value = m?.[1].trim();
  return value ? value : null;
}

/**
 * The whole of a `<task-notification>`, not just the line it summarises itself
 * with. `<result>` is the report an Agent handed back and the parent transcript
 * records it NOWHERE else — the tool result of the call is boilerplate — so
 * keeping only the summary threw away 53 deliverables in this corpus, 1,076 KB
 * of them.
 *
 * `<task-id>` is the `agentId` when the task was an Agent; a background command
 * notifies through the same channel with an id that matches no transcript, so
 * the caller decides what is an agent by looking the id up, not by trusting it.
 */
export function parseNotification(content: string): ParsedNotification {
  return {
    text: notificationText(content),
    taskId: tagged(content, 'task-id'),
    toolUseId: tagged(content, 'tool-use-id'),
    status: tagged(content, 'status'),
    result: tagged(content, 'result'),
  };
}

/**
 * Classify a user message string. Slash commands arrive wrapped in
 * `<command-name>/foo</command-name>` XML; meta banners are filtered upstream
 * via isMeta. Returns null for content that is not a human-typed prompt.
 */
export function extractPrompt(content: string): { text: string; isSlashCommand: boolean } | null {
  const commandMatch = /<command-name>([^<]*)<\/command-name>/.exec(content);
  if (commandMatch) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(content);
    const text = `${commandMatch[1]}${args?.[1] ? ` ${args[1]}` : ''}`.trim();
    return text ? { text, isSlashCommand: true } : null;
  }
  if (content.startsWith('<local-command-stdout>')) return null;
  const text = content.trim();
  return text ? { text, isSlashCommand: false } : null;
}

interface Extracted {
  lastCustomTitle: string | null;
  lastAiTitle: string | null;
  lastAgentName: string | null;
  lastPrompt: string | null;
  firstTimestamp: string | null;
  snapshotTimestamp: string | null;
  lastTimestamp: string | null;
  cwd: string | null;
  gitBranch: string | null;
  slug: string | null;
  entrypoint: string | null;
  version: string | null;
  model: string | null;
  messageCount: number | null;
  firstPrompt: string | null;
  firstSlashCommand: string | null;
  hasRealPrompt: boolean;
  isBackground: boolean;
}

function extractFromLines(headParsed: RawLine[], tailParsed: RawLine[]): Extracted {
  const x: Extracted = {
    lastCustomTitle: null,
    lastAiTitle: null,
    lastAgentName: null,
    lastPrompt: null,
    firstTimestamp: null,
    snapshotTimestamp: null,
    lastTimestamp: null,
    cwd: null,
    gitBranch: null,
    slug: null,
    entrypoint: null,
    version: null,
    model: null,
    messageCount: null,
    firstPrompt: null,
    firstSlashCommand: null,
    hasRealPrompt: false,
    isBackground: false,
  };

  const visit = (o: RawLine, isHead: boolean): void => {
    const type = str(o.type);

    // Sidecar lines (last occurrence wins — they are re-appended per turn).
    switch (type) {
      case 'custom-title':
        x.lastCustomTitle = str(o.customTitle) ?? x.lastCustomTitle;
        return;
      case 'ai-title':
        x.lastAiTitle = str(o.aiTitle) ?? x.lastAiTitle;
        return;
      case 'agent-name':
        x.lastAgentName = str(o.agentName) ?? x.lastAgentName;
        return;
      case 'last-prompt':
        // Aborted sessions write this line without a lastPrompt key.
        x.lastPrompt = str(o.lastPrompt) ?? x.lastPrompt;
        return;
      case 'file-history-snapshot': {
        if (isHead && !x.snapshotTimestamp && isRec(o.snapshot)) {
          x.snapshotTimestamp = str(o.snapshot.timestamp);
        }
        return;
      }
      default:
        break;
    }

    // Message lines (user/assistant/system/attachment).
    const ts = str(o.timestamp);
    if (ts) {
      if (isHead && !x.firstTimestamp) x.firstTimestamp = ts;
      x.lastTimestamp = ts;
    }
    // First cwd wins: it is the launch directory (what /resume groups by);
    // later messages may record a different cwd if the session cd'd around.
    if (!x.cwd && str(o.cwd)) x.cwd = str(o.cwd);
    if (str(o.gitBranch)) x.gitBranch = str(o.gitBranch);
    if (str(o.slug)) x.slug = str(o.slug);
    if (str(o.entrypoint)) x.entrypoint = str(o.entrypoint);
    if (str(o.version)) x.version = str(o.version);
    if (str(o.sessionKind) === 'bg') x.isBackground = true;

    if (type === 'assistant' && isRec(o.message)) {
      const model = str(o.message.model);
      if (model && model !== '<synthetic>') x.model = model;
    }

    if (type === 'system' && str(o.subtype) === 'turn_duration') {
      const count = num(o.messageCount) ?? (isRec(o.content) ? num(o.content.messageCount) : null);
      if (count !== null) x.messageCount = count;
    }

    if (
      type === 'user' &&
      o.isMeta !== true &&
      isRec(o.message) &&
      typeof o.message.content === 'string' &&
      injectedOrigin(o) === null
    ) {
      const prompt = extractPrompt(o.message.content);
      if (prompt) {
        if (prompt.isSlashCommand) {
          if (isHead && !x.firstSlashCommand) x.firstSlashCommand = prompt.text;
        } else {
          x.hasRealPrompt = true;
          if (isHead && !x.firstPrompt) x.firstPrompt = prompt.text;
        }
      }
    }
  };

  // Head first, then tail: later assignments naturally implement "last wins".
  // On small files head and tail overlap; re-visiting is harmless.
  for (const o of headParsed) visit(o, true);
  for (const o of tailParsed) visit(o, false);
  return x;
}

export async function summarizeSession(
  scanned: ScannedSession,
  sessionProject: Map<string, string>,
): Promise<SessionSummary> {
  const [head, tail] = await Promise.all([
    headLines(scanned.filePath, HEAD_N),
    tailLines(scanned.filePath, TAIL_N),
  ]);
  const parse = (lines: string[]): RawLine[] => lines.map(safeParse).filter((o): o is RawLine => o !== null);
  const x = extractFromLines(parse(head), parse(tail));

  // Title precedence chain.
  let title: string;
  let titleSource: TitleSource;
  if (x.lastCustomTitle) {
    title = x.lastCustomTitle;
    titleSource = 'custom-title';
  } else if (x.lastAiTitle) {
    title = x.lastAiTitle;
    titleSource = 'ai-title';
  } else if (x.lastAgentName) {
    title = x.lastAgentName;
    titleSource = 'agent-name';
  } else if (x.lastPrompt) {
    title = truncate(x.lastPrompt, PREVIEW_LEN);
    titleSource = 'last-prompt';
  } else if (x.firstPrompt) {
    title = truncate(x.firstPrompt, PREVIEW_LEN);
    titleSource = 'first-message';
  } else if (x.firstSlashCommand) {
    title = truncate(x.firstSlashCommand, PREVIEW_LEN);
    titleSource = 'first-message';
  } else {
    title = scanned.id;
    titleSource = 'uuid';
  }

  // Real project path: cwd from messages, else the global history.jsonl map,
  // else fall back to the (lossy) encoded dir name.
  const realPath = x.cwd ?? sessionProject.get(scanned.id) ?? null;
  const projectPath = realPath ?? scanned.encodedDir;
  const projectKey = realPath ? normalizeProjectKey(realPath) : `encoded:${scanned.encodedDir.toLowerCase()}`;
  const projectName = realPath ? path.basename(projectPath) : scanned.encodedDir;

  const hasTitle = titleSource === 'custom-title' || titleSource === 'ai-title' || titleSource === 'agent-name';
  const isEmpty = !hasTitle && !x.hasRealPrompt && scanned.sizeBytes < EMPTY_MAX_BYTES;

  return {
    id: scanned.id,
    encodedDir: scanned.encodedDir,
    projectKey,
    projectPath,
    projectName,
    title,
    titleSource,
    originalTitle: null,
    createdAt: x.firstTimestamp ?? x.snapshotTimestamp ?? null,
    lastActivityAt: x.lastTimestamp ?? x.firstTimestamp ?? null,
    mtimeMs: scanned.mtimeMs,
    sizeBytes: scanned.sizeBytes,
    gitBranch: x.gitBranch,
    slug: x.slug,
    entrypoint: x.entrypoint,
    model: x.model,
    claudeVersion: x.version,
    messageCount: x.messageCount,
    firstPromptPreview: x.firstPrompt ? truncate(x.firstPrompt, PREVIEW_LEN) : null,
    lastPromptPreview: x.lastPrompt ? truncate(x.lastPrompt, PREVIEW_LEN) : null,
    isEmpty,
    isBackground: x.isBackground,
    pinned: false, // applied from userdata at serve time

    subagentCount: scanned.subagentCount,
    enrichment: null,
    live: null,
    descendants: [],
  };
}
