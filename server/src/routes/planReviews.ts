import type {
  PlanCommentRecord,
  PlanDraftResponse,
  PlanReviewsResponse,
  PlanReviewUpdateResponse,
} from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { resolvePlan } from '../core/planFile.ts';
import { UUID_RE } from '../core/scanner.ts';
import { isSameOrigin } from '../util/sameOrigin.ts';

/**
 * A plan's key is the `ExitPlanMode` call's `toolUseId` — `toolu_` and 24
 * characters today, but the shape is Anthropic's and has moved before, so this
 * bounds it rather than describing it. It travels in a URL path, so what
 * matters is that it holds nothing a path segment should not.
 */
const PLAN_KEY_RE = /^[A-Za-z0-9_-]{1,120}$/;

/** Enough for any remark worth reading; a pasted log is not one. */
const COMMENT_TEXT_MAX = 10_000;
/** What a quote is cut to, matching the web's own `QUOTE_MAX`. */
const QUOTE_MAX = 240;

/**
 * Take a remark off the wire.
 *
 * Everything is bounded and nothing is trusted: this endpoint is reachable from
 * a phone on the far end of remote access, and a record written here is one
 * `userdata.json` will carry for as long as the session exists.
 */
function readComment(id: string, body: unknown): PlanCommentRecord | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const quote = typeof b.quote === 'string' ? b.quote.trim() : '';
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  const heading = typeof b.heading === 'string' ? b.heading.trim() : '';
  if (!quote) return 'A comment must quote a passage of the plan';
  if (!text) return 'A comment must say something';
  if (text.length > COMMENT_TEXT_MAX) return `A comment is at most ${String(COMMENT_TEXT_MAX)} characters`;
  const start = Number(b.start);
  const end = Number(b.end);
  return {
    id,
    quote: quote.slice(0, QUOTE_MAX),
    heading: heading.slice(0, QUOTE_MAX),
    text,
    // `-1` is the honest answer for a selection that cannot be painted, and it
    // is also what any nonsense off the wire collapses to: the remark stands,
    // it just goes unpainted, which is the same degradation.
    start: Number.isFinite(start) && start >= 0 ? Math.floor(start) : -1,
    end: Number.isFinite(end) && end >= 0 ? Math.floor(end) : -1,
    // Both clocks belong to the store, which is the only thing that knows
    // whether this id was already there.
    createdAt: '',
    editedAt: null,
  };
}

export function registerPlanReviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Every stack this session has. Reads userdata only — no parse, which is the
  // whole point of keying on the call's id rather than on the plan's text.
  app.get<{ Params: { id: string } }>('/api/sessions/:id/plan-reviews', async (request, reply) => {
    if (!isSameOrigin(request)) return reply.code(403).send({ error: 'Cross-origin request refused' });
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    return ctx.index.listPlanReviews(id) satisfies PlanReviewsResponse;
  });

  /**
   * The plan Claude is still writing, before it has submitted anything.
   *
   * `resolvePlan` prefers a plan handed to it in a call's input and falls back
   * to `~/.claude/plans/<slug>.md`; there is no call here, so the file is what
   * comes back — which is why the panel shows this one and never lets anybody
   * comment on it.
   */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/plan-draft', async (request, reply) => {
    if (!isSameOrigin(request)) return reply.code(403).send({ error: 'Cross-origin request refused' });
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    const summary = ctx.index.get(id);
    if (!summary) return reply.code(404).send({ error: 'Session not found' });
    const { plan, planFilePath } = await resolvePlan(ctx.config.plansDir, summary.slug, null);
    return { plan, filePath: planFilePath } satisfies PlanDraftResponse;
  });

  app.put<{ Params: { id: string; planKey: string; commentId: string }; Body: unknown }>(
    '/api/sessions/:id/plan-reviews/:planKey/comments/:commentId',
    async (request, reply) => {
      const { id, planKey, commentId } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!PLAN_KEY_RE.test(planKey)) return reply.code(400).send({ error: 'Invalid plan key' });
      if (!PLAN_KEY_RE.test(commentId)) return reply.code(400).send({ error: 'Invalid comment id' });
      // The session has to exist; the PLAN deliberately does not have to be in
      // its enrichment yet. Enrichment lands late by design — a grown session is
      // re-parsed in the background and keeps the previous figures meanwhile —
      // so the plan somebody is looking at right now, seconds after Claude
      // submitted it, is exactly the one that would fail that check.
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });

      const comment = readComment(commentId, request.body);
      if (typeof comment === 'string') return reply.code(400).send({ error: comment });
      const review = await ctx.index.setPlanComment(id, planKey, comment);
      return { ok: true, review, removed: false } satisfies PlanReviewUpdateResponse;
    },
  );

  app.delete<{ Params: { id: string; planKey: string; commentId: string } }>(
    '/api/sessions/:id/plan-reviews/:planKey/comments/:commentId',
    async (request, reply) => {
      const { id, planKey, commentId } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!PLAN_KEY_RE.test(planKey)) return reply.code(400).send({ error: 'Invalid plan key' });
      // Asks nothing about the session, for the star's reason: a remark on a
      // plan whose transcript has since gone is exactly the one that has to
      // stay removable.
      const { removed, review } = await ctx.index.removePlanComment(id, planKey, commentId);
      return { ok: true, review, removed } satisfies PlanReviewUpdateResponse;
    },
  );

  // Clear all — one write and one event rather than N deletes racing each other.
  app.delete<{ Params: { id: string; planKey: string } }>(
    '/api/sessions/:id/plan-reviews/:planKey',
    async (request, reply) => {
      const { id, planKey } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!PLAN_KEY_RE.test(planKey)) return reply.code(400).send({ error: 'Invalid plan key' });
      const removed = await ctx.index.clearPlanReview(id, planKey);
      return { ok: true, review: null, removed } satisfies PlanReviewUpdateResponse;
    },
  );

  // The stack left, by either exit. Copying counts: what the mark answers is
  // whether these remarks have already been put in front of Claude.
  app.post<{ Params: { id: string; planKey: string } }>(
    '/api/sessions/:id/plan-reviews/:planKey/sent',
    async (request, reply) => {
      const { id, planKey } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!PLAN_KEY_RE.test(planKey)) return reply.code(400).send({ error: 'Invalid plan key' });
      const review = await ctx.index.markPlanReviewSent(id, planKey);
      if (!review) return reply.code(404).send({ error: 'No comments on that plan' });
      return { ok: true, review, removed: false } satisfies PlanReviewUpdateResponse;
    },
  );
}
