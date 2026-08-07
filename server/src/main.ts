import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { SessionIndex } from './core/index.ts';
import { SearchService } from './core/search.ts';
import { UpdateService } from './core/updates.ts';
import { UsageService } from './core/usage.ts';
import { Watcher } from './core/watcher.ts';
import { installFileLogging } from './logging.ts';

// No top-level await: the packaged build bundles this file to CommonJS.
async function main(): Promise<void> {
  const config = loadConfig();
  if (config.logFile) installFileLogging(config.logFile);
  const index = new SessionIndex(config);

  const t0 = Date.now();
  await index.build();
  console.log(`[index] ${index.size} sessions across ${index.projects().length} projects in ${Date.now() - t0} ms`);

  const search = new SearchService(index);
  const updates = new UpdateService();
  const usage = new UsageService(config.dataRoot);
  const app = await buildApp({ config, index, search, updates, usage });
  updates.start(() => index.getSettings());

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
          console.log(`[main] parent process ${parentPid} is gone — exiting`);
          process.exit(0);
        }
      }
    }, 3_000).unref();
  }

  try {
    await app.listen({ host: config.host, port: config.port });
    console.log(`claude-history on http://${config.host}:${config.port} (data root: ${config.dataRoot})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
