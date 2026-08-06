import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  ContentBlock,
  MessageItem,
  PrLink,
  SessionDetail,
  SessionSummary,
  SubagentMeta,
  ToolResultInfo,
  Turn,
} from '@claude-history/shared';
import { isRec, num, safeParse, str, streamLines, type RawLine } from './jsonl.ts';
import type { ScannedSession } from './scanner.ts';
import { extractPrompt } from './summarizer.ts';

const MAX_RESULT_CHARS = 20_000;

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

function buildResult(
  c: Record<string, unknown>,
  projectsDir: string,
  persistedOutputPath: string | null,
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
  return { text, truncated, totalChars, isError: c.is_error === true, offloadedFile };
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
  originSessionIds: Set<string>;
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
  const originSessionIds = new Set<string>();
  const toolBlocksById = new Map<string, ToolBlock>();
  const assistantItems = new Map<string, MessageItem>();
  let current: Turn | null = null;
  let fallbackId = 0;

  const newTurn = (promptId: string | null): Turn => {
    current = { promptId, items: [] };
    turns.push(current);
    return current;
  };
  const ensureTurn = (): Turn => current ?? newTurn(null);
  const makeUuid = (o: RawLine): string => str(o.uuid) ?? `gen-${fallbackId++}`;

  for await (const line of streamLines(filePath)) {
    const o = safeParse(line);
    if (!o) continue;
    const type = str(o.type);

    if (type === 'pr-link') {
      const prNumber = num(o.prNumber);
      const prUrl = str(o.prUrl);
      if (prNumber !== null && prUrl) prLinks.push({ prNumber, prUrl, prRepository: str(o.prRepository) ?? '' });
      continue;
    }

    const originId = str(o.session_id);
    if (originId) originSessionIds.add(originId);

    if (type === 'user') {
      if (o.isMeta === true || !isRec(o.message)) continue;
      const content = o.message.content;

      if (typeof content === 'string') {
        const prompt = extractPrompt(content);
        if (!prompt) continue; // local-command stdout noise
        newTurn(str(o.promptId)).items.push({
          uuid: makeUuid(o),
          aliasUuids: [],
          role: 'user',
          timestamp: str(o.timestamp),
          model: null,
          isMeta: false,
          systemSubtype: null,
          blocks: [prompt.isSlashCommand ? { kind: 'command', text: prompt.text } : { kind: 'text', text: prompt.text }],
        });
      } else if (Array.isArray(content)) {
        const persistedOutputPath = isRec(o.toolUseResult) ? str(o.toolUseResult.persistedOutputPath) : null;
        const userBlocks: ContentBlock[] = [];
        for (const c of content) {
          if (!isRec(c)) continue;
          if (c.type === 'tool_result') {
            const toolUseId = str(c.tool_use_id);
            const tool = toolUseId ? toolBlocksById.get(toolUseId) : undefined;
            if (tool) tool.result = buildResult(c, projectsDir, persistedOutputPath);
          } else if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
            userBlocks.push({ kind: 'text', text: c.text });
          } else if (c.type === 'image') {
            userBlocks.push({ kind: 'image' });
          }
        }
        if (userBlocks.length > 0) {
          newTurn(str(o.promptId)).items.push({
            uuid: makeUuid(o),
            aliasUuids: [],
            role: 'user',
            timestamp: str(o.timestamp),
            model: null,
            isMeta: false,
            systemSubtype: null,
            blocks: userBlocks,
          });
        }
      }
    } else if (type === 'assistant') {
      if (!isRec(o.message)) continue;
      const messageId = str(o.message.id) ?? makeUuid(o);
      let item = assistantItems.get(messageId);
      if (!item) {
        const model = str(o.message.model);
        item = {
          uuid: makeUuid(o),
          aliasUuids: [],
          role: 'assistant',
          timestamp: str(o.timestamp),
          model: model === '<synthetic>' ? null : model,
          isMeta: false,
          systemSubtype: null,
          blocks: [],
        };
        assistantItems.set(messageId, item);
        ensureTurn().items.push(item);
      } else {
        const u = str(o.uuid);
        if (u) item.aliasUuids.push(u);
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
          }
        }
      }
    } else if (type === 'system') {
      const subtype = str(o.subtype) ?? '';
      if (subtype === 'turn_duration') continue; // per-turn timing noise
      const text = str(o.content);
      if (!text) continue;
      ensureTurn().items.push({
        uuid: makeUuid(o),
        aliasUuids: [],
        role: 'system',
        timestamp: str(o.timestamp),
        model: null,
        isMeta: o.isMeta === true,
        systemSubtype: subtype,
        blocks: [{ kind: 'text', text }],
      });
    }
  }

  return { turns, prLinks, originSessionIds };
}

export async function parseSession(
  scanned: ScannedSession,
  summary: SessionSummary,
  projectsDir: string,
): Promise<SessionDetail> {
  const subagents = await loadSubagents(scanned.sessionDir);
  const agentIdByToolUse = new Map(subagents.filter((a) => a.toolUseId).map((a) => [a.toolUseId, a.agentId]));
  const { turns, prLinks, originSessionIds } = await parseTranscript(scanned.filePath, agentIdByToolUse, projectsDir);
  originSessionIds.delete(scanned.id);
  return {
    summary,
    turns,
    subagents,
    ancestry: {
      resumedFrom: summary.enrichment?.resumedFrom ?? [...originSessionIds],
      descendants: summary.descendants,
    },
    prLinks: prLinks.length > 0 ? prLinks : (summary.enrichment?.prLinks ?? []),
  };
}
