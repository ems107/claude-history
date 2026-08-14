import type {
  GitBranchCreateRequest,
  GitBranchDeleteRequest,
  GitBranchRenameRequest,
  GitBranchesResponse,
  GitCheckoutRequest,
  GitCherryPickRequest,
  GitCommandLogResponse,
  GitCommitDetail,
  GitCommitRequest,
  GitConflictSides,
  GitDiffMode,
  GitDiffResponse,
  GitFetchRequest,
  GitLogResponse,
  GitMergeRequest,
  GitMutationResponse,
  GitOpenTarget,
  GitOverview,
  GitPullRequest,
  GitPushRequest,
  GitRebaseRequest,
  GitRemote,
  GitResetRequest,
  GitRevertRequest,
  GitStash,
  GitStashActionRequest,
  GitStashRequest,
  GitStatus,
  GitTag,
  GitTagCreateRequest,
  GitTagDeleteRequest,
  GitTagPushRequest,
  GitWorktree,
  GitWorktreeAddRequest,
  GitWorktreeRemoveRequest,
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

  // Mutations. Every one answers with the freshly re-read status, so the caller
  // never needs a second request and cannot render a stale one.
  stage: (id: string, paths: string[]) => post<GitMutationResponse>(`/api/git/repos/${id}/stage`, { paths }),
  unstage: (id: string, paths: string[]) => post<GitMutationResponse>(`/api/git/repos/${id}/unstage`, { paths }),
  discard: (id: string, paths: string[]) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/discard`, { paths, confirm: true }),
  commitChanges: (id: string, body: GitCommitRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/commit`, body),
  checkout: (id: string, body: GitCheckoutRequest) => post<GitMutationResponse>(`/api/git/repos/${id}/checkout`, body),
  branchCreate: (id: string, body: GitBranchCreateRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/branch/create`, body),
  branchDelete: (id: string, body: GitBranchDeleteRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/branch/delete`, body),
  branchRename: (id: string, body: GitBranchRenameRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/branch/rename`, body),
  merge: (id: string, body: GitMergeRequest) => post<GitMutationResponse>(`/api/git/repos/${id}/merge`, body),
  reset: (id: string, body: GitResetRequest) => post<GitMutationResponse>(`/api/git/repos/${id}/reset`, body),
  continuation: (id: string, action: 'continue' | 'abort' | 'skip') =>
    post<GitMutationResponse>(`/api/git/repos/${id}/${action}`, {}),

  fetch: (id: string, body: GitFetchRequest = {}) => post<GitMutationResponse>(`/api/git/repos/${id}/fetch`, body),
  pull: (id: string, body: GitPullRequest = {}) => post<GitMutationResponse>(`/api/git/repos/${id}/pull`, body),
  push: (id: string, body: GitPushRequest = {}) => post<GitMutationResponse>(`/api/git/repos/${id}/push`, body),
  pushTag: (id: string, body: GitTagPushRequest) => post<GitMutationResponse>(`/api/git/repos/${id}/tag/push`, body),

  rebase: (id: string, body: GitRebaseRequest) => post<GitMutationResponse>(`/api/git/repos/${id}/rebase`, body),
  cherryPick: (id: string, body: GitCherryPickRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/cherry-pick`, body),
  revert: (id: string, body: GitRevertRequest) => post<GitMutationResponse>(`/api/git/repos/${id}/revert`, body),

  stash: (id: string, body: GitStashRequest) => post<GitMutationResponse>(`/api/git/repos/${id}/stash`, body),
  stashAction: (id: string, action: 'apply' | 'pop' | 'drop', body: GitStashActionRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/stash/${action}`, body),

  tagCreate: (id: string, body: GitTagCreateRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/tag/create`, body),
  tagDelete: (id: string, body: GitTagDeleteRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/tag/delete`, body),

  worktreeAdd: (id: string, body: GitWorktreeAddRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/worktree/add`, body),
  worktreeRemove: (id: string, body: GitWorktreeRemoveRequest) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/worktree/remove`, body),

  /** Stage, unstage or discard a single hunk of one file. */
  hunk: (id: string, body: { path: string; hunkIndex: number; staged?: boolean; discard?: boolean; confirm?: boolean }) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/hunk`, body),

  /** Stage or unstage individual lines of one hunk. Never discards — see the server. */
  lines: (id: string, body: { path: string; hunkIndex: number; lines: number[]; staged?: boolean }) =>
    post<GitMutationResponse>(`/api/git/repos/${id}/lines`, body),

  conflictSides: (id: string, filePath: string) =>
    getJson<GitConflictSides>(`/api/git/repos/${id}/diff?mode=conflict&path=${encodeURIComponent(filePath)}`),
};
