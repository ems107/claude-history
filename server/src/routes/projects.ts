import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/projects', async () => ctx.index.projects());
}
