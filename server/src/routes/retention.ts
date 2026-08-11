import { spawn } from 'node:child_process';
import type { RetentionResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { readRetention } from '../core/retention.ts';

export function registerRetentionRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Read fresh every time. The Refresh button in Settings is exactly this call,
  // pressed after editing the file by hand, so anything cached would make it lie.
  app.get(
    '/api/retention',
    async (): Promise<RetentionResponse> => readRetention(ctx.config, ctx.index.projects(), ctx.index.list()),
  );

  // Opens the folder, not the file: Explorer's `/select,<path>` needs the whole
  // argument unquoted, and Node quotes any argument containing a space — which
  // a data root under "Program Files" or a renamed profile would have.
  app.post('/api/retention/open-folder', async () => {
    spawn('explorer.exe', [ctx.config.dataRoot], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  });
}
