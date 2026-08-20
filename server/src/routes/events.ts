import type { ServerEvent } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { logEvents } from '../core/logger.ts';

const HEARTBEAT_MS = 25_000;
/**
 * Log records can arrive in bursts (a startup writes several in a millisecond),
 * and each event costs the viewer a refetch — one notice per second is plenty
 * for a screen a person is reading.
 */
const LOGS_THROTTLE_MS = 1_000;

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
    const onChanged = (payload: { ids: string[]; assistantIds: string[]; agents: { sessionId: string; agentId: string }[] }) =>
      send({
        type: 'sessions-changed',
        ids: payload.ids,
        assistantIds: payload.assistantIds ?? [],
        agents: payload.agents ?? [],
      });
    const onLive = (ids: string[]) => send({ type: 'live-changed', ids });
    const onProgress = (p: { enriched: number; total: number }) => send({ type: 'index-progress', ...p });
    const onUpdateStatus = () => send({ type: 'update-status' });
    const onChat = (id: string) => send({ type: 'chat-changed', id });
    const onTerminal = (id: string) => send({ type: 'terminal-changed', id });
    const onStars = () => send({ type: 'stars-changed' });
    // The settings themselves are NOT carried: every event here announces, and
    // the browser asks. `/api/settings` is a local read and answers in ~3 ms.
    const onSettings = () => send({ type: 'settings-changed' });
    const onPrices = () => send({ type: 'prices-changed' });
    let logsTimer: NodeJS.Timeout | null = null;
    const onLogAppended = () => {
      if (logsTimer) return;
      logsTimer = setTimeout(() => {
        logsTimer = null;
        send({ type: 'logs-appended' });
      }, LOGS_THROTTLE_MS);
    };

    ctx.index.events.on('session-updated', onUpdated);
    ctx.index.events.on('sessions-changed', onChanged);
    ctx.index.events.on('live-changed', onLive);
    ctx.index.events.on('index-progress', onProgress);
    ctx.index.events.on('stars-changed', onStars);
    ctx.index.events.on('settings-changed', onSettings);
    ctx.index.events.on('prices-changed', onPrices);
    ctx.updates.events.on('update-status', onUpdateStatus);
    ctx.chat.events.on('chat-changed', onChat);
    ctx.terminals.events.on('terminal-changed', onTerminal);
    logEvents.on('appended', onLogAppended);

    const heartbeat = setInterval(() => reply.raw.write(': hb\n\n'), HEARTBEAT_MS);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      if (logsTimer) clearTimeout(logsTimer);
      logEvents.off('appended', onLogAppended);
      ctx.index.events.off('session-updated', onUpdated);
      ctx.index.events.off('sessions-changed', onChanged);
      ctx.index.events.off('live-changed', onLive);
      ctx.index.events.off('index-progress', onProgress);
      ctx.index.events.off('stars-changed', onStars);
      ctx.index.events.off('settings-changed', onSettings);
      ctx.index.events.off('prices-changed', onPrices);
      ctx.updates.events.off('update-status', onUpdateStatus);
      ctx.chat.events.off('chat-changed', onChat);
      ctx.terminals.events.off('terminal-changed', onTerminal);
    });
  });
}
