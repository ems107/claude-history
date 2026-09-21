import type {
  RevisionBranchOption,
  RevisionCommentRecord,
  RevisionDiffResponse,
  RevisionRepoCheck,
  RevisionRepoInfo,
  RevisionReviewsResponse,
  RevisionReviewUpdateResponse,
} from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { probe, type GitRepoHandle } from '../core/gitRepos.ts';
import { normalizeProjectKey } from '../core/projects.ts';
import { UUID_RE } from '../core/scanner.ts';
import { abortSignalOf } from '../util/replyAbort.ts';
import { isSameOrigin } from '../util/sameOrigin.ts';
import { sendGitError } from './git.ts';

/**
 * Reviewing what a branch introduced, from the session that is working on it.
 *
 * ## Why this is not part of the GIT tab's routes
 *
 * Because it addresses a repository differently, and deliberately. Every route
 * in `git.ts` starts from a `GitRepo.id`, which is an opaque handle for a path
 * the user added to that tab — the mechanism that keeps a path from ever
 * arriving in a request. This starts from a SESSION, whose project path the
 * index already holds, and resolves the repository from that: the folder Claude
 * Code was launched in is not something the reader has to go and register
 * somewhere else before they can review the branch they are sitting on.
 *
 * The rule is intact either way — the path still comes from the index and never
 * from the request. What the request names is the session.
 *
 * Everything here is a READ. There is no verb in this panel that writes to a
 * repository, which is what makes it safe to point at the folder a live session
 * is working in.
 */

/** Keys and ids are minted in the browser; the server refuses what a segment must not hold. */
const KEY_RE = /^[A-Za-z0-9_-]{1,120}$/;
/** Enough for any remark worth reading; a pasted log is not one. */
const COMMENT_TEXT_MAX = 10_000;
/** What a quote is cut to, matching the web's own `QUOTE_MAX`. */
const QUOTE_MAX = 240;
/**
 * The fragment of diff a remark carries with it.
 *
 * Generous, because this is the remark's whole context and cutting it is
 * cutting the thing that makes it readable — a hunk of a big edit with forty
 * lines of context is still one hunk. Bounded all the same: it arrives over the
 * wire, and `userdata.json` keeps it for as long as the session exists.
 */
const DIFF_TEXT_MAX = 20_000;
/** git's own limit, and the branch names go into the copied prose. */
const BRANCH_NAME_MAX = 255;

/**
 * Take a remark off the wire.
 *
 * The branch names come with every write rather than being kept from the first
 * one: they head the copied prose, and only the client knows which comparison
 * is actually on screen.
 */
function readComment(
  id: string,
  body: unknown,
): { comment: RevisionCommentRecord; currentBranch: string; baseBranch: string } | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const currentBranch = typeof b.currentBranch === 'string' ? b.currentBranch.trim() : '';
  const baseBranch = typeof b.baseBranch === 'string' ? b.baseBranch.trim() : '';
  const path = typeof b.path === 'string' ? b.path.trim() : '';
  const quote = typeof b.quote === 'string' ? b.quote.trim() : '';
  const diffText = typeof b.diffText === 'string' ? b.diffText : '';
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!currentBranch || !baseBranch) return 'A comment must say which two branches it is about';
  if (!path) return 'A comment must name the file it is about';
  if (path.includes('\0')) return 'That is not a usable path';
  if (!diffText) return 'A comment must carry the fragment of diff it is about';
  if (diffText.length > DIFF_TEXT_MAX) return 'That fragment of diff is too large to keep';
  if (!text) return 'A comment must say something';
  if (text.length > COMMENT_TEXT_MAX) return `A comment is at most ${String(COMMENT_TEXT_MAX)} characters`;
  const line = Number(b.line);
  const endLine = Number(b.endLine);
  const first = Number.isFinite(line) && line >= 1 ? Math.floor(line) : null;
  return {
    currentBranch: currentBranch.slice(0, BRANCH_NAME_MAX),
    baseBranch: baseBranch.slice(0, BRANCH_NAME_MAX),
    comment: {
      id,
      path,
      quote: quote.slice(0, QUOTE_MAX),
      diffText,
      // Null is honest here where the file's remarks fall back to 1: a
      // selection that starts on a hunk header belongs to no line of either
      // side, and the fragment above it says where it is anyway.
      line: first,
      endLine: first !== null && Number.isFinite(endLine) && endLine >= first ? Math.floor(endLine) : first,
      side: b.side === 'old' || b.side === 'new' ? b.side : null,
      text,
      createdAt: '',
      editedAt: null,
    },
  };
}

