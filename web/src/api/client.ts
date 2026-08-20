import type {
  ActiveAppSession,
  ActiveSessionsResponse,
  AppSettings,
  AuthStatusResponse,
  AutoReloadRun,
  AutoReloadStatus,
  ChatCreateRequest,
  ChatCreateResponse,
  ChatPermissionMode,
  ChatPlanDecision,
  ChatSendRequest,
  ChatStatusResponse,
  FileOpenRequest,
  FileOpenResponse,
  FileReadResponse,
  FileStatsRequest,
  FileStatsResponse,
  FirewallStatusResponse,
  LineageResponse,
  LiveResponse,
  LogDayResponse,
  LogsResponse,
  MetaResponse,
  PlansResponse,
  PriceTable,
  ProjectsResponse,
  PromptsResponse,
  RetentionResponse,
  SearchResponse,
  SessionDetailResponse,
  SessionMatchesResponse,
  SessionsResponse,
  StarsResponse,
  StarUpdateResponse,
  SubagentDetailResponse,
  TerminalStartRequest,
  TerminalStatus,
  ToolResultFileResponse,
  UpdateLogResponse,
  UpdateStatusResponse,
  UsageResponse,
  UserdataBackupsResponse,
  UserdataRestoreResponse,
} from '@claude-history/shared';
import { applyTuning, type SearchTuning } from '../lib/searchTuning.ts';
import { markUsageReadFailed, takeUsageRead } from './usageReason.ts';

/** Enough to name what moved without turning the URL into a list of UUIDs. */
const IDS_PER_READ = 4;

export interface SettingsResponse {
  settings: AppSettings;
  paths: {
    dataRoot: string;
    cacheDir: string;
    userdataFile: string;
    logsDir: string;
    installRoot: string | null;
  };
  version: string;
}

/**
 * A session that is no longer valid, announced once so the whole app can react.
 *
 * Every query would otherwise fail on its own and each would render its own
 * error box, when the truth is a single fact about the page: it is signed out.
 * `App` listens for this and re-reads `/api/auth/status`, which swaps the app
 * for the login screen without a reload.
 */
export const UNAUTHORIZED_EVENT = 'ch:unauthorized';

