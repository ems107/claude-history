import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

export function registerLiveRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/live', async () => ctx.index.liveSessions);
}