/** The first lookup: which repository, if any, this session is sitting in. */
type Resolved =
  | { ok: true; handle: GitRepoHandle }
  /** Not a repository — a 200 the panel draws, never an error. */
  | { ok: false; notRepo: true }
  | { ok: false; notRepo: false; code: number; error: string };

async function resolveSessionRepo(ctx: AppContext, sessionId: string): Promise<Resolved> {
  if (!UUID_RE.test(sessionId)) return { ok: false, notRepo: false, code: 400, error: 'Invalid session id' };
  const summary = ctx.index.get(sessionId);
  if (!summary) return { ok: false, notRepo: false, code: 404, error: 'Session not found' };
  const info = await probe(summary.projectPath);
  // Covers three ordinary cases at once: a folder that is not a work tree, one
  // that has been moved or deleted, and a session whose transcript never
  // recorded a cwd — that one's `projectPath` is the lossy encoded directory
  // name, which is a folder nowhere.
  if (!info) return { ok: false, notRepo: true };
  /**
   * The TOP LEVEL, and keyed exactly as discovery keys it.
   *
   * Two things follow, both wanted. A session running in a subdirectory of a
   * checkout reviews that checkout rather than nothing. And when the same
   * repository is also known to the GIT tab, the two agree on its key — so they
   * queue on one `withRepoLock` instead of running a status and a diff at each
   * other, and the command panel files both under the same repository.
   */
  return { ok: true, handle: { path: info.top, key: normalizeProjectKey(info.top) } };
}

/** Nothing to compare: not a repository, or a HEAD with no branch name. */
const NOTHING: RevisionRepoInfo = {
  isRepo: false,
  currentBranch: null,
  detached: false,
  branches: [],
  suggestedBase: null,
  resumed: false,
};

