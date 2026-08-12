// REST API contract shared between server and web.

import type {
  LiveInfo,
  ProjectInfo,
  SessionDetail,
  SessionSummary,
  SubagentDetail,
} from './types.ts';

export type IndexState = 'scanning' | 'enriching' | 'ready';

export interface MetaResponse {
  dataRoot: string;
  cacheDir: string;
  projectCount: number;
  sessionCount: number;
  indexState: IndexState;
  enrichedCount: number;
  cacheHits: number;
  version: string;
}

export type SessionsResponse = SessionSummary[];
export type ProjectsResponse = ProjectInfo[];
export type SessionDetailResponse = SessionDetail;
export type SubagentDetailResponse = SubagentDetail;

export interface LiveSessionEntry extends LiveInfo {
  sessionId: string;
  cwd: string;
  entrypoint: string | null;
}
export type LiveResponse = LiveSessionEntry[];

/** 'phrase' is one implicit quoted term; 'words' splits on spaces, quotes kept. */
export type SearchMode = 'phrase' | 'words';
/** Where all the words must meet: one message, or anywhere in the session. */
export type SearchWordScope = 'message' | 'session';

/**
 * A snippet is a run of alternating parts so every term in view can be marked:
 * one line may well contain several of them, and a single `match` could only
 * ever tell the truth about one.
 */
export interface SearchSnippet {
  uuid: string | null;
  role: string;
  parts: { text: string; hit?: true }[];
}

export interface SearchHit {
  sessionId: string;
  matchCount: number;
  snippets: SearchSnippet[];
}

/** The query as the server understood it, so the results can say what they did. */
export interface SearchQueryEcho {
  terms: string[];
  mode: SearchMode;
  scope: SearchWordScope;
  wholeWord: boolean;
}

/** What the on-demand scan of tool calls and output actually got through. */
export interface DeepScanInfo {
  sessionsRead: number;
  /** Characters of transcript read — near enough to bytes for this corpus. */
  bytesRead: number;
  /** Cancelled, out of time or capped — the results are a partial answer. */
  stoppedEarly: boolean;
}

export interface SearchResponse {
  hits: SearchHit[];
  scannedSessions: number;
  tookMs: number;
  indexComplete: boolean;
  query: SearchQueryEcho;
  /** Present only when the request asked for tool calls and output. */
  deep?: DeepScanInfo;
}

/**
 * Every place one query matched inside ONE session, a page at a time. A hit in
 * the list only ever shows a handful of snippets and then says how many matches
 * it left out; this is how those get looked at.
 *
 * It pages over PLACES, not over occurrences: one window of text can hold
 * several of them, so `total` and `matchCount` are different numbers and both
 * have to be said.
 */
export interface SessionMatchesResponse {
  sessionId: string;
  query: SearchQueryEcho;
  /** This page, in the order the corpus is read. */
  snippets: SearchSnippet[];
  /** Where this page starts in the session's list of places. */
  offset: number;
  /** Places in the whole session — what the pagination counts. */
  total: number;
  /**
   * Term occurrences in the whole session: the figure `SearchHit.matchCount`
   * carries, recomputed here (a live transcript may have grown since).
   */
  matchCount: number;
  /**
   * Occurrences covered by THIS page. Every occurrence is assigned to exactly
   * one place, so the pages add up to `matchCount` once the last one arrives —
   * which is what lets the UI count down to zero and mean it.
   */
  pageMatches: number;
  tookMs: number;
  /** Present only when tool calls and output were read too. */
  deep?: DeepScanInfo;
}

export interface ToolResultFileResponse {
  text: string;
  sizeBytes: number;
}

export interface PromptEntry {
  display: string; // full typed prompt text
  timestamp: number; // epoch ms
  project: string; // real project path
  projectKey: string;
  projectName: string;
  sessionId: string;
  sessionExists: boolean;
}
export type PromptsResponse = PromptEntry[];

export interface ResumeResponse {
  ok: boolean;
  method: 'wt' | 'cmd';
  command: string;
}

