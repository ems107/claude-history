import type {
  LineageResponse,
  MetaResponse,
  PriceTable,
  ProjectsResponse,
  PromptsResponse,
  SearchResponse,
  SessionDetailResponse,
  SessionsResponse,
  SubagentDetailResponse,
  ToolResultFileResponse,
  UpdateStatusResponse,
} from '@claude-history/shared';

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
  updateApply: async () => {
    const res = await fetch('/api/update/apply', { method: 'POST' });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  },
  session: (id: string) => getJson<SessionDetailResponse>(`/api/sessions/${id}`),
  lineage: (id: string) => getJson<LineageResponse>(`/api/sessions/${id}/lineage`),
  subagent: (id: string, agentId: string) =>
    getJson<SubagentDetailResponse>(`/api/sessions/${id}/subagents/${agentId}`),
  toolResult: (path: string) => getJson<ToolResultFileResponse>(`/api/tool-results?path=${encodeURIComponent(path)}`),
};
