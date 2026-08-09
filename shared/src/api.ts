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

export interface SearchSnippet {
  uuid: string | null;
  role: string;
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  sessionId: string;
  matchCount: number;
  snippets: SearchSnippet[];
}

export interface SearchResponse {
  hits: SearchHit[];
  scannedSessions: number;
  tookMs: number;
  indexComplete: boolean;
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
  /** from = ancestor session, to = the session it was resumed into. */
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

/** Hard floor between usage reads, whatever the idle cadence is set to. */
export const MIN_USAGE_INTERVAL_SECONDS = 15;

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
  /** A fresh 5-hour window was confirmed after the run. This is the real goal. */
  windowStarted: boolean;
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
  /** A check or a reload is in flight right now. */
  running: boolean;
  /** Known expiry of the current 5-hour window; null when none is running. */
  resetsAt: string | null;
  /** When the server will next ask Anthropic for the figures. */
  nextCheckAt: string | null;
  lastCheckAt: string | null;
  /** Last usage-read failure, if the last read failed. */
  lastError: string | null;
  lastRun: AutoReloadRun | null;
  /** Resolved claude executable; null when it could not be found. */
  cliPath: string | null;
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
  /** The header widget, cause not attributed (a retry, an unexpected refetch). */
  'widget',
  /** First read after the page loads. */
  'widget-mount',
  /** A transcript changed — the one trigger that means the figures moved. */
  'widget-activity',
  /** The idle fallback poll (`usageIntervalSeconds`). */
  'widget-interval',
  /** Came back to the tab. */
  'widget-focus',
  /** One-shot just after a window's `resetsAt`: nothing else announces a 0%. */
  'widget-reset',
  /** A settings save, which can enable or disable the widget. */
  'widget-settings',
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
  | { type: 'sessions-changed'; ids: string[] }
  | { type: 'session-updated'; id: string }
  | { type: 'live-changed' }
  | { type: 'index-progress'; enriched: number; total: number }
  | { type: 'update-status' }
  | { type: 'logs-appended' };