export interface LineageNode {
  id: string;
  exists: boolean;
  title: string | null;
  projectKey: string | null;
  projectName: string | null;
  createdAt: string | null;
  lastActivityAt: string | null;
}

export interface LineageResponse {
  nodes: LineageNode[];
  /** from = the session that was forked, to = the fork (`/branch`) made from it. */
  edges: Array<{ from: string; to: string }>;
}

// ---- Updates (GitHub releases) ----

export type UpdateState = 'idle' | 'checking' | 'downloading' | 'verifying' | 'staging' | 'restarting';

export interface UpdateRelease {
  /** Bare version, e.g. "1.2.0". */
  version: string;
  /** Release tag, e.g. "v1.2.0". */
  tag: string;
  /** Release notes (markdown; the annotated tag message). */
  notes: string;
  publishedAt: string | null;
  /** Size of the win-x64 zip asset, if found. */
  sizeBytes: number | null;
  /** False when the release ships no installable zip + checksums pair. */
  installable: boolean;
}

/**
 * Live progress of the step in flight. Only the download reports it — the
 * other steps are seconds long and `state` says everything about them.
 */
export interface UpdateProgress {
  receivedBytes: number;
  /** Null only if the release did not declare a size and the server sent none. */
  totalBytes: number | null;
  /** 1 on the first try; higher means the transfer stalled and was resumed. */
  attempt: number;
  bytesPerSecond: number | null;
}

export interface UpdateStatusResponse {
  currentVersion: string;
  /** True when running from an installed layout (updates can be applied). */
  installed: boolean;
  updateAvailable: boolean;
  /** Every release newer than the running one, newest first. */
  available: UpdateRelease[];
  lastCheckAt: string | null;
  lastError: string | null;
  state: UpdateState;
  /**
   * The version being installed, or null when nothing is being applied.
   * Applying is fire-and-forget — the POST that starts it answers at once —
   * so this, `state` and `progress` are the ONLY honest way for the UI to
   * follow it. A client-side timer cannot tell a slow download from a dead
   * server, and one that tried reported failures that had not happened.
   */
  applyingVersion: string | null;
  progress: UpdateProgress | null;
  /** Why the last apply failed (prefixed with the step), and when. */
  lastApplyError: string | null;
  lastApplyErrorAt: string | null;
}

// ---- Settings (persisted in userdata.json) ----

