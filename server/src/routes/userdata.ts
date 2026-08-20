import type { UserdataBackupsResponse, UserdataRestoreResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { createLogger } from '../core/logger.ts';
import { refuseWhileActive } from '../util/appSessions.ts';

const log = createLogger('backups');

/**
 * The dated copies of `userdata.json`, and putting one back.
 *
 * Restoring is the only endpoint in this app that replaces user data wholesale,
 * so three things guard it: the name is validated and looked up among the copies
 * that really exist (a path never comes from a request), the state it replaces
 * is copied first, and the whole thing happens in memory — no restart, because
 * a restore that needs one would be a restore nobody performs.
 */
export function registerUserdataRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/userdata/backups', async (): Promise<UserdataBackupsResponse> => ({
    backupsDir: ctx.index.backups.directory,
    backups: await ctx.index.backups.list(),
    recovered: ctx.index.backups.recovery,
  }));

  // Taking one by hand: about to edit prices, or about to try something.
  app.post('/api/userdata/backups', async (_request, reply) => {
    try {
      const name = await ctx.index.backups.create('manual');
      // null means the bytes match the newest copy already held — that is a
      // success with nothing to do, not a failure, and saying so is better than
      // inventing a file name.
      return { ok: true, name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`manual backup failed: ${message}`);
      return reply.code(500).send({ error: message });
    }
  });

  app.post<{ Body?: { name?: string } }>('/api/userdata/restore', async (request, reply) => {
    const name = request.body?.name;
    if (typeof name !== 'string' || !name) return reply.code(400).send({ error: 'A backup name is required.' });
    // A restore replaces the whole of userdata.json, `chatEnabled` and
    // `chatMode` included — which is the back door onto the two settings a
    // running CLI protects, and it would arrive without anyone meaning it.
    const active = refuseWhileActive(ctx, 'restoreUserdata');
    if (active) {
      log.warn(`restore refused: the app is running ${active.activeSessions.length} session(s)`);
      return reply.code(409).send(active);
    }
    try {
      const result = await ctx.index.restoreBackup(name);
      return { ok: true, ...result } satisfies UserdataRestoreResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`restore refused: ${message}`);
      // 400: everything that can go wrong here is about the name that was sent
      // — it is not a backup, there is no such copy, or the copy is unreadable.
      return reply.code(400).send({ error: message });
    }
  });
}