export function registerRevisionRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Is there a branch here to review — and nothing else.
   *
   * The rail asks this, once per session view, to decide whether the panel
   * exists at all. It is its own route rather than a field of `info` because
   * of what `info` COSTS: a branch listing and, when there is no review to
   * resume, one `git merge-base` per branch. On a repository with thirty
   * branches that is thirty-odd process spawns — on Windows, where a spawn is
   * the expensive part — for a panel most readers will not open. Two spawns
   * against thirty is the whole reason these are two routes.
   */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/revision/repo', async (request, reply) => {
    if (!isSameOrigin(request)) return reply.code(403).send({ error: 'Cross-origin request refused' });
    const resolved = await resolveSessionRepo(ctx, request.params.id);
    if (!resolved.ok && !resolved.notRepo) return reply.code(resolved.code).send({ error: resolved.error });
    return { isRepo: resolved.ok } satisfies RevisionRepoCheck;
  });

  /**
   * The branches, and what the dropdown should open on.
   *
   * The suggestion is worked out here rather than in the browser because two of
   * its four steps are git questions and one is a userdata lookup, and because
   * the order they are asked in IS the feature: a review you already started
   * beats a guess about where the branch came from.
   */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/revision/info', async (request, reply) => {
    if (!isSameOrigin(request)) return reply.code(403).send({ error: 'Cross-origin request refused' });
    const resolved = await resolveSessionRepo(ctx, request.params.id);
    if (!resolved.ok) {
      if (resolved.notRepo) return NOTHING satisfies RevisionRepoInfo;
      return reply.code(resolved.code).send({ error: resolved.error });
    }
    const { handle } = resolved;
    try {
      const branches = await ctx.git.branches(handle, abortSignalOf(reply));
      const current = branches.current;
      // A detached HEAD is a real place to be and nothing to review FROM: there
      // is no name to file a basket under and no "this branch" to speak of.
      if (!current) return { ...NOTHING, isRepo: true, detached: true } satisfies RevisionRepoInfo;

      const options: RevisionBranchOption[] = [
        ...branches.local
          .filter((b) => b.name !== current)
          .map((b) => ({ ref: b.name, kind: 'local' as const, lastCommitAt: b.lastCommitAt })),
        ...branches.remote.map((b) => ({
          ref: `${b.remote}/${b.name}`,
          kind: 'remote' as const,
          lastCommitAt: b.lastCommitAt,
        })),
      ];
      const known = new Set(options.map((o) => o.ref));

      // 1. The review already under way on this branch, newest first. It wins
      //    over every guess: somebody who left remarks yesterday is coming back
      //    to them, not asking to be told where the branch came from.
      const resumedBase = ctx.index
        .listRevisionReviews(request.params.id)
        .filter((r) => r.currentBranch === current && r.comments.length > 0 && known.has(r.baseBranch))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.baseBranch;
      if (resumedBase) {
        return {
          isRepo: true,
          currentBranch: current,
          detached: false,
          branches: options,
          suggestedBase: resumedBase,
          resumed: true,
        } satisfies RevisionRepoInfo;
      }

      // 2. The guess, then 3. the remote's default or a local main/master.
      const guessed = await ctx.git.guessOriginBranch(
        handle,
        current,
        branches.local,
        branches.remote,
        abortSignalOf(reply),
      );
      let suggested = guessed;
      if (!suggested) {
        const fallback = await ctx.git.defaultRemoteBranch(handle, abortSignalOf(reply));
        const names = [fallback, 'main', 'master'].filter((n): n is string => !!n && n !== current);
        suggested =
          names.map((n) => (known.has(n) ? n : known.has(`origin/${n}`) ? `origin/${n}` : null)).find(Boolean) ?? null;
      }
      return {
        isRepo: true,
        currentBranch: current,
        detached: false,
        branches: options,
        suggestedBase: suggested,
        resumed: false,
      } satisfies RevisionRepoInfo;
    } catch (err) {
      return sendGitError(reply, err);
    }
  });

  /**
   * What the current branch introduced since it diverged from `base`.
   *
   * A pull request's diff, built out of the two-dot range `diff` already runs:
   * the base it is handed is the MERGE-BASE rather than the base branch's tip,
   * and `merge-base..head` is what `base...head` means. So the base's own
   * commits since the fork do not appear, which is the entire difference
   * between reviewing a branch and diffing two of them.
   */
  app.get<{ Params: { id: string }; Querystring: { base?: string } }>(
    '/api/sessions/:id/revision/diff',
    async (request, reply) => {
      if (!isSameOrigin(request)) return reply.code(403).send({ error: 'Cross-origin request refused' });
      const base = request.query.base?.trim();
      if (!base) return reply.code(400).send({ error: 'Name a branch to compare against.' });
      const resolved = await resolveSessionRepo(ctx, request.params.id);
      if (!resolved.ok) {
        if (resolved.notRepo) return reply.code(409).send({ error: 'This session did not run in a git repository.' });
        return reply.code(resolved.code).send({ error: resolved.error });
      }
      const { handle } = resolved;
      try {
        const branches = await ctx.git.branches(handle, abortSignalOf(reply));
        const current = branches.current;
        if (!current) return reply.code(409).send({ error: 'HEAD is detached — there is no branch to review.' });

        // Both ends resolved FIRST, and that is not tidiness: `merge-base`
        // exits non-zero for a ref that does not exist as readily as for two
        // that share no ancestor, so without this a mistyped branch would be
        // reported as "these have no common history" — a sentence about the
        // repository, where the truth is a sentence about the request.
        const currentSha = await ctx.git.resolveSha(handle, current, abortSignalOf(reply));
        const baseSha = await ctx.git.resolveSha(handle, base, abortSignalOf(reply));
        const mergeBaseSha = await ctx.git.mergeBase(handle, currentSha, baseSha, abortSignalOf(reply));
        if (!mergeBaseSha) {
          // Not an error: two branches with no common ancestor is a real shape,
          // and the honest answer is that there is no "since it diverged".
          return {
            ok: false,
            currentBranch: current,
            baseBranch: base,
            mergeBaseSha: null,
            files: [],
            truncated: false,
            error: `\`${current}\` and \`${base}\` share no history, so there is no point they diverged from.`,
          } satisfies RevisionDiffResponse;
        }
        const diff = await ctx.git.diff(
          handle,
          { mode: 'range', base: mergeBaseSha, sha: currentSha },
          abortSignalOf(reply),
        );
        return {
          ok: true,
          currentBranch: current,
          baseBranch: base,
          mergeBaseSha,
          files: diff.files,
          truncated: diff.truncated,
          error: null,
        } satisfies RevisionDiffResponse;
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ------------------------------------------------------------- the remarks
  //
  // From here down nothing touches git at all: these read and write
  // `userdata.json`, exactly as the plan stacks and the file baskets do, and
  // they answer for a comparison whose branches may have moved or gone. That
  // is the point — a remark is frozen prose the moment it is written.

  app.get<{ Params: { id: string } }>('/api/sessions/:id/revision-reviews', async (request, reply) => {
    if (!isSameOrigin(request)) return reply.code(403).send({ error: 'Cross-origin request refused' });
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    return ctx.index.listRevisionReviews(id) satisfies RevisionReviewsResponse;
  });

  app.put<{ Params: { id: string; comparisonKey: string; commentId: string }; Body: unknown }>(
    '/api/sessions/:id/revision-reviews/:comparisonKey/comments/:commentId',
    async (request, reply) => {
      const { id, comparisonKey, commentId } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!KEY_RE.test(comparisonKey)) return reply.code(400).send({ error: 'Invalid comparison key' });
      if (!KEY_RE.test(commentId)) return reply.code(400).send({ error: 'Invalid comment id' });
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });
      const parsed = readComment(commentId, request.body);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
      const review = await ctx.index.setRevisionComment(
        id,
        comparisonKey,
        { currentBranch: parsed.currentBranch, baseBranch: parsed.baseBranch },
        parsed.comment,
      );
      return { ok: true, review, removed: false } satisfies RevisionReviewUpdateResponse;
    },
  );

  app.delete<{ Params: { id: string; comparisonKey: string; commentId: string } }>(
    '/api/sessions/:id/revision-reviews/:comparisonKey/comments/:commentId',
    async (request, reply) => {
      const { id, comparisonKey, commentId } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!KEY_RE.test(comparisonKey)) return reply.code(400).send({ error: 'Invalid comparison key' });
      if (!KEY_RE.test(commentId)) return reply.code(400).send({ error: 'Invalid comment id' });
      // Asks nothing about the session, for the star's reason — and nothing
      // about the branches either: a remark on a branch that has since been
      // deleted is exactly the one that has to stay removable.
      const { removed, review } = await ctx.index.removeRevisionComment(id, comparisonKey, commentId);
      return { ok: true, review, removed } satisfies RevisionReviewUpdateResponse;
    },
  );

  app.delete<{ Params: { id: string; comparisonKey: string } }>(
    '/api/sessions/:id/revision-reviews/:comparisonKey',
    async (request, reply) => {
      const { id, comparisonKey } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!KEY_RE.test(comparisonKey)) return reply.code(400).send({ error: 'Invalid comparison key' });
      const removed = await ctx.index.clearRevisionReview(id, comparisonKey);
      return { ok: true, review: null, removed } satisfies RevisionReviewUpdateResponse;
    },
  );

  app.post<{ Params: { id: string; comparisonKey: string } }>(
    '/api/sessions/:id/revision-reviews/:comparisonKey/copied',
    async (request, reply) => {
      const { id, comparisonKey } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!KEY_RE.test(comparisonKey)) return reply.code(400).send({ error: 'Invalid comparison key' });
      const review = await ctx.index.markRevisionReviewCopied(id, comparisonKey);
      if (!review) return reply.code(404).send({ error: 'No comments on that comparison' });
      return { ok: true, review, removed: false } satisfies RevisionReviewUpdateResponse;
    },
  );
}