export interface AppSettings {
  /** Poll GitHub for new releases in the background. */
  updateAutoCheck: boolean;
  /** Minutes between automatic update checks (minimum 5). */
  updateIntervalMinutes: number;
  /**
   * Show the Claude subscription usage widget. It reads the OAuth token from
   * ~/.claude/.credentials.json (read-only, never refreshed) and calls
   * Anthropic's usage endpoint.
   */
  usageWidget: boolean;
  /**
   * IDLE cadence for the usage widget, in seconds (minimum 15). Usage is
   * normally refreshed by session activity; this is only the fallback for when
   * nothing happens locally — Claude may still be used from another device.
   */
  usageIntervalSeconds: number;
  /**
   * Floor between two REAL reads, in seconds (minimum MIN_USAGE_INTERVAL_SECONDS).
   * Anything asking sooner is served the figures already in hand. This is the
   * one knob that bounds how often the (rate-limited) endpoint is called, so it
   * applies to every trigger and to the server's own readers, not just the
   * widget. The manual Refresh button is the sole exception.
   */
  usageMinIntervalSeconds: number;
  /**
   * How long to stop asking after Anthropic answers HTTP 429, in seconds
   * (minimum MIN_USAGE_RATE_LIMIT_SECONDS). A 429 is the endpoint saying in so
   * many words that we asked too often, and the normal floor is far too short
   * an answer to that — so it takes over from the floor entirely, for every
   * trigger and both readers. The manual Refresh button still gets through:
   * asking for it explicitly is a deliberate act, and the cost of it failing
   * is one more 429.
   */
  usageRateLimitBackoffSeconds: number;
  /**
   * Coming back to the window re-reads only if the figures are older than this
   * (seconds). Focus fires far more often than people expect — every tab
   * switch and every unminimize — and most of those land on figures that are
   * seconds old. 0 means "always re-read".
   */
  usageFocusMaxAgeSeconds: number;
  /**
   * Re-read when Claude answers in any session. This is the trigger that
   * matters: an `assistant` line being appended is the only local event that
   * means tokens were just spent.
   */
  usageOnActivity: boolean;
  /** Re-read on the idle interval (`usageIntervalSeconds`). */
  usageOnInterval: boolean;
  /** Re-read just after a window's `resetsAt`, to catch it dropping to 0%. */
  usageOnReset: boolean;
  /** Re-read when this window regains focus (see `usageFocusMaxAgeSeconds`). */
  usageOnFocus: boolean;
  /**
   * Keep the 5-hour usage window rolling: whenever the window is found NOT to
   * have started, run one throwaway Claude Code prompt to start it, so windows
   * follow each other instead of leaving dead hours. Driven by the server, so
   * it works with no browser open.
   */
  autoReloadEnabled: boolean;
  /** Model alias for that prompt (one of AUTO_RELOAD_MODELS). */
  autoReloadModel: string;
  /** The prompt itself. Anything non-empty works; it is thrown away. */
  autoReloadMessage: string;
  /**
   * Folder the reload session runs in. Required — there is no sane default,
   * and Claude Code needs a real working directory.
   */
  autoReloadCwd: string;
  /** Leave that folder's sessions out of the list, the filters and the counts. */
  autoReloadHideSessions: boolean;
  /** Lowest level actually written to the log files. */
  logLevel: LogLevel;
  /** Daily log files older than this are deleted (minimum 1). */
  logRetentionDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  updateAutoCheck: true,
  updateIntervalMinutes: 10,
  usageWidget: true,
  usageIntervalSeconds: 300,
  usageMinIntervalSeconds: 60,
  usageRateLimitBackoffSeconds: 300,
  usageFocusMaxAgeSeconds: 60,
  usageOnActivity: true,
  usageOnInterval: true,
  usageOnReset: true,
  usageOnFocus: true,
  autoReloadEnabled: false,
  autoReloadModel: 'haiku',
  autoReloadMessage: 'Hi, Claude!',
  autoReloadCwd: '',
  autoReloadHideSessions: false,
  logLevel: 'info',
  logRetentionDays: 14,
};

/** Floor on log retention: keeping zero days would mean keeping nothing. */
export const MIN_LOG_RETENTION_DAYS = 1;

/**
 * Hard floor between usage reads. `usageMinIntervalSeconds` is configurable
 * above this and never below it: the endpoint is undocumented and rate limits
 * harder than its numbers suggest (429 observed after a dozen reads in fifteen
 * minutes), so no setting may open the tap wider than this.
 */
export const MIN_USAGE_INTERVAL_SECONDS = 15;

/**
 * Hard floor on the 429 cooldown. Backing off for less than a minute after
 * being told outright that we ask too much is not backing off at all.
 */
export const MIN_USAGE_RATE_LIMIT_SECONDS = 60;

// ---- Auto-reload of the 5-hour window ----

/** Aliases `claude --model` accepts (verified against CC 2.1.224). */
export const AUTO_RELOAD_MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const;

/** Longest prompt we store; the reload message is meant to be a one-liner. */
export const AUTO_RELOAD_MESSAGE_MAX = 500;

/**
 * Config problems detectable without touching the filesystem, shared so the
 * server and the settings UI cannot disagree about them. Filesystem and CLI
 * checks are added on top by the server (see AutoReloadStatus.configError).
 */
export function validateAutoReload(s: AppSettings): string | null {
  if (!s.autoReloadMessage.trim()) return 'The message to send is empty.';
  if (!(AUTO_RELOAD_MODELS as readonly string[]).includes(s.autoReloadModel)) {
    return `Unknown model "${s.autoReloadModel}".`;
  }
  const cwd = s.autoReloadCwd.trim();
  if (!cwd) return 'No folder set — the session needs a folder to run in.';
  if (!/^([A-Za-z]:[\\/]|\\\\)/.test(cwd)) return `"${cwd}" is not an absolute path.`;
  return null;
}

