import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { AutoReloadService } from './core/autoReload.ts';
import { SessionIndex } from './core/index.ts';
import { applyLogSettings, createLogger, initLogging } from './core/logger.ts';
import { SearchService } from './core/search.ts';
import { startUpdateLogImport } from './core/updateLogImport.ts';
import { UpdateService } from './core/updates.ts';
import { UsageService } from './core/usage.ts';
import { Watcher } from './core/watcher.ts';

// No top-level await: the packaged build bundles this file to CommonJS.
async function main(): Promise<void> {
  const config = loadConfig();
  initLogging(config.logsDir);
  const log = createLogger('server');
  for (const warning of config.warnings) createLogger('config').warn(warning);

  const index = new SessionIndex(config);

  const t0 = Date.now();
  await index.build();
  // Settings live in userdata.json, so the level only becomes known here; up to
  // this point the default applies.
  applyLogSettings(index.getSettings());
  index.events.on('settings-changed', (settings: Parameters<typeof applyLogSettings>[0]) =>
    applyLogSettings(settings),
  );
  createLogger('index').info(
    `${index.size} sessions across ${index.projects().length} projects in ${Date.now() - t0} ms`,
  );

  const search = new SearchService(index);
  const updates = new UpdateService();
  // If we just came back from an update, the helper wrote the half of it we
  // could not see (junction swap, restart, health check, rollback). Copy those
  // lines in so the whole operation is one timeline here.
  startUpdateLogImport(updates.install?.root ?? null, config.cacheDir);
  const usage = new UsageService(config.dataRoot, () => index.getSettings());
  const autoReload = new AutoReloadService(usage, () => index.getSettings());
  const app = await buildApp({ config, index, search, updates, usage, autoReload });
  updates.start(() => index.getSettings());
  autoReload.start(index.events);

  const watcher = new Watcher(config, index);
  watcher.start();

  if (config.exitWithParent) {
    // The installed instance runs as: scheduled task -> wscript -> node.
    // Ending the task only kills wscript, so watch it and follow. EPERM
    // means alive-but-protected (same convention as live.ts); ESRCH = gone.
    const parentPid = process.ppid;
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
          log.info(`parent process ${parentPid} is gone — exiting`);
          process.exit(0);
        }
      }
    }, 3_000).unref();
  }

  try {
    await app.listen({ host: config.host, port: config.port });
    log.info(`listening on http://${config.host}:${config.port} (data root: ${config.dataRoot})`);
  } catch (err) {
    log.error('could not listen — exiting', err);
    process.exit(1);
  }
}

void main();
