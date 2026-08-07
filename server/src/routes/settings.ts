import type { AppSettings, UsageResponse } from '@claude-history/shared';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { APP_VERSION } from '../version.ts';

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/settings', async () => ({
    settings: ctx.index.getSettings(),
    paths: {
      dataRoot: ctx.config.dataRoot,
      cacheDir: ctx.config.cacheDir,
      userdataFile: ctx.config.userdataFile,
      installRoot: ctx.updates.install?.root ?? null,
    },
    version: APP_VERSION,
  }));

  app.put<{ Body: Partial<AppSettings> }>('/api/settings', async (request) => ({
    settings: await ctx.index.setSettings(request.body ?? {}),
  }));

  app.get('/api/usage', async (): Promise<UsageResponse> => {
    if (!ctx.index.getSettings().usageWidget) {
      return { available: false, error: null, windows: [], fetchedAt: null, subscriptionType: null };
    }
    return ctx.usage.get();
  });

  app.post('/api/usage/refresh', async (): Promise<UsageResponse> => ctx.usage.get(true));

  // Wipe the derived cache; the index rebuilds it from ~/.claude on restart.
  // userdata.json lives outside cacheDir, so renames/pins/prices survive.
  app.post('/api/cache/clear', async (_request, reply) => {
    try {
      await fs.rm(ctx.config.cacheDir, { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/open-data-folder', async () => {
    // The cache dir may not exist yet; its parent (our data folder) always does.
    spawn('explorer.exe', [path.dirname(ctx.config.cacheDir)], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  });

  // Stop the server. When installed, the scheduled task's wscript wrapper
  // exits with it, so Task Scheduler reports the task as finished and the
  // Start Menu shortcut can start it again.
  app.post('/api/server/stop', async (_request, reply) => {
    void reply.send({ ok: true });
    setTimeout(() => {
      console.log('[server] stop requested from the UI — exiting');
      process.exit(0);
    }, 300).unref();
  });
}
