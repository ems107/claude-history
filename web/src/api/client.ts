import type {
  MetaResponse,
  ProjectsResponse,
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
  search: (q: string) => getJson<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`),
  session: (id: string) => getJson<SessionDetailResponse>(`/api/sessions/${id}`),
  subagent: (id: string, agentId: string) =>
    getJson<SubagentDetailResponse>(`/api/sessions/${id}/subagents/${agentId}`),
  toolResult: (path: string) => getJson<ToolResultFileResponse>(`/api/tool-results?path=${encodeURIComponent(path)}`),
};