export interface AutoReloadRun {
  at: string;
  /** The prompt ran and Claude answered. Says nothing about the window yet. */
  ok: boolean;
  model: string;
  cwd: string;
  durationMs: number;
  exitCode: number | null;
  /** Start of Claude's reply, kept only so the UI can prove it answered. */
  reply: string | null;
  error: string | null;
  /** A live 5-hour window was confirmed after the run. This is the real goal. */
  windowStarted: boolean;
  /**
   * The window found afterwards had begun BEFORE this run, so the run did not
   * open it — the usual case for a send triggered by a stale token, which
   * refreshes the token while a window happens to be running already. It
   * matters because the reload that window's expiry is owed is still pending:
   * saying "started a window" there would be a plain lie, and it is also why no
   * cooldown may stand between this run and that expiry.
   */
  windowAlreadyRunning: boolean;
  /**
   * When the read-back that checks `windowStarted` happened. Null means it is
   * still pending: the prompt answers in seconds but the figures need a minute
   * to settle, so until this is set `windowStarted: false` means "not yet
   * known", not "no window". The run is handed to the UI before this exists.
   */
  verifiedAt: string | null;
  /** True when started from the Test button rather than by the schedule. */
  manual: boolean;
}

export interface AutoReloadStatus {
  enabled: boolean;
  /** Enabled, correctly configured and not paused — i.e. it will really fire. */
  active: boolean;
  /** Why it cannot run despite being enabled (bad folder, empty message, no CLI). */
  configError: string | null;
  /** Why it stopped itself (repeated failures). Cleared by saving a setting. */
  pausedReason: string | null;
  /** A scheduled check is in flight right now. Never blocks a manual send. */
  running: boolean;
  /** A prompt is being sent right now — seconds, not minutes. */
  sending: boolean;
  /** A send has happened and its read-back is still pending (about a minute). */
  verifying: boolean;
  /**
   * Why "Send it now" would be refused right now, null when it would go
   * through. The server computes it once and both consumers use it: the POST
   * refuses with this exact string, and the button is disabled by it and shows
   * it. That is the point of it living here — a button disabled by one thing
   * while explaining another is how it came to be disabled with no reason at
   * all. It only ever holds a validation failure or a send genuinely in flight:
   * the cooldowns and backoffs exist to stop an automatic loop, and have no
   * business stopping a person who is asking.
   */
  runBlockedReason: string | null;
  /** Known expiry of the current 5-hour window; null when none is running. */
  resetsAt: string | null;
  /** When the server will next ask Anthropic for the figures. */
  nextCheckAt: string | null;
  /**
   * When the scheduler last learned the state of the window — including from a
   * reading the widget paid for, which is the usual case while the app is open.
   */
  lastCheckAt: string | null;
  /**
   * Last usage-read failure, from the SHARED read state: if anything has read
   * the figures successfully since, this is null. It is not a private tally of
   * this feature's own reads — that is how the panel used to claim the token
   * had expired while the header widget was showing perfectly good figures.
   */
  lastError: string | null;
  /** When the shared figures were last read successfully, by anyone. */
  lastReadAt: string | null;
  /** Which trigger made the last read attempt, whoever it belonged to. */
  lastReadTrigger: UsageTrigger | null;
  lastRun: AutoReloadRun | null;
  /** Resolved claude executable; null when it could not be found. */
  cliPath: string | null;
}

// ---- Claude Code's own history retention (cleanupPeriodDays) ----

/**
 * What Claude Code deletes when nothing sets `cleanupPeriodDays`. Verified in
 * the CLI bundle (2.1.228) and in the docs: 30 days, minimum 1, and a literal 0
 * fails validation rather than meaning "never".
 */
export const CLAUDE_RETENTION_DEFAULT_DAYS = 30;
export const CLAUDE_RETENTION_MIN_DAYS = 1;

/**
 * The sweep runs at startup at most once a day: `~/.claude/.last-cleanup` is
 * the sentinel, and a mtime younger than this means it is skipped outright.
 */
