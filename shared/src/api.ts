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
};

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

// ---- SSE events on /api/events ----

export type ServerEvent =
  | { type: 'sessions-changed'; ids: string[] }
  | { type: 'session-updated'; id: string }
  | { type: 'live-changed' }
  | { type: 'index-progress'; enriched: number; total: number }
  | { type: 'update-status' };
