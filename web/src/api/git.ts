import type {
  GitBranchesResponse,
  GitCommandLogResponse,
  GitCommitDetail,
  GitDiffMode,
  GitDiffResponse,
  GitLogResponse,
  GitOpenTarget,
  GitOverview,
  GitRemote,
  GitStash,
  GitStatus,
  GitTag,
  GitWorktree,
} from '@claude-history/shared';
import { getJson } from './client.ts';

/**
 * The git tab's slice of the API.
 *
 * Its own module rather than another twenty entries on the flat `api` object,
 * but it imports that module's `getJson` on purpose: the error contract — the
 * exact string a failed GET throws — has to live in one place, and mutations
 * keep the shape that surfaces the SERVER's message rather than a status code,
 * because every refusal here was written to be read by a person.
 */
async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
  return payload;
}

export const gitApi = {
  overview: (refresh = false) => getJson<GitOverview>(`/api/git${refresh ? '?refresh=1' : ''}`),

  addPath: (path: string, asRoot: boolean) =>
    post<{ ok: true; path: string; overview: GitOverview }>('/api/git/repos', { path, asRoot }),
  removePath: (path: string, asRoot: boolean) =>
    post<{ ok: true; overview: GitOverview }>('/api/git/repos/remove', { path, asRoot }),
  refreshRepos: () => post<{ ok: true; overview: GitOverview }>('/api/git/repos/refresh'),
  setHidden: (id: string, hidden: boolean) =>
    post<{ ok: true; overview: GitOverview }>(`/api/git/repos/${id}/hidden`, { hidden }),
  open: (id: string, target: GitOpenTarget) => post<{ ok: true }>(`/api/git/repos/${id}/open`, { target }),

  log: (id: string, opts: { offset?: number; ref?: string | null; path?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (opts.offset) params.set('offset', String(opts.offset));
    if (opts.ref) params.set('ref', opts.ref);
    if (opts.path) params.set('path', opts.path);
    const query = params.toString();
    return getJson<GitLogResponse>(`/api/git/repos/${id}/log${query ? `?${query}` : ''}`);
  },

  commit: (id: string, sha: string) => getJson<GitCommitDetail>(`/api/git/repos/${id}/commit/${sha}`),
  diff: (
    id: string,
    opts: { mode: GitDiffMode; sha?: string | null; base?: string | null; path?: string | null; context?: number },
  ) => {
    const params = new URLSearchParams({ mode: opts.mode });
    if (opts.sha) params.set('sha', opts.sha);
    if (opts.base) params.set('base', opts.base);
    if (opts.path) params.set('path', opts.path);
    if (opts.context !== undefined) params.set('context', String(opts.context));
    return getJson<GitDiffResponse>(`/api/git/repos/${id}/diff?${params}`);
  },

  status: (id: string) => getJson<GitStatus>(`/api/git/repos/${id}/status`),
  branches: (id: string) => getJson<GitBranchesResponse>(`/api/git/repos/${id}/branches`),
  stashes: (id: string) => getJson<GitStash[]>(`/api/git/repos/${id}/stashes`),
  tags: (id: string) => getJson<GitTag[]>(`/api/git/repos/${id}/tags`),
  remotes: (id: string) => getJson<GitRemote[]>(`/api/git/repos/${id}/remotes`),
  worktrees: (id: string) => getJson<GitWorktree[]>(`/api/git/repos/${id}/worktrees`),

  commands: (since: number, limit: number) =>
    getJson<GitCommandLogResponse>(`/api/git/commands?since=${since}&limit=${limit}`),
};
