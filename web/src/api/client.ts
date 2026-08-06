import type { MetaResponse, ProjectsResponse, SearchResponse, SessionsResponse } from '@claude-history/shared';

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
};
