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

/**
 * One row of the `/context` breakdown. `deferred` rows (deferred MCP and system
 * tools) are counted by /context but are NOT in the context: subtracting them
 * from the category sum gives the reported total, exactly, in all four snapshots
 * on this machine (22.8k / 22.7k / 18.7k / 25.5k of discrepancy, each equal to
 * its two deferred rows).
 */
export interface ContextCategory {
  label: string;
  tokens: number;
  /** As /context computed it, against the real window — never derived here. */
  pct: number;
  deferred: boolean;
}

/**
 * A `/context` run, recovered from the transcript: Claude Code re-injects its
 * own output as an isMeta user line in clean markdown. It is the ONLY place the
 * window size and the `[1m]` model marker are recorded, and the only place the
 * per-category split exists — nothing else lets it be reconstructed, because the
 * fixed overhead grows during a session as deferred tools and skills load.
 */
export interface ContextSnapshot {
  model: string | null;
  reportedTokens: number | null;
  limitTokens: number | null;
  /** As printed by /context ("47"), not computed by us. */
  reportedPct: number | null;
  categories: ContextCategory[];
  mcpTools: Array<{ tool: string; server: string; tokens: number }>;
}

/** A `system`/`compact_boundary` line: the conversation was compacted here. */
export interface CompactBoundary {
  /** "manual" (/compact) or "auto" (the autocompact threshold). */
  trigger: string | null;
  preTokens: number | null;
  postTokens: number | null;
  /** cumulativeDroppedTokens — across the whole session, not just this boundary. */
  droppedTokens: number | null;
  durationMs: number | null;
  preservedMessages: number | null;
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
  /**
   * Context that was already cached and had to be written again, per model — a
   * SUBSET of `byModel[...].cacheCreate`, never an addition to it. Stored as
   * tokens and never as an amount: the price table is user-editable, so a saved
   * cost would freeze yesterday's rates. Carried-over lines are excluded, like
   * every other aggregate here.
   *
   * It lives in the daily buckets rather than on the session because that is
   * what the stats page filters by, and because a session-level copy would be a
   * second source of truth for the number the viewer already computes from the
   * parsed turns. Both go through `recacheOf` in `shared/src/recache.ts`.
   */
  recachedByModel: Record<string, number>;
  /** Requests that day which had to re-write a cached prefix. */
  recacheEvents: number;
  /**
   * What the agents this session sent out spent THAT day, in their own
   * conversations. An addition to `byModel`, never a subset of it: those
   * requests are not in this transcript at all.
   *
   * Bucketed by the agent's own timestamps rather than by the turn that
   * launched it — an agent runs for minutes and can finish on the next day —
   * and kept with the TTL split, because a subagent writes 5-minute caches
   * (1.25x input) where a session writes 1-hour ones (2x). Folded into
   * `byModel` it would be priced at the session's rate and overcharged.
   */
  subagentByModel: Record<string, MessageUsage>;
}

