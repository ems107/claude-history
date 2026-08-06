import type { UpdateStatusResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

export function registerUpdateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/update', async (): Promise<UpdateStatusResponse> => ctx.updates.getStatus());

  app.post('/api/update/check', async (): Promise<UpdateStatusResponse> => ctx.updates.checkNow());
}
