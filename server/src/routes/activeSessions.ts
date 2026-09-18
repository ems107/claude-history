import type { ActiveSessionsResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { createLogger } from '../core/logger.ts';
import { activeAppSessions, closeActiveAppSessions } from '../util/appSessions.ts';

const log = createLogger('server');

/**
 * What the app is running, and closing all of it.
 *
 * Six actions refuse while any of this is alive (`util/appSessions.ts`), and the
 * refusal names them — so the dialog that shows it needs no read of its own to
 * appear. These two endpoints are for what happens around it: a page that wants
 * to say "3 of 10 running" before anybody presses anything, and the button that
 * clears the way so the refused action can be tried again.
 */
export function registerActiveSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/active-sessions', async (): Promise<ActiveSessionsResponse> => ({
    sessions: activeAppSessions(ctx),
    max: ctx.index.getSettings().maxActiveSessions,
  }));

  /**
   * Close every one of them. Not local-only: a signed-in remote browser can
   * already close any of these one at a time from the session itself, and
   * nothing here opens a window on the server's desktop.
   *
   * Answers with what is left, which is normally nothing — a CLI that refuses to
   * die is a fact the caller has to be able to see rather than a silent success.
   */
  app.post('/api/active-sessions/close', async (): Promise<ActiveSessionsResponse> => {
    const before = activeAppSessions(ctx);
    log.info(`closing ${before.length} session(s) the app is running, asked from the UI`);
    await closeActiveAppSessions(ctx);
    return { sessions: activeAppSessions(ctx), max: ctx.index.getSettings().maxActiveSessions };
  });
}