export interface SessionEnrichment {
  userMessageCount: number;
  assistantMessageCount: number;
  toolUseCount: number;
  turnCount: number;
  /** `system`/`compact_boundary` lines: how many times this session was compacted. */
  compactionCount: number;
  /**
   * What the requests in THIS transcript cost. Carried-over lines are excluded
   * (see `carriedOverUsage`), so summing sessions never bills a fork's copies
   * twice.
   *
   * This is no longer the whole of what the session spent — the agents it sent
   * out are in `subagentUsage` — and it must stay this exact quantity: it is
   * what the viewer's per-message pills add up to, which is the only check that
   * the token arithmetic is right.
   */
  usage: UsageTotals;
  usageByModel: Record<string, UsageTotals>;
  /**
   * What the agents this session sent out spent, added up from their own
   * transcripts (`<sessionUuid>/subagents/agent-*.jsonl`). Their requests are
   * their own API conversations and appear nowhere in this file, so without
   * this the session cost was short by 88% in the worst case here — $1.49
   * shown against $12.01 really spent, across 11 agents.
   *
   * Kept apart from `usage` rather than folded into it for two reasons, both
   * load-bearing: the pills above, and the cache TTL — hence `MessageUsage`,
   * which carries the 1h/5m split that `UsageTotals` does not.
   *
   * Nothing here can be double-counted corpus-wide: an `agent-*.jsonl` belongs
   * to exactly one session and a `/branch` fork does not copy the directory.
   */
  subagentUsage: MessageUsage;
  subagentUsageByModel: Record<string, MessageUsage>;
  /**
   * The agents' own ids (`agent-<id>.jsonl`), which is what a notification's
   * `<task-id>` is. Indexed like the session's own id so that pasting one finds
   * it: the app writes them into the URL when a drawer opens, and until they
   * were searchable there was no way back from the string to the agent.
   */
  subagentIds: string[];
  /** Per-UTC-day usage (yyyy-mm-dd) for the stats dashboard. Carried-over lines excluded. */
  daily: Record<string, DailyUsage>;
  models: string[];
  prLinks: PrLink[];
  /**
   * The session this one was forked from (`/branch`), read from the `forkedFrom`
   * field Claude Code stamps on every copied line. The ONLY explicit ancestry in
   * the format — see `runIds` for what used to be mistaken for it.
   */
  forkedFrom: string | null;
  /**
   * Tokens that arrived WITH the fork: lines copied from the parent, already
   * billed there. Kept apart instead of dropped, because the viewer renders
   * those messages and their pills have to add up to something.
   */
  carriedOverUsage: UsageTotals;
  /**
   * Other Claude Code runs that appended to this transcript, from the
   * `session_id` field — which names the RUN that wrote a line, not an ancestor.
   * Resuming a session from a fresh CLI stamps that CLI's id on everything it
   * writes, and the id usually belongs to a 1-line stub with no conversation of
   * its own. Verified across all 22 cases in this corpus: not one carries a
   * copied uuid, so nothing here is history this session inherited.
   */
  runIds: string[];
}

