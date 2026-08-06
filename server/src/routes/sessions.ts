import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/sessions', async () => ctx.index.list());
}
