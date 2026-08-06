// Domain types shared between server and web.
// Data model reference: see CLAUDE.md "Claude Code data format rules".

export type TitleSource =
  | 'custom-title'
  | 'ai-title'
  | 'agent-name'
  | 'last-prompt'
  | 'first-message'
  | 'uuid';

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface PrLink {
  prNumber: number;
  prUrl: string;
  prRepository: string;
}

export interface SessionEnrichment {
  userMessageCount: number;
  assistantMessageCount: number;
  turnCount: number;
  usage: UsageTotals;
  usageByModel: Record<string, UsageTotals>;
  models: string[];
  prLinks: PrLink[];
  resumedFrom: string[];
}

export interface LiveInfo {
  pid: number;
  status: string; // "idle" | "busy" | ...
  name: string | null;
  startedAt: number | null; // epoch ms
  updatedAt: number | null; // epoch ms
}

export interface SessionSummary {
  id: string; // session UUID (= jsonl filename base)
  encodedDir: string; // subdir name under ~/.claude/projects
  projectKey: string; // normalized (lowercase) real project path — grouping key
  projectPath: string; // real project path as recorded in `cwd` (display casing)
  projectName: string; // basename of projectPath, for the tag
  title: string;
  titleSource: TitleSource;
  createdAt: string | null; // ISO-8601
  lastActivityAt: string | null; // ISO-8601
  mtimeMs: number;
  sizeBytes: number;
  gitBranch: string | null;
  slug: string | null;
  entrypoint: string | null; // "cli" | "claude-desktop" | "claude-vscode"
  model: string | null; // last assistant model seen in tail
  claudeVersion: string | null;
  messageCount: number | null; // approx, from last turn_duration sidecar
  firstPromptPreview: string | null;
  lastPromptPreview: string | null;
  isEmpty: boolean; // throwaway stub (hidden by default)
  isBackground: boolean; // sessionKind === "bg"
  subagentCount: number;
  enrichment: SessionEnrichment | null;
  live: LiveInfo | null;
  // Sessions this one was resumed *into* (computed from reverse ancestry).
  descendants: string[];
}

export interface ProjectInfo {
  key: string; // normalized path
  path: string; // display path
  name: string; // basename
  color: string; // css color for the tag
  sessionCount: number;
  lastActivityMs: number;
}

// ---- Conversation detail (viewer) ----

export interface ToolResultInfo {
  text: string;
  truncated: boolean;
  totalChars: number;
  isError: boolean;
  /**
   * When output was offloaded to disk: path of the .txt file relative to
   * ~/.claude/projects (it may live under a DIFFERENT session's dir, e.g.
   * when a subagent report quotes it). Fetch via /api/tool-results?path=.
   */
  offloadedFile: string | null;
}

export type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'command'; text: string }
  | { kind: 'image' }
  | {
      kind: 'tool';
      toolName: string;
      toolUseId: string;
      inputSummary: string;
      input: unknown;
      result: ToolResultInfo | null;
      /** Set when this tool_use spawned a subagent (Task tool). */
      agentId: string | null;
    };

export interface MessageItem {
  uuid: string;
  /** Extra line uuids merged into this item (streamed assistant chunks). */
  aliasUuids: string[];
  role: 'user' | 'assistant' | 'system';
  timestamp: string | null;
  model: string | null;
  isMeta: boolean;
  /** system messages only */
  systemSubtype: string | null;
  blocks: ContentBlock[];
}

export interface Turn {
  promptId: string | null;
  items: MessageItem[];
}

export interface SubagentMeta {
  agentId: string;
  agentType: string;
  description: string;
  toolUseId: string;
  spawnDepth: number;
}

export interface SessionDetail {
  summary: SessionSummary;
  turns: Turn[];
  subagents: SubagentMeta[];
  ancestry: { resumedFrom: string[]; descendants: string[] };
  prLinks: PrLink[];
}

export interface SubagentDetail {
  meta: SubagentMeta;
  turns: Turn[];
}