export interface LiveInfo {
  pid: number;
  status: string; // "idle" | "busy" | ...
  name: string | null;
  startedAt: number | null; // epoch ms
  updatedAt: number | null; // epoch ms
  /**
   * When the status last changed — which, for a busy session, is when the turn
   * began. Kept separate from `updatedAt` on purpose: the two are equal today
   * because Claude Code writes this file only when something changes (measured:
   * `updatedAt` frozen for 3 minutes into a busy turn, no heartbeat at all), and
   * a heartbeat appearing later would move `updatedAt` while this stays true.
   */
  statusUpdatedAt: number | null; // epoch ms
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
  // Sessions forked FROM this one (the reverse of their `forkedFrom`).
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
  /**
   * `AskUserQuestion` only: the answers as Claude Code recorded them
   * STRUCTURALLY (`toolUseResult.answers`, question text -> what was chosen),
   * which is the only unambiguous form of them.
   *
   * The prose in `text` says the same thing as `"question"="answer"` pairs, and
   * reading it back is guesswork the moment either half contains a quote — 7 of
   * the 64 questions in this corpus do. One of them ("¿Quieres poder marcar
   * repos como "solo lectura"?") lost its answer entirely that way, and an
   * answer carrying a quote was truncated at it.
   *
   * Null for the transcripts that never wrote it (a declined question records
   * no answers at all), where the prose stays the fallback.
   */
  answers: Record<string, string> | null;
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
  /**
   * A line Claude Code injected into the conversation itself — today a
   * background command or an Agent reporting back (`origin.kind`,
   * e.g. `task-notification`). It wears the `user` role in the transcript but
   * nobody typed it, so it gets its own panel: it OPENS a turn (a real exchange
   * follows) and has to look like an event, not like a prompt.
   *
   * `text` is the block's own `<summary>` — the readable line. The fields below
   * are the rest of what a `<task-notification>` carries and used to be thrown
   * away with it; every one of them is null on a notice that is not one (and on
   * the older transcripts, which had no background tasks to report).
   */
  | {
      kind: 'notice';
      origin: string;
      text: string;
      /**
       * `<task-id>`. For an Agent it IS the `agentId`, which is the only exact
       * link between a report and the subagent transcript that produced it. A
       * background COMMAND notifies through this same channel with an id of its
       * own (9 characters, matching no transcript), so a reader must check it
       * against the session's subagents rather than assume every notice is an
       * agent's.
       */
      taskId: string | null;
      /** `<tool-use-id>`: the call this is the answer to — what a "go to the call" link needs. */
      toolUseId: string | null;
      /** `<status>` verbatim, `completed` or `failed`. 4 of the 6 agents in one session here failed. */
      status: string | null;
      /**
       * `<result>`: the whole report the agent handed back. It exists ONLY here —
       * the tool result of the call is boilerplate ("Async agent launched
       * successfully…") and the parent transcript holds the deliverable nowhere
       * else. Not truncated: 53 of them in this corpus, p50 22.5 KB, max 56.7 KB,
       * and cutting at the tool-result limit would halve most of them.
       */
      result: string | null;
    }
  /** The output of a `/context` run, parsed. */
  | { kind: 'context'; snapshot: ContextSnapshot }
  /** A compaction boundary, with what it dropped. */
  | { kind: 'compact'; boundary: CompactBoundary }
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
  /**
   * The summary a compaction wrote, not something the user typed. Claude Code
   * appends it as an ordinary `user` line with string content (no `usage`), so
   * nothing but this flag tells the two apart — and the transcript's own
   * `compactMetadata.preservedSegment.anchorUuid` points at exactly this uuid.
   * Without it the viewer showed a 17,000-character "prompt" nobody wrote.
   */
  isCompactSummary: boolean;
  /**
   * A prompt the user typed while Claude was working, so it waited in the queue
   * and was delivered when the turn ended. It reaches the transcript in a
   * different envelope from every other prompt — an `attachment` line, see
   * `queuedPrompt` — and its `timestamp` is when it was TYPED, not when it was
   * sent, so it is legitimately older than the answer above it. The viewer says
   * so rather than letting the clock read as a parsing error.
   */
  queued: boolean;
  /** system messages only */
  systemSubtype: string | null;
  /**
   * A line copied into this transcript by `/branch` (`forkedFrom` on the line):
   * the exchange happened in the parent session and was billed there. Rendered
   * like any other message — it IS the context the fork started from — but its
   * cost belongs to the parent, and the fork's own total leaves it out.
   */
  carriedOver: boolean;
  /**
   * The RUN that wrote this line (`session_id`), NOT an ancestor — resuming from
   * a fresh CLI stamps that CLI's id on everything it appends here. Two
   * consecutive requests carrying different ids mean a new process re-sent the
   * whole conversation, which is why the cache went with it: the second-biggest
   * cause of a re-cache in this corpus, and unknowable without this field.
   */
  runId: string | null;
  /**
   * Set on a message a `/rewind` cut away: it stays in the file forever, but
   * nothing descends from it any more, so Claude Code stops showing it. It was
   * really said and really billed, so the viewer folds it away rather than
   * dropping it.
   *
   * The value is WHICH branch it was cut away with — the uuid of the message that
   * starts it — because rewinding twice to the same point leaves two separate
   * branches there, and they are two different pieces of history: `c0f70eda` has
   * a 9-turn one from 15:21 and a 2-turn one from 17:38 hanging off the same
   * message, and showing them as one 11-turn stretch invented a span that never
   * existed. Null means the message is part of the conversation that stands.
   */
  discardedBranch: string | null;
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
  /** `forkedFrom`: the session `/branch` copied this one's context from. */
  ancestry: { forkedFrom: string | null; descendants: string[] };
  prLinks: PrLink[];
  /** Files touched by Edit/Write tool calls in THIS transcript (subagent edits live in their own transcripts). */
  fileChanges: FileChange[];
}

export interface SubagentDetail {
  meta: SubagentMeta;
  turns: Turn[];
}
