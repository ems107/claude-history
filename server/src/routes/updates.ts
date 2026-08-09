import type { UpdateStatusResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

export function registerUpdateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/update', async (): Promise<UpdateStatusResponse> => ctx.updates.getStatus());

  app.post('/api/update/check', async (): Promise<UpdateStatusResponse> => ctx.updates.checkNow());

  // Answers as soon as the release is validated: the download, the staging and
  // the handover run in the background and are followed through `state` and
  // `progress` on GET /api/update (pushed over SSE). Holding the request open
  // for the whole download is what made a slow one look like a dead server.
  app.post<{ Body?: { version?: string } }>('/api/update/apply', async (request, reply) => {
    try {
      const started = ctx.updates.apply(ctx.config.port, request.body?.version);
      return { ok: true, ...started };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
