import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.ts';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' } });

  app.get('/api/health', async () => ({ ok: true }));

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
