import {
  GIT_LOG_PAGE,
  type GitAddRepoRequest,
  type GitBranchCreateRequest,
  type GitBranchDeleteRequest,
  type GitBranchRenameRequest,
  type GitCheckoutRequest,
  type GitCommitRequest,
  type GitFetchRequest,
  type GitMergeRequest,
  type GitPullRequest,
  type GitPushRequest,
  type GitTagPushRequest,
  type GitOpenRequest,
  type GitOverview,
  type GitPathsRequest,
  type GitResetRequest,
  type GitStatus,
} from '@claude-history/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.ts';
import type { ResolvedRepo } from '../core/gitRepos.ts';
import { GitBadInput, GitBlocked, GitFailed } from '../core/gitService.ts';

interface GitMutationResult {
  status: GitStatus;
  message?: string;
}
import { createLogger } from '../core/logger.ts';
import { GIT_AUTH_HINT, GitSpawnError, gitErrorLine, isAuthFailure, isNonFastForward } from '../util/git.ts';
import { launchShell, openInExplorer, openInVsCode } from '../util/launcher.ts';
import { abortSignalOf } from '../util/replyAbort.ts';

const log = createLogger('git');

/** Entries a single command-panel page may carry. */
const COMMANDS_LIMIT = 500;

/**
 * The one place a git failure becomes an HTTP answer.
 *
 * Every case here is a real answer rather than a crash, so none of them is a
 * 500: a refusal the repository's own state produced is a 409 carrying the
 * exact string the disabled button shows, a bad body is a 400, and a command
 * that ran and said no is a 409 with git's own words — translated only where
 * git's words are useless on their own.
 */
export function sendGitError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof GitBlocked) return reply.code(409).send({ error: err.message });
  if (err instanceof GitBadInput) return reply.code(400).send({ error: err.message });
  if (err instanceof GitSpawnError) return reply.code(500).send({ error: err.message });
  if (err instanceof GitFailed) {
    const { result } = err;
    if (isAuthFailure(result.stderr)) {
      return reply.code(409).send({ error: GIT_AUTH_HINT, gitStderr: result.stderr.trim().slice(0, 2_000) });
    }
    if (isNonFastForward(result.stderr)) {
      return reply.code(409).send({
        error: 'The remote has commits you do not have — fetch and rebase, then push again.',
        gitStderr: result.stderr.trim().slice(0, 2_000),
      });
    }
    return reply.code(409).send({ error: gitErrorLine(result), gitStderr: result.stderr.trim().slice(0, 2_000) });
  }
  return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
}

