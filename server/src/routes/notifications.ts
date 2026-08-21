import type { NotificationsResponse } from '@claude-history/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The bell: which sessions have stopped, and clearing them.
 *
 * All of it reads `core/notifications.ts`, which is where the rule about what
 * counts as a stop lives. Nothing here is local-only — it opens no window on
 * the server's desktop, and a signed-in browser on another machine has the same
 * reason to want the list as this one does.
 */
export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/notifications', async (): Promise<NotificationsResponse> => ({
    stopped: ctx.notifications.list(),
  }));

  /**
   * Drop one row. Two callers, one endpoint: the panel's cross, and the session
   * view clearing its own row on the way in — the same act either way, which is
   * "I have seen this one".
   */
  app.post('/api/notifications/dismiss', async (request, reply: FastifyReply) => {
    const body = request.body as { sessionId?: unknown } | undefined;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    if (!UUID_RE.test(sessionId)) return reply.code(400).send({ error: 'A session id is required.' });
    ctx.notifications.dismiss(sessionId);
    return { stopped: ctx.notifications.list() } satisfies NotificationsResponse;
  });

  app.post('/api/notifications/clear', async (): Promise<NotificationsResponse> => {
    ctx.notifications.clear();
    return { stopped: ctx.notifications.list() };
  });
}
