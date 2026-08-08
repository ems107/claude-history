import type { AutoReloadStatus } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

export function registerAutoReloadRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/auto-reload', async (): Promise<AutoReloadStatus> => ctx.autoReload.status());

  // Run the cycle once on demand. This really does send the prompt (and start
  // the window) — it is the only way to prove the folder, the CLI and the
  // permissions actually work, so the UI asks for confirmation first. Refused
  // whenever the feature itself could not run: switched off, or misconfigured.
  app.post('/api/auto-reload/run', async (_request, reply) => {
    try {
      return { ok: true, run: await ctx.autoReload.runNow() };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