export function registerGitRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---------------------------------------------------------------- overview

  app.get<{ Querystring: { refresh?: string } }>('/api/git', async (request): Promise<GitOverview> => {
    return ctx.git.overview(request.query.refresh === '1');
  });

  // ---------------------------------------------------------------- the list

  // POST rather than PUT/DELETE because everything mutating in this app is a
  // POST, and because only non-GET requests pass the same-origin hook at all.
  app.post<{ Body: GitAddRepoRequest }>('/api/git/repos', async (request, reply) => {
    const body = request.body ?? { path: '' };
    if (typeof body.path !== 'string') return reply.code(400).send({ error: 'path is required' });
    try {
      const stored = await ctx.git.addPath(body.path, body.asRoot === true);
      return { ok: true, path: stored, overview: await ctx.git.overview() };
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  app.post<{ Body: { path?: unknown; asRoot?: unknown } }>('/api/git/repos/remove', async (request, reply) => {
    const target = request.body?.path;
    if (typeof target !== 'string' || !target) return reply.code(400).send({ error: 'path is required' });
    try {
      await ctx.git.removePath(target, request.body?.asRoot === true);
      return { ok: true, overview: await ctx.git.overview() };
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  app.post('/api/git/repos/refresh', async () => ({ ok: true, overview: await ctx.git.overview(true) }));

  app.post<{ Params: { id: string }; Body: { hidden?: unknown } }>(
    '/api/git/repos/:id/hidden',
    async (request, reply) => {
      try {
        await ctx.git.setHidden(request.params.id, request.body?.hidden === true);
        return { ok: true, overview: await ctx.git.overview() };
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------------------------------------------------------------- escape hatch

  /**
   * Open the repository outside the app. This is what makes "resolve the
   * conflict elsewhere" and "store your credentials once in a terminal" real
   * answers instead of dead ends — and the folder comes from the resolved repo,
   * never from the request.
   */
  app.post<{ Params: { id: string }; Body: GitOpenRequest }>('/api/git/repos/:id/open', async (request, reply) => {
    const repo = ctx.git.repo(request.params.id);
    if (!repo) return reply.code(404).send({ error: 'Repository not found' });
    const target = request.body?.target;
    if (target !== 'explorer' && target !== 'vscode' && target !== 'terminal') {
      return reply.code(400).send({ error: 'target must be explorer, vscode or terminal' });
    }
    try {
      if (target === 'explorer') await openInExplorer(repo.path);
      else if (target === 'vscode') await openInVsCode(repo.path);
      else await launchShell(repo.path);
      log.info(`opened ${repo.name} in ${target}`);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: `Could not open ${target}: ${String(err)}` });
    }
  });

  // ---------------------------------------------------------------- reading

  /**
   * Resolve `:id` to a repository, or answer 404. This is the ONLY way a path
   * is ever obtained: nothing downstream reads one from the request.
   */
  const repoOf = (id: string, reply: FastifyReply) => {
    const repo = ctx.git.repo(id);
    if (!repo) {
      void reply.code(404).send({ error: 'Repository not found' });
      return null;
    }
    return repo;
  };

  app.get<{ Params: { id: string } }>('/api/git/repos/:id/status', async (request, reply) => {
    const repo = repoOf(request.params.id, reply);
    if (!repo) return reply;
    try {
      return await ctx.git.status(repo, abortSignalOf(reply));
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; ref?: string; path?: string } }>(
    '/api/git/repos/:id/log',
    async (request, reply) => {
      const repo = repoOf(request.params.id, reply);
      if (!repo) return reply;
      const limit = Number(request.query.limit ?? GIT_LOG_PAGE);
      const offset = Number(request.query.offset ?? 0);
      try {
        return await ctx.git.log(
          repo,
          {
            limit: Number.isFinite(limit) ? limit : GIT_LOG_PAGE,
            offset: Number.isFinite(offset) ? offset : 0,
            ref: request.query.ref ?? null,
            path: request.query.path ?? null,
          },
          abortSignalOf(reply),
        );
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/git/repos/:id/branches', async (request, reply) => {
    const repo = repoOf(request.params.id, reply);
    if (!repo) return reply;
    try {
      return await ctx.git.branches(repo, abortSignalOf(reply));
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  app.get<{ Params: { id: string; sha: string } }>('/api/git/repos/:id/commit/:sha', async (request, reply) => {
    const repo = repoOf(request.params.id, reply);
    if (!repo) return reply;
    try {
      return await ctx.git.commitDetail(repo, request.params.sha, abortSignalOf(reply));
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { mode?: string; sha?: string; base?: string; path?: string; context?: string };
  }>('/api/git/repos/:id/diff', async (request, reply) => {
    const repo = repoOf(request.params.id, reply);
    if (!repo) return reply;
    const mode = request.query.mode ?? 'worktree';
    if (mode !== 'worktree' && mode !== 'staged' && mode !== 'commit' && mode !== 'range' && mode !== 'conflict') {
      return reply.code(400).send({ error: 'Unknown diff mode' });
    }
    const context = Number(request.query.context ?? 3);
    try {
      return await ctx.git.diff(
        repo,
        {
          mode,
          sha: request.query.sha ?? null,
          base: request.query.base ?? null,
          path: request.query.path ?? null,
          context: Number.isFinite(context) ? context : 3,
        },
        abortSignalOf(reply),
      );
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>('/api/git/repos/:id/stashes', async (request, reply) => {
    const repo = repoOf(request.params.id, reply);
    if (!repo) return reply;
    try {
      return await ctx.git.stashes(repo, abortSignalOf(reply));
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>('/api/git/repos/:id/tags', async (request, reply) => {
    const repo = repoOf(request.params.id, reply);
    if (!repo) return reply;
    try {
      return await ctx.git.tags(repo, abortSignalOf(reply));
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>('/api/git/repos/:id/remotes', async (request, reply) => {
    const repo = repoOf(request.params.id, reply);
    if (!repo) return reply;
    try {
      return await ctx.git.remotes(repo, abortSignalOf(reply));
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>('/api/git/repos/:id/worktrees', async (request, reply) => {
    const repo = repoOf(request.params.id, reply);
    if (!repo) return reply;
    try {
      return await ctx.git.worktrees(repo, abortSignalOf(reply));
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  // ---------------------------------------------------------------- writing

  /**
   * Every one of these is a POST, and not for style: the same-origin hook in
   * app.ts exempts GET/HEAD/OPTIONS, so a mutating GET would have no CSRF
   * protection at all — and these rewrite people's repositories.
   *
   * They all answer `{ok: true, status, message?}` with the freshly re-read
   * status, so the page cannot draw a stale one and needs no second request.
   */
  const mutation = <B>(
    path: string,
    run: (repo: ResolvedRepo, body: B, reply: FastifyReply) => Promise<GitMutationResult>,
  ) => {
    app.post<{ Params: { id: string }; Body: B }>(path, async (request, reply) => {
      const repo = repoOf(request.params.id, reply);
      if (!repo) return reply;
      try {
        const { status, message } = await run(repo, (request.body ?? {}) as B, reply);
        return { ok: true as const, status, ...(message ? { message } : {}) };
      } catch (err) {
        return sendGitError(reply, err);
      }
    });
  };

  mutation<GitPathsRequest>('/api/git/repos/:id/stage', (repo, body) => ctx.git.stage(repo, body.paths));
  mutation<GitPathsRequest>('/api/git/repos/:id/unstage', (repo, body) => ctx.git.unstage(repo, body.paths));
  mutation<GitPathsRequest>('/api/git/repos/:id/discard', (repo, body) =>
    ctx.git.discard(repo, body.paths, body.confirm),
  );
  mutation<GitCommitRequest>('/api/git/repos/:id/commit', (repo, body) => ctx.git.createCommit(repo, body));
  mutation<GitCheckoutRequest>('/api/git/repos/:id/checkout', (repo, body) => ctx.git.checkout(repo, body));
  mutation<GitBranchCreateRequest>('/api/git/repos/:id/branch/create', (repo, body) =>
    ctx.git.branchCreate(repo, body),
  );
  mutation<GitBranchDeleteRequest>('/api/git/repos/:id/branch/delete', (repo, body) =>
    ctx.git.branchDelete(repo, body),
  );
  mutation<GitBranchRenameRequest>('/api/git/repos/:id/branch/rename', (repo, body) =>
    ctx.git.branchRename(repo, body),
  );
  mutation<GitMergeRequest>('/api/git/repos/:id/merge', (repo, body) => ctx.git.merge(repo, body));
  mutation<GitResetRequest>('/api/git/repos/:id/reset', (repo, body) => ctx.git.reset(repo, body));

  // The network ones. They can take a while, so each is cancellable by the
  // caller going away — the signal is the RESPONSE closing, never the request's.
  mutation<GitFetchRequest>('/api/git/repos/:id/fetch', (repo, body, reply) =>
    ctx.git.fetch(repo, body, abortSignalOf(reply)),
  );
  mutation<GitPullRequest>('/api/git/repos/:id/pull', (repo, body, reply) =>
    ctx.git.pull(repo, body, abortSignalOf(reply)),
  );
  mutation<GitPushRequest>('/api/git/repos/:id/push', (repo, body, reply) =>
    ctx.git.push(repo, body, abortSignalOf(reply)),
  );
  mutation<GitTagPushRequest>('/api/git/repos/:id/tag/push', (repo, body, reply) =>
    ctx.git.pushTag(repo, body, abortSignalOf(reply)),
  );

  for (const action of ['continue', 'abort', 'skip'] as const) {
    mutation<Record<string, never>>(`/api/git/repos/:id/${action}`, (repo) => ctx.git.continuation(repo, action));
  }

  // ---------------------------------------------------------------- command panel

  app.get<{ Querystring: { since?: string; limit?: string } }>('/api/git/commands', async (request) => {
    const since = Number(request.query.since ?? 0);
    const limit = Number(request.query.limit ?? COMMANDS_LIMIT);
    return ctx.git.commands(
      Number.isFinite(since) && since > 0 ? Math.floor(since) : 0,
      Math.min(COMMANDS_LIMIT, Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : COMMANDS_LIMIT),
    );
  });
}
