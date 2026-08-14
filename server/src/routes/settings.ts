import type { AppSettings, UsageResponse, UsageTrigger } from '@claude-history/shared';
import { USAGE_TRIGGERS } from '@claude-history/shared';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { createLogger } from '../core/logger.ts';
import type { ReadCause } from '../core/usage.ts';
import { APP_VERSION } from '../version.ts';

const log = createLogger('server');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Sessions named in the log line before it turns into a count. */
const NAMED_SESSIONS = 2;

/**
 * What to say in the log beyond the trigger's name.
 *
 * `widget-activity` fires because Claude answered somewhere, and "somewhere"
 * is the part worth recording: with several sessions running at once, the line
 * is otherwise indistinguishable from every other one. The browser sends the
 * session ids from the SSE event and they are resolved here, validated as
 * UUIDs and looked up in the index — an id nobody knows is simply not named.
 *
 * Bare `widget` gets a cause too, and it is the honest one: every other reason
 * is labelled at its source, so this one really is "the browser did not say".
 */
function describeCause(ctx: AppContext, trigger: UsageTrigger, ids?: string): ReadCause | undefined {
  if (trigger === 'widget') return { text: 'the browser did not report a cause' };
  if (trigger !== 'widget-activity') return undefined;
  const list = (ids ?? '').split(',').filter((id) => UUID_RE.test(id));
  if (list.length === 0) return { text: 'Claude answered' };
  const named = list.slice(0, NAMED_SESSIONS).map((id) => {
    const s = ctx.index.get(id);
    return s ? `${s.projectName} · "${s.title}"` : id.slice(0, 8);
  });
  const rest = list.length - named.length;
  const where = named.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
  return {
    text: `Claude answered in ${where}`,
    data: { sessions: list },
  };
}

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/settings', async () => ({
    settings: ctx.index.getSettings(),
    paths: {
      dataRoot: ctx.config.dataRoot,
      cacheDir: ctx.config.cacheDir,
      userdataFile: ctx.config.userdataFile,
      logsDir: ctx.config.logsDir,
      installRoot: ctx.updates.install?.root ?? null,
    },
    version: APP_VERSION,
  }));

  app.put<{ Body: Partial<AppSettings> }>('/api/settings', async (request) => ({
    settings: await ctx.index.setSettings(request.body ?? {}),
  }));

  app.get<{ Querystring: { reason?: string; ids?: string } }>('/api/usage', async (request): Promise<UsageResponse> => {
    if (!ctx.index.getSettings().usageWidget) {
      return { available: false, error: null, windows: [], fetchedAt: null, subscriptionType: null, stale: false };
    }
    // The browser says which of its several causes this was. Only `widget-*` is
    // accepted from here, so the request cannot dress itself up as one of the
    // server's own triggers.
    const reason = request.query.reason ?? '';
    const trigger: UsageTrigger =
      reason.startsWith('widget') && (USAGE_TRIGGERS as readonly string[]).includes(reason)
        ? (reason as UsageTrigger)
        : 'widget';
    return ctx.usage.get(trigger, { cause: describeCause(ctx, trigger, request.query.ids) });
  });

  app.post('/api/usage/refresh', async (): Promise<UsageResponse> => ctx.usage.get('manual-refresh', { force: true }));

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
    if (ctx.updates.isApplying()) {
      log.warn('uninstall refused: an update is being installed');
      return reply.code(409).send({ error: 'An update is being installed right now. Wait for it to finish.' });
    }
    if (ctx.chat.busy) {
      log.warn('uninstall refused: a prompt is being answered');
      return reply.code(409).send({ error: 'Claude is answering a prompt sent from the app. Wait for it to finish.' });
    }
    // Going away mid-rebase would leave a repository in a state nothing in this
    // app put it in, and nothing here could finish for you.
    if (ctx.git.busy) {
      log.warn(`uninstall refused: ${ctx.git.busyDescription}`);
      return reply.code(409).send({ error: `There is ${ctx.git.busyDescription} right now. Wait for it to finish.` });
    }
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
      log.info('uninstall scheduled — exiting');
      process.exit(0);
    }, 400).unref();
  });

  // Stop the server. When installed, the scheduled task's wscript wrapper
  // exits with it, so Task Scheduler reports the task as finished and the
  // Start Menu shortcut can start it again.
  //
  // Refused while an update is being installed: stopping here kills the
  // download in flight and leaves nothing behind — which is exactly how one
  // update was lost, since the natural reaction to a slow one is to stop and
  // restart the server.
  app.post('/api/server/stop', async (_request, reply) => {
    if (ctx.updates.isApplying()) {
      log.warn('stop refused: an update is being installed');
      return reply.code(409).send({
        error: 'An update is being installed right now — stopping the server would abort it. Wait for it to finish.',
      });
    }
    // Same reasoning one step down: stopping now kills the turn mid-answer.
    if (ctx.chat.busy) {
      log.warn('stop refused: a prompt is being answered');
      return reply.code(409).send({
        error: 'Claude is answering a prompt sent from the app — stopping the server would cut it off. Wait for it to finish.',
      });
    }
    if (ctx.git.busy) {
      log.warn(`stop refused: ${ctx.git.busyDescription}`);
      return reply.code(409).send({
        error: `There is ${ctx.git.busyDescription} — stopping the server now would leave it half done. Wait for it to finish.`,
      });
    }
    void reply.send({ ok: true });
    setTimeout(() => {
      log.info('stop requested from the UI — exiting');
      process.exit(0);
    }, 300).unref();
  });
}
