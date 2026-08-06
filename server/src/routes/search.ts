import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { q?: string } }>('/api/search', async (request, reply) => {
    const q = request.query.q?.trim() ?? '';
    if (q.length < 2) {
      return reply.code(400).send({ error: 'Query must be at least 2 characters' });
    }
    return ctx.search.search(q);
  });
}
