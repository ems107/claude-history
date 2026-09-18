import type { UpdateStatusResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { refuseWhileActive } from '../util/appSessions.ts';

export function registerUpdateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/update', async (): Promise<UpdateStatusResponse> => ctx.updates.getStatus());

  app.post('/api/update/check', async (): Promise<UpdateStatusResponse> => ctx.updates.checkNow());

  // Answers as soon as the release is validated: the download, the staging and
  // the handover run in the background and are followed through `state` and
  // `progress` on GET /api/update (pushed over SSE). Holding the request open
  // for the whole download is what made a slow one look like a dead server.
  app.post<{ Body?: { version?: string } }>('/api/update/apply', async (request, reply) => {
    // An update ends with this server being killed and replaced, which takes
    // every session the app is running with it — a turn in flight, and an idle
    // one that is still holding a transcript just the same.
    const active = refuseWhileActive(ctx, 'update');
    if (active) return reply.code(409).send(active);
    try {
      const started = ctx.updates.apply(ctx.config.port, request.body?.version);
      // Taken here, by the version that is still running and known to work: a
      // regression arriving with the new one is the reason this copy exists, and
      // after the handover this code is no longer the code taking it. Awaited so
      // a copy is on disk before the download starts, and never fatal — the
      // service logs its own failures and an update must not be blocked by one.
      await ctx.index.backups.create(`pre-update-${started.version}`).catch(() => null);
      return { ok: true, ...started };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
