import type {
  AppSettings,
  AutoReloadRun,
  AutoReloadStatus,
  LineageResponse,
  LogDayResponse,
  LogsResponse,
  MetaResponse,
  PriceTable,
  ProjectsResponse,
  PromptsResponse,
  SearchResponse,
  SessionDetailResponse,
  SessionsResponse,
  SubagentDetailResponse,
  ToolResultFileResponse,
  UpdateLogResponse,
  UpdateStatusResponse,
  UsageResponse,
} from '@claude-history/shared';
import { takeUsageReason } from './usageReason.ts';

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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => getJson<MetaResponse>('/api/meta'),
  sessions: () => getJson<SessionsResponse>('/api/sessions'),
  projects: () => getJson<ProjectsResponse>('/api/projects'),
  prompts: () => getJson<PromptsResponse>('/api/prompts'),
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
  search: (q: string, scope?: string) =>
    getJson<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}${scope ? `&in=${encodeURIComponent(scope)}` : ''}`),
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
    const res = await fetch('/api/auto-reload/run', { method: 'POST' });
    const body = (await res.json()) as { run?: AutoReloadRun; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body.run!;
  },
  // The reason travels with the request: the server cannot tell a read caused by
  // Claude answering from one caused by refocusing the tab, and the difference is
  // the whole value of the log line.
  usage: () => getJson<UsageResponse>(`/api/usage?reason=${takeUsageReason('widget')}`),
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
  stopServer: () => fetch('/api/server/stop', { method: 'POST' }),
  session: (id: string) => getJson<SessionDetailResponse>(`/api/sessions/${id}`),
  lineage: (id: string) => getJson<LineageResponse>(`/api/sessions/${id}/lineage`),
  subagent: (id: string, agentId: string) =>
    getJson<SubagentDetailResponse>(`/api/sessions/${id}/subagents/${agentId}`),
  toolResult: (path: string) => getJson<ToolResultFileResponse>(`/api/tool-results?path=${encodeURIComponent(path)}`),
};