export const CLAUDE_SWEEP_INTERVAL_HOURS = 24;

/** Where a value came from. Precedence: policy > local > project > user. */
export type RetentionScope = 'policy' | 'user' | 'project' | 'local';

/** One settings file, and what it has to say about `cleanupPeriodDays`. */
export interface RetentionSource {
  scope: RetentionScope;
  path: string;
  exists: boolean;
  /** null when the file does not set the key at all. */
  days: number | null;
  /**
   * The file exists but could not be read or parsed. This is a finding, not a
   * failure of ours: Claude Code PAUSES the whole retention sweep while any of
   * its settings files is in that state.
   */
  unreadable: string | null;
  /** The key is there but is not an integer >= 1, so Claude Code rejects it. */
  invalidValue: string | null;
  /** Only on project-scoped sources: whose settings file this is. */
  project: { name: string; path: string } | null;
}

export interface RetentionResponse {
  /** Effective days outside any project that overrides it. */
  days: number;
  /** Nothing sets it, so the built-in default applies. */
  usedDefault: boolean;
  effectiveScope: RetentionScope | 'default';
  defaultDays: number;
  minDays: number;
  /** The file to edit — always the user one, whatever won above. */
  userSettingsFile: string;
  /** Folder holding it; what the "open the folder" button opens. */
  settingsDir: string;
  /** The global chain: managed policy and user settings, in precedence order. */
  sources: RetentionSource[];
  /**
   * Project `.claude` settings that set the key or cannot be read. They only
   * apply when Claude Code is started in that project — but then they win over
   * the user file, so a number shown without them can be a lie.
   */
  projectOverrides: RetentionSource[];
  /** Why Claude Code is not cleaning up at all right now, when that is the case. */
  sweepBlocked: string | null;
  /** True when a managed-settings file was found (its values outrank everything). */
  policyPresent: boolean;
  /** `.last-cleanup`: when the sweep last ran. */
  lastSweepAt: string | null;
  /** Files whose mtime is older than this are deleted by the next sweep. */
  cutoff: string;
  /**
   * Sessions this app lists whose transcript is ALREADY past the cutoff — the
   * next sweep deletes them. Counted here rather than in the browser so the
   * footer of the list and the settings page cannot end up disagreeing, and
   * against `mtimeMs`, which is exactly what the sweep compares.
   */
  expiredCount: number;
  /** How many sessions that count was taken over. */
  countedSessions: number;
  /** mtime (epoch ms) of the oldest session NOT past the cutoff: the margin. */
  oldestKeptMtimeMs: number | null;
  readAt: string;
}

// ---- Subscription usage ----

/**
 * Why a usage read happened. Recorded on every one, because six unrelated
 * things ask for these figures and "the widget asked" says almost nothing: a
 * read caused by Claude answering means the numbers really moved, while one
 * caused by refocusing a tab means nothing did. The browser is the only place
 * that knows which, so it says so in the request.
 */
export const USAGE_TRIGGERS = [
  /**
   * The header widget with NO cause attributed. Every known cause below is
   * labelled at its source, so this one means the browser really could not say
   * why — an unexpected refetch from inside TanStack, or a read that reached
   * the server without passing through `markUsageRead`. It is logged as such,
   * in those words: a log that guesses is worse than one that admits it.
   */
  'widget',
  /** First read after the page loads (the widget mounting). */
  'widget-mount',
  /** Claude answered — an `assistant` line was appended to some transcript. */
  'widget-activity',
  /** The idle fallback poll (`usageIntervalSeconds`). */
  'widget-interval',
  /** Came back to the tab (subject to `usageFocusMaxAgeSeconds`). */
  'widget-focus',
  /** One-shot just after a window's `resetsAt`: nothing else announces a 0%. */
  'widget-reset',
  /** A settings save, which can enable or disable the widget. */
  'widget-settings',
  /** Retrying a read that failed — TanStack's `retry`, not a new cause. */
  'widget-retry',
  /** The browser regained its network connection. */
  'widget-reconnect',
  /** After the auto-reload's "Send it now": a window may have just started. */
  'widget-auto-reload',
  /** The Refresh button inside the usage popover. */
  'manual-refresh',
  /** The auto-reload asking whether the 5-hour window is free. */
  'auto-reload-check',
  /** The auto-reload reading back the new expiry after sending its prompt. */
  'auto-reload-verify',
] as const;

