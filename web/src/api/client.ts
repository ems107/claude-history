import type {
  AppSettings,
  AutoReloadRun,
  AutoReloadStatus,
  ChatSendRequest,
  ChatStatusResponse,
  FileOpenRequest,
  FileOpenResponse,
  FileReadResponse,
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
  SubagentDetailResponse,
  ToolResultFileResponse,
  UpdateLogResponse,
  UpdateStatusResponse,
  UsageResponse,
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

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => getJson<MetaResponse>('/api/meta'),
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
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
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
  chatAnswer: async (id: string, answers: Record<string, string | string[]> | null) => {
    const res = await fetch(`/api/sessions/${id}/chat/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    const payload = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
    return payload;
  },
  // Opens the process without sending a prompt, so the composer can offer the
  // real model list — which only a running CLI knows.
  chatStart: async (id: string, body: { model?: string; effort?: string | null }) => {
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
  settings: () => getJson<SettingsResponse>('/api/settings'),
  saveSettings: async (patch: Partial<AppSettings>) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<{ settings: AppSettings }>;
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
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
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
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    }
    return { ok: true };
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
