import type { UpdateStatusResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

export function registerUpdateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/update', async (): Promise<UpdateStatusResponse> => ctx.updates.getStatus());

  app.post('/api/update/check', async (): Promise<UpdateStatusResponse> => ctx.updates.checkNow());

  app.post<{ Body?: { version?: string } }>('/api/update/apply', async (request, reply) => {
    try {
      await ctx.updates.apply(ctx.config.port, request.body?.version);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
