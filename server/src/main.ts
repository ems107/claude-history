import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { AutoReloadService } from './core/autoReload.ts';
import { decideBind, logBind } from './core/bind.ts';
import { SessionIndex } from './core/index.ts';
import { NotificationsService } from './core/notifications.ts';
import { applyLogSettings, createLogger, initLogging, onShutdown } from './core/logger.ts';
import { DeepSearchService } from './core/deepSearch.ts';
import { SearchService } from './core/search.ts';
import { SessionChatService } from './core/sessionChat.ts';
import { SessionTerminalService } from './core/sessionTerminal.ts';
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

  // Before anything is served: whether this process may listen on the network at
  // all. It reads the switch (loaded a moment ago) and, only if that is on, asks
  // the Windows Firewall — so a machine with remote access off pays nothing for
  // it. See core/bind.ts for why the permission has to exist BEFORE the socket.
  const bind = await decideBind(config, index.getSettings(), index.getAuth() !== null);
  logBind(bind);

  const search = new SearchService(index);
  const deepSearch = new DeepSearchService(config, index, search);
  const updates = new UpdateService();
  // If we just came back from an update, the helper wrote the half of it we
  // could not see (junction swap, restart, health check, rollback). Copy those
  // lines in so the whole operation is one timeline here.
  startUpdateLogImport(updates.install?.root ?? null, config.cacheDir);
  const usage = new UsageService(config.dataRoot, () => index.getSettings());
  const autoReload = new AutoReloadService(usage, () => index.getSettings());
  const chat = new SessionChatService(config, index, () => index.getSettings());
  const terminals = new SessionTerminalService(config, index, chat, () => index.getSettings());
  // After both halves it watches, and started below once the index has been
  // built — it seeds itself from what is already running.
  const notifications = new NotificationsService(index, chat);
  const app = await buildApp({
    config,
    bind,
    index,
    search,
    deepSearch,
    updates,
    usage,
    autoReload,
    chat,
    terminals,
    notifications,
  });
  updates.start(() => index.getSettings());
  autoReload.start(index.events);
  chat.start();
  notifications.start();
  // Loading the native pseudo-terminal module. Awaited so the very first status
  // read already knows whether the feature works; a failure is recorded inside
  // and reported through `blockedReason`, never thrown.
  await terminals.start();
  // The `claude` processes they own outlive this one unless something kills
  // them; the logger runs this on every exit path there is.
  onShutdown(() => chat.shutdown());
  onShutdown(() => terminals.shutdown());

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
    await app.listen({ host: bind.host, port: config.port });
    // `http://0.0.0.0:7433` is not an address anyone can open, so the URL is
    // always the local one and the bind is reported beside it — the two are
    // different facts now, and which interfaces are open is the one worth
    // finding in a log. The WHY of that bind was logged by logBind() above.
    const scope = bind.network ? `bound to ${bind.host}` : 'this machine only';
    log.info(
      `listening on http://127.0.0.1:${config.port} (${scope}, data root: ${config.dataRoot})`,
    );
  } catch (err) {
    log.error('could not listen — exiting', err);
    process.exit(1);
  }
}

void main();
