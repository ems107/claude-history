import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { markBusy } from '../util/chatLive.ts';

export function registerLiveRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/live', async () => {
    const live = ctx.index.liveSessions;
    // Same correction as the session list: our own `--print` processes appear
    // here (they register a pid file) but never report a status of their own.
    const working = ctx.chat.workingSessions();
    if (working.size === 0) return live;
    return live.map((l) => {
      const startedAt = working.get(l.sessionId);
      return startedAt === undefined ? l : { ...l, ...markBusy(l, startedAt) };
    });
  });
}