export type UsageTrigger = (typeof USAGE_TRIGGERS)[number];

export interface UsageWindow {
  key: string;
  label: string;
  /** Percentage used, 0-100. */
  utilization: number;
  resetsAt: string | null;
}

export interface UsageResponse {
  available: boolean;
  /** Set when usage could not be read (no credentials, expired token, HTTP error). */
  error: string | null;
  windows: UsageWindow[];
  fetchedAt: string | null;
  subscriptionType: string | null;
  /** These figures come from an earlier read that could not be renewed. */
  stale: boolean;
}

// ---- Logs ----

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Levels selectable as the write threshold — 'fatal' as a floor would mute everything. */
export const LOG_LEVEL_CHOICES = ['debug', 'info', 'warn', 'error'] as const;

/** Known subsystems. The writer accepts any string; this only feeds the UI. */
export const LOG_SOURCES = [
  'server',
  'config',
  'index',
  'enricher',
  'cache',
  'watcher',
  'usage',
  'auto-reload',
  /** Reading Claude Code's own `cleanupPeriodDays` out of its settings files. */
  'retention',
  'updates',
  /** Imported from the installer's update.log so an update reads as one timeline. */
  'update-helper',
  'http',
  'console',
  'log',
] as const;

/**
 * One line of a daily log file (JSONL). Short keys: these are written by the
 * thousand and read by a viewer, not by eye.
 */
export interface LogRecord {
  /** Local ISO-8601 with offset — sortable, Date.parse-able, and readable as-is. */
  t: string;
  lvl: LogLevel;
  src: string;
  /**
   * Always written. Two instances sharing a day's file is not supposed to
   * happen (one port), but if it ever does this is what makes it obvious.
   * The version is not repeated per record — the 'started' message carries it,
   * and this pid is what ties the rest of the lines to it.
   */
  pid: number;
  msg: string;
  /** Structured extra, when there is something worth reading separately. */
  data?: unknown;
  /** Stack trace, when the call carried an Error. */
  err?: string;
}

export interface LogDay {
  /** Local date, YYYY-MM-DD — also the file name. */
  date: string;
  sizeBytes: number;
}

export interface LogsResponse {
  logsDir: string;
  /** Newest day first. */
  days: LogDay[];
  level: LogLevel;
  retentionDays: number;
  /** The installer's own update.log, only present in a managed install. */
  updateLog: { available: boolean; path: string | null };
}

export interface LogDayResponse {
  date: string;
  /** Newest first, capped at LOG_PAGE_SIZE. */
  records: LogRecord[];
  /** Matching records before the cap. */
  total: number;
  truncated: boolean;
  /** Counts for the facet chips, over everything the text search matched. */
  levels: Record<string, number>;
  sources: Record<string, number>;
}

export const LOG_PAGE_SIZE = 2_000;

export interface UpdateLogResponse {
  available: boolean;
  path: string | null;
  /** Raw text — this one is written by the PowerShell installer, not by us. */
  text: string;
  sizeBytes: number;
  modifiedAt: string | null;
}

// ---- SSE events on /api/events ----

export type ServerEvent =
  /**
   * Transcripts changed on disk. `assistantIds` is the subset where the bytes
   * appended contain a real `assistant` line — i.e. Claude answered and tokens
   * were spent. Every other write (your prompt, a tool result, the sidecar
   * lines re-appended each turn) moves the file without moving the figures, so
   * only this subset is worth a usage read.
   */
  | { type: 'sessions-changed'; ids: string[]; assistantIds: string[] }
  | { type: 'session-updated'; id: string }
  | { type: 'live-changed' }
  | { type: 'index-progress'; enriched: number; total: number }
  | { type: 'update-status' }
  | { type: 'logs-appended' };
