import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context.ts';
import { registerEventRoutes } from './routes/events.ts';
import { registerLiveRoutes } from './routes/live.ts';
import { registerMetaRoutes } from './routes/meta.ts';
import { registerPriceRoutes } from './routes/prices.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import { registerPromptRoutes } from './routes/prompts.ts';
import { registerResumeRoutes } from './routes/resume.ts';
import { registerSearchRoutes } from './routes/search.ts';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerSubagentRoutes } from './routes/subagents.ts';
import { registerToolResultRoutes } from './routes/toolResults.ts';

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({ logger: { level: 'warn' } });

  app.get('/api/health', async () => ({ ok: true }));
  registerMetaRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerSubagentRoutes(app, ctx);
  registerToolResultRoutes(app, ctx);
  registerLiveRoutes(app, ctx);
  registerPromptRoutes(app, ctx);
  registerPriceRoutes(app, ctx);
  registerResumeRoutes(app, ctx);
  registerEventRoutes(app, ctx);

  if (config.staticDir) {
    await app.register(fastifyStatic, { root: config.staticDir });
    // SPA fallback: any non-API GET serves index.html
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
