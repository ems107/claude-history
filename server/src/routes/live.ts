import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { pidAlive } from '../core/live.ts';
import { markOurs } from '../util/chatLive.ts';

export function registerLiveRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/live', async () => {
    // Re-checked here, not trusted from the cached list: that list is only
    // rebuilt when something writes to ~/.claude/sessions, and a CLI that exits
    // writes nothing on the way out. Its file stays, no event ever comes, and
    // the badge would go on saying LIVE for a process that is gone.
    const live = ctx.index.liveSessions.filter((l) => pidAlive(l.pid));
    // Same correction as the session list: our own `--print` processes appear
    // here (they register a pid file) but never report a status of their own.
    const working = ctx.chat.workingSessions();
    if (working.size === 0) return live;
    return live.map((l) => {
      const turn = working.get(l.sessionId);
      return turn === undefined ? l : { ...l, ...markOurs(l, turn) };
    });
  });
}
