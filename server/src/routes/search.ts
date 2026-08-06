import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

const VALID_ROLES = new Set(['title', 'user', 'assistant']);

export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { q?: string; in?: string } }>('/api/search', async (request, reply) => {
    const q = request.query.q?.trim() ?? '';
    if (q.length < 2) {
      return reply.code(400).send({ error: 'Query must be at least 2 characters' });
    }
    let roles: Set<string> | undefined;
    if (request.query.in) {
      roles = new Set(request.query.in.split(',').filter((r) => VALID_ROLES.has(r)));
      if (roles.size === 0) roles = undefined;
    }
    return ctx.search.search(q, roles);
  });
}
