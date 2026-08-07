import type { AppSettings, UsageResponse } from '@claude-history/shared';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
      await fs.promises.rm(ctx.config.cacheDir, { recursive: true, force: true });
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

  app.post('/api/open-install-folder', async (_request, reply) => {
    const root = ctx.updates.install?.root;
    if (!root) return reply.code(400).send({ error: 'This instance is not a managed install (source or portable).' });
    spawn('explorer.exe', [root], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  });

  /**
   * Uninstall: remove the scheduled task, the Start Menu shortcut and the
   * install folder (optionally the local data too). Like the updater, the
   * work is handed to a one-shot scheduled task — a child of this process
   * would be killed with our own task — and runs from a %TEMP% copy so it can
   * delete the folder it came from.
   */
  app.post<{ Body?: { deleteData?: boolean } }>('/api/uninstall', async (request, reply) => {
    const install = ctx.updates.install;
    if (!install) return reply.code(400).send({ error: 'This instance is not a managed install (source or portable).' });
    const script = path.join(install.versionDir, 'uninstall.ps1');
    if (!fs.existsSync(script)) {
      return reply.code(500).send({ error: `uninstall.ps1 not found in ${install.versionDir}` });
    }
    const tmp = path.join(os.tmpdir(), 'claude-history-uninstall.ps1');
    try {
      await fs.promises.copyFile(script, tmp);
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp, '-Register',
        '-Root', install.root, '-ServerPid', String(process.pid)];
      if (request.body?.deleteData) args.push('-DeleteData');
      const reg = spawnSync('powershell.exe', args, { windowsHide: true, timeout: 60_000, encoding: 'utf8' });
      if (reg.status !== 0) throw new Error(reg.stderr?.trim() || `exit ${reg.status}`);
    } catch (err) {
      return reply.code(500).send({ error: `Could not schedule the uninstaller: ${err instanceof Error ? err.message : String(err)}` });
    }
    void reply.send({ ok: true });
    setTimeout(() => {
      console.log('[server] uninstall scheduled — exiting');
      process.exit(0);
    }, 400).unref();
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
