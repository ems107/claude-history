import type { ServerEvent } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

const HEARTBEAT_MS = 25_000;

export function registerEventRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/events', (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');

    const send = (event: ServerEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const onUpdated = (id: string) => send({ type: 'session-updated', id });
    const onChanged = (payload: { ids: string[] }) => send({ type: 'sessions-changed', ids: payload.ids });
    const onLive = () => send({ type: 'live-changed' });
    const onProgress = (p: { enriched: number; total: number }) => send({ type: 'index-progress', ...p });
    const onUpdateStatus = () => send({ type: 'update-status' });

    ctx.index.events.on('session-updated', onUpdated);
    ctx.index.events.on('sessions-changed', onChanged);
    ctx.index.events.on('live-changed', onLive);
    ctx.index.events.on('index-progress', onProgress);
    ctx.updates.events.on('update-status', onUpdateStatus);

    const heartbeat = setInterval(() => reply.raw.write(': hb\n\n'), HEARTBEAT_MS);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      ctx.index.events.off('session-updated', onUpdated);
      ctx.index.events.off('sessions-changed', onChanged);
      ctx.index.events.off('live-changed', onLive);
      ctx.index.events.off('index-progress', onProgress);
      ctx.updates.events.off('update-status', onUpdateStatus);
    });
  });
}
