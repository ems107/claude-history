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
}

export const DEFAULT_SETTINGS: AppSettings = {
  updateAutoCheck: true,
  updateIntervalMinutes: 10,
  usageWidget: true,
};

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
}

// ---- SSE events on /api/events ----

export type ServerEvent =
  | { type: 'sessions-changed'; ids: string[] }
  | { type: 'session-updated'; id: string }
  | { type: 'live-changed' }
  | { type: 'index-progress'; enriched: number; total: number }
  | { type: 'update-status' };