function noteAuthFailure(status: number): void {
  if (status === 401 || status === 403) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

/**
 * A 409 that came from the app running Claude, carrying what it is running.
 *
 * An error class rather than a flag on the response, because every one of these
 * six calls already has a `catch` that shows a sentence — and this refusal is
 * not a sentence, it is a dialog with a list in it. `instanceof` is what lets a
 * call site tell the two apart without knowing which endpoint answered.
 */
export class ActiveSessionsError extends Error {
  constructor(
    message: string,
    readonly sessions: ActiveAppSession[],
  ) {
    super(message);
    this.name = 'ActiveSessionsError';
  }
}

/**
 * The error one of the guarded endpoints failed with: the active-sessions one
 * when the body carries a list, an ordinary Error otherwise. `activeSessions`
 * being present is the whole test — the server sends it nowhere else.
 */
function refusal(res: Response, body: { error?: string; activeSessions?: ActiveAppSession[] }): Error {
  const message = body.error ?? `${res.status} ${res.statusText}`;
  if (res.status === 409 && Array.isArray(body.activeSessions)) {
    return new ActiveSessionsError(message, body.activeSessions);
  }
  return new Error(message);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    noteAuthFailure(res.status);
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => getJson<MetaResponse>('/api/meta'),
  /** The one endpoint that answers before signing in. Four booleans, nothing else. */
  authStatus: () => getJson<AuthStatusResponse>('/api/auth/status'),
  login: async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfterSeconds?: number };
    // No `noteAuthFailure` here: a wrong password IS a 401, and announcing it
    // as a lost session would reload the screen the user is typing into.
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return { ok: true };
  },
  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
  },
  /** Rotates the signing key: every signed-in device, here included, is signed out. */
  logoutEverywhere: async () => {
    const res = await fetch('/api/auth/logout-all', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  },
  setCredentials: async (username: string, password: string) => {
    const res = await fetch('/api/auth/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  },
  firewall: () => getJson<FirewallStatusResponse>('/api/firewall'),
  setFirewallRule: async (allow: boolean) => {
    const res = await fetch('/api/firewall', { method: allow ? 'POST' : 'DELETE' });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  /** Delete the Block rules left behind by cancelling Windows' own dialog. */
  removeFirewallBlocks: async () => {
    const res = await fetch('/api/firewall/blocks', { method: 'DELETE' });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; removed?: number; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  sessions: () => getJson<SessionsResponse>('/api/sessions'),
  projects: () => getJson<ProjectsResponse>('/api/projects'),
  prompts: () => getJson<PromptsResponse>('/api/prompts'),
  plans: () => getJson<PlansResponse>('/api/plans'),
  live: () => getJson<LiveResponse>('/api/live'),
  prices: () => getJson<{ prices: PriceTable; isDefault: boolean }>('/api/prices'),
  fetchOfficialPrices: async () => {
    const res = await fetch('/api/prices/fetch', { method: 'POST' });
    const body = (await res.json()) as { prices?: PriceTable; source?: string; fetchedAt?: string; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body as { prices: PriceTable; source: string; fetchedAt: string };
  },
  savePrices: async (prices: PriceTable | null) => {
    const res = await fetch('/api/prices', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prices }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<{ prices: PriceTable; isDefault: boolean }>;
  },
  search: (q: string, tuning?: SearchTuning) => {
    const params = new URLSearchParams({ q });
    if (tuning) applyTuning(params, tuning);
    return getJson<SearchResponse>(`/api/search?${params}`);
  },
  /**
   * Reads the transcripts for tool calls and output — seconds, not milliseconds,
   * so it only ever runs when asked. `signal` is what stops the scan server-side
   * when the query changes under it.
   */
  deepSearch: async (q: string, tuning: SearchTuning, sessionIds: string[], signal?: AbortSignal) => {
    const params = new URLSearchParams();
    applyTuning(params, tuning);
    const res = await fetch('/api/search/deep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, ...Object.fromEntries(params), sessionIds }),
      signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<SearchResponse>;
  },
  /**
   * One page of every place a query matched in one session — what a hit's
   * "+N more matches" opens. `deep` has to match how the results were obtained:
   * a hit from a deep scan counts matches the index cannot see, and asking the
   * indexed corpus for them would quietly come back with fewer.
   */
  sessionMatches: (
    sessionId: string,
    q: string,
    tuning: SearchTuning,
    page: { offset: number; limit: number; deep: boolean },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ q, offset: String(page.offset), limit: String(page.limit) });
    applyTuning(params, tuning);
    if (page.deep) params.set('deep', '1');
    return getJson<SessionMatchesResponse>(`/api/search/session/${sessionId}/matches?${params}`, signal);
  },
  pinSession: async (id: string, pinned: boolean) => {
    const res = await fetch(`/api/sessions/${id}/pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },
  stars: () => getJson<StarsResponse>('/api/starred'),
  /**
   * Star or unstar one message. Starring parses the session server-side to take
   * its own copy of the text, so this is the only request that ever costs a
   * parse — the Starred page then reads none.
   */
  starMessage: async (sessionId: string, uuid: string, starred: boolean) => {
    const res = await fetch(`/api/sessions/${sessionId}/messages/${uuid}/star`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred }),
    });
    const body = (await res.json().catch(() => ({}))) as StarUpdateResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  renameSession: async (id: string, title: string) => {
    const res = await fetch(`/api/sessions/${id}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },
  updateStatus: () => getJson<UpdateStatusResponse>('/api/update'),
  updateCheck: async () => {
    const res = await fetch('/api/update/check', { method: 'POST' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<UpdateStatusResponse>;
  },
  updateApply: async (version?: string) => {
    const res = await fetch('/api/update/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; activeSessions?: ActiveAppSession[] };
    if (!res.ok) throw refusal(res, body);
    return body;
  },
  // Reserves the id a new conversation will have, and says where it will run.
  // Starts nothing: the CLI comes up with the first prompt, like any other
  // session — this only exists so the page knows which transcript to wait for.
  chatCreate: async (body: ChatCreateRequest) => {
    const res = await fetch('/api/chat/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as ChatCreateResponse & { error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    return payload;
  },
  // Opens the Windows folder browser on the machine the server runs on, and
  // answers what was chosen — `path: null` for Cancel, which is an answer and
  // not an error. Refused with 409 from another machine (`pickFolder`), where
  // typing the path is still there.
  pickFolder: async (initial?: string) => {
    const res = await fetch('/api/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initial }),
    });
    const payload = (await res.json()) as { path?: string | null; error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    return payload.path ?? null;
  },
  chatStatus: (id: string) => getJson<ChatStatusResponse>(`/api/sessions/${id}/chat`),
  // Answers as soon as the prompt has been written to the process, not when
  // Claude has answered: the answer arrives through the transcript like any
  // other, and a request held open for a whole turn would just be a timeout
  // waiting to happen.
  chatSend: async (id: string, body: ChatSendRequest) => {
    const res = await fetch(`/api/sessions/${id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    return payload;
  },
  // Answers whatever Claude is waiting on. The turn has been held open since
  // the question was asked, so this is what lets it continue.
  chatAnswer: async (
    id: string,
    answers: Record<string, string | string[]> | null,
    /** `ExitPlanMode` only: which of the three answers to a plan, and the note that goes with a refusal. */
    plan?: { decision: ChatPlanDecision; note?: string },
    /** Question text -> the note written beside that answer (`annotations.notes`). */
    annotations?: Record<string, { notes?: string }>,
  ) => {
    const res = await fetch(`/api/sessions/${id}/chat/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers, ...plan, ...(annotations ? { annotations } : {}) }),
    });
    const payload = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    return payload;
  },
  // Opens the process without sending a prompt, so the composer can offer the
  // real model list — which only a running CLI knows.
  chatStart: async (
    id: string,
    body: { model?: string; effort?: string | null; permissionMode?: ChatPermissionMode },
  ) => {
    const res = await fetch(`/api/sessions/${id}/chat/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    return payload;
  },
  chatStop: async (id: string) => {
    const res = await fetch(`/api/sessions/${id}/chat/stop`, { method: 'POST' });
    const payload = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    return payload;
  },
  terminalStatus: (id: string) => getJson<TerminalStatus>(`/api/sessions/${id}/terminal`),
  // Starting is a POST and not something the socket does, so a refusal arrives
  // as a sentence instead of as a socket that opens and closes again for
  // reasons nobody can read. The size goes with it: the CLI decides its whole
  // layout from the console it is born into.
  terminalStart: async (id: string, body: TerminalStartRequest) => {
    const res = await fetch(`/api/sessions/${id}/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    return payload;
  },
  // Kills the CLI and forgets the terminal, last screen included. Closing one
  // that is not open is not an error.
  terminalStop: async (id: string) => {
    const res = await fetch(`/api/sessions/${id}/terminal/stop`, { method: 'POST' });
    const payload = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    return payload;
  },
  settings: () => getJson<SettingsResponse>('/api/settings'),
  /**
   * Refused (409) with a list when the patch would switch `chatEnabled` or
   * `chatMode` while the app is running Claude. Every other setting saves.
   */
  saveSettings: async (patch: Partial<AppSettings>) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; activeSessions?: ActiveAppSession[] };
      throw refusal(res, body);
    }
    return res.json() as Promise<{ settings: AppSettings }>;
  },
  userdataBackups: () => getJson<UserdataBackupsResponse>('/api/userdata/backups'),
  createUserdataBackup: async () => {
    const res = await fetch('/api/userdata/backups', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as { name?: string | null; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    // A null name means the file is byte-identical to the newest copy already
    // held: nothing was written, and saying so beats inventing a file name.
    return body.name ?? null;
  },
  /**
   * Replace every rename, pin, star, price and setting with a stored copy.
   *
   * The one call in this app that overwrites user data wholesale — hence the
   * confirmation in the panel, and the `pre-restore` copy the server takes
   * before doing it.
   */
  restoreUserdata: async (name: string) => {
    const res = await fetch('/api/userdata/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json().catch(() => ({}))) as UserdataRestoreResponse & {
      error?: string;
      activeSessions?: ActiveAppSession[];
    };
    if (!res.ok) throw refusal(res, body);
    return body;
  },
  // Claude Code's own `cleanupPeriodDays`, read from its settings files. We only
  // ever read it: changing it is a manual edit, explained in Settings.
  retention: () => getJson<RetentionResponse>('/api/retention'),
  openClaudeSettingsFolder: () => fetch('/api/retention/open-folder', { method: 'POST' }),
  logs: () => getJson<LogsResponse>('/api/logs'),
  logDay: (date: string, filters: { levels?: string[]; sources?: string[]; q?: string }) => {
    const params = new URLSearchParams();
    if (filters.levels?.length) params.set('level', filters.levels.join(','));
    if (filters.sources?.length) params.set('src', filters.sources.join(','));
    if (filters.q) params.set('q', filters.q);
    const qs = params.toString();
    return getJson<LogDayResponse>(`/api/logs/day/${date}${qs ? `?${qs}` : ''}`);
  },
  updateLog: () => getJson<UpdateLogResponse>('/api/logs/update-log'),
  clearLogs: async () => {
    const res = await fetch('/api/logs/clear', { method: 'POST' });
    const body = (await res.json()) as { deleted?: number; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body.deleted ?? 0;
  },
  autoReload: () => getJson<AutoReloadStatus>('/api/auto-reload'),
  autoReloadRun: async () => {
    /**
     * A deadline is allowed here, unlike on an update, because it mirrors a
     * promise the server makes rather than guessing at one: it answers as soon
     * as `claude -p` has answered, and it kills that process itself at 120 s. So
     * past this point the answer is lost, not late — and the message says so
     * without claiming the send failed, because the panel above (which polls
     * the server's own record of the run) is the one that knows.
     */
    let res: Response;
    try {
      res = await fetch('/api/auto-reload/run', { method: 'POST', signal: AbortSignal.timeout(150_000) });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error('the server never answered — the message may still have been sent, see “last message” above and the log');
      }
      throw err;
    }
    const body = (await res.json()) as { run?: AutoReloadRun; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body.run!;
  },
  // The reason travels with the request: the server cannot tell a read caused by
  // Claude answering from one caused by refocusing the tab, and the difference is
  // the whole value of the log line. Activity reads carry the sessions that
  // moved, too — with several running at once, "Claude answered" alone does not
  // say where. A failure is reported back so its retry is logged as a retry.
  usage: async () => {
    const read = takeUsageRead();
    const params = new URLSearchParams({ reason: read.trigger });
    if (read.ids?.length) params.set('ids', read.ids.slice(0, IDS_PER_READ).join(','));
    try {
      return await getJson<UsageResponse>(`/api/usage?${params.toString()}`);
    } catch (err) {
      markUsageReadFailed();
      throw err;
    }
  },
  usageRefresh: async () => {
    const res = await fetch('/api/usage/refresh', { method: 'POST' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<UsageResponse>;
  },
  clearCache: async () => {
    const res = await fetch('/api/cache/clear', { method: 'POST' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; activeSessions?: ActiveAppSession[] };
      throw refusal(res, body);
    }
    return res.json();
  },
  /** What the app is running right now, and how many it is allowed. */
  activeSessions: () => getJson<ActiveSessionsResponse>('/api/active-sessions'),
  /** Close all of them, and say what is left. The dialog's way out of a refusal. */
  closeActiveSessions: async () => {
    const res = await fetch('/api/active-sessions/close', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as ActiveSessionsResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  openDataFolder: () => fetch('/api/open-data-folder', { method: 'POST' }),
  openInstallFolder: () => fetch('/api/open-install-folder', { method: 'POST' }),
  uninstall: async (deleteData: boolean) => {
    const res = await fetch('/api/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteData }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  // Refused (409) while an update is being installed — stopping would abort it.
  stopServer: async () => {
    const res = await fetch('/api/server/stop', { method: 'POST' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; activeSessions?: ActiveAppSession[] };
      throw refusal(res, body);
    }
    return { ok: true };
  },
  /**
   * Stop and come back. The only way to change where the server listens, and
   * refused (409) mid-update or mid-answer for the same reasons stopping is.
   */
  restartServer: async () => {
    const res = await fetch('/api/server/restart', { method: 'POST' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; activeSessions?: ActiveAppSession[] };
      throw refusal(res, body);
    }
    return { ok: true };
  },
  /** Answers as soon as the server is back up. Used to wait out a restart. */
  health: async () => {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<{ ok?: boolean }>;
  },
  session: (id: string) => getJson<SessionDetailResponse>(`/api/sessions/${id}`),
  lineage: (id: string) => getJson<LineageResponse>(`/api/sessions/${id}/lineage`),
  subagent: (id: string, agentId: string) =>
    getJson<SubagentDetailResponse>(`/api/sessions/${id}/subagents/${agentId}`),
  toolResult: (path: string) => getJson<ToolResultFileResponse>(`/api/tool-results?path=${encodeURIComponent(path)}`),
  /**
   * One local file for the viewer panel. Deliberately not `getJson`: this is the
   * GET whose failure a person reads, and "Session not found" says something
   * where `404 Not Found — /api/files/read?session=…` says nothing.
   */
  fileRead: async (sessionId: string, ref: string) => {
    const res = await fetch(
      `/api/files/read?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(ref)}`,
    );
    const body = (await res.json().catch(() => ({}))) as FileReadResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  /**
   * Where an `<img>` finds the bytes of a local image. A URL builder and not a
   * fetcher: the browser does the fetching, and this exists so the encoding of
   * the two parameters lives in one place.
   */
  fileImageUrl: (sessionId: string, ref: string) =>
    `/api/files/image?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(ref)}`,
  /**
   * What the disk says about a batch of paths, for the session's file index. One
   * request for the whole panel; see the route for why a read is a POST.
   */
  fileStats: async (sessionId: string, paths: string[]) => {
    const res = await fetch('/api/files/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, paths } satisfies FileStatsRequest),
    });
    const body = (await res.json().catch(() => ({}))) as FileStatsResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  fileOpen: async (req: FileOpenRequest) => {
    const res = await fetch('/api/files/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const body = (await res.json().catch(() => ({}))) as FileOpenResponse & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
};
