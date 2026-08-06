import type {
  MetaResponse,
  ProjectsResponse,
  PromptsResponse,
  SearchResponse,
  SessionDetailResponse,
  SessionsResponse,
  SubagentDetailResponse,
  ToolResultFileResponse,
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
  session: (id: string) => getJson<SessionDetailResponse>(`/api/sessions/${id}`),
  subagent: (id: string, agentId: string) =>
    getJson<SubagentDetailResponse>(`/api/sessions/${id}/subagents/${agentId}`),
  toolResult: (path: string) => getJson<ToolResultFileResponse>(`/api/tool-results?path=${encodeURIComponent(path)}`),
};
