// Domain types shared between server and web.
// Data model reference: see CLAUDE.md "Claude Code data format rules".

export type TitleSource =
  | 'custom-title'
  | 'ai-title'
  | 'agent-name'
  | 'last-prompt'
  | 'first-message'
  | 'uuid'
  /** Renamed locally in claude-history (override stored in userdata.json, never written to ~/.claude). */
  | 'local';

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

/**
 * What one assistant message was billed. `message.usage` sits on EVERY
 * assistant line (verified: 3156/3156 across 60 transcripts) and the streamed
 * chunks of a message repeat it verbatim (0 disagreements), so this is the
 * value of the first line carrying a given `message.id` — the same dedupe the
 * enricher does, which is what makes the per-message costs add up to the
 * session total exactly.
 */
export interface MessageUsage extends UsageTotals {
  /**
   * `cache_creation` split by TTL. Claude Code writes 1-hour caches — 100% of
   * this corpus — which is why the default cache-write price is the 1h rate.
   */
  cacheCreate1h: number;
  cacheCreate5m: number;
}

export interface PrLink {
  prNumber: number;
  prUrl: string;
  prRepository: string;
}

export interface DailyUsage {
  /** User-typed prompts that day. */
  prompts: number;
  byModel: Record<string, UsageTotals>;
}

export interface SessionEnrichment {
  userMessageCount: number;
  assistantMessageCount: number;
  toolUseCount: number;
  turnCount: number;
  usage: UsageTotals;
  usageByModel: Record<string, UsageTotals>;
  /** Per-UTC-day usage (yyyy-mm-dd) for the stats dashboard. */
  daily: Record<string, DailyUsage>;
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
  /** Set only when titleSource === 'local': the title Claude Code still shows. */
  originalTitle: string | null;
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
  /** Pinned locally in claude-history (userdata.json — never touches ~/.claude). */
  pinned: boolean;
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
  /**
   * An image attached to a prompt. The transcript stores it inline as base64
   * (`source.type: 'base64'` is the only form seen), so it rides along in the
   * response instead of sitting behind an endpoint: every attachment on this
   * machine adds up to 1.6 MB, the heaviest session to 0.43 MB.
   *
   * Screenshots returned by TOOLS are a different problem with the same shape —
   * 519 of them, 116 MB inside ONE session — and are deliberately NOT carried
   * here, for the reason tool output is not indexed either.
   *
   * `data` is null only when the line held something we cannot decode, and that
   * is the one case where the viewer may say the image is unavailable.
   */
  | { kind: 'image'; mediaType: string | null; data: string | null }
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
  /**
   * Timestamp of the LAST streamed chunk of this message (equal to `timestamp`
   * when it was written in one line) — the two together are how long the answer
   * took.
   */
  endTimestamp: string | null;
  model: string | null;
  isMeta: boolean;
  /** system messages only */
  systemSubtype: string | null;
  /** Assistant only: tokens billed for this message; null for `<synthetic>` and for every other role. */
  usage: MessageUsage | null;
  /** Assistant only: the reasoning effort recorded on the line (`effort`), e.g. "xhigh". */
  effort: string | null;
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

export interface FileEdit {
  tool: string; // Edit | Write | NotebookEdit | ...
  timestamp: string | null;
  oldString: string | null;
  newString: string | null; // Write stores the (truncated) file content here
  truncated: boolean;
}

export interface FileChange {
  path: string;
  edits: FileEdit[];
}

export interface SessionDetail {
  summary: SessionSummary;
  turns: Turn[];
  subagents: SubagentMeta[];
  ancestry: { resumedFrom: string[]; descendants: string[] };
  prLinks: PrLink[];
  /** Files touched by Edit/Write tool calls in THIS transcript (subagent edits live in their own transcripts). */
  fileChanges: FileChange[];
}

export interface SubagentDetail {
  meta: SubagentMeta;
  turns: Turn[];
}
