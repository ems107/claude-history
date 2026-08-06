import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { SessionIndex } from './core/index.ts';
import { SearchService } from './core/search.ts';
import { Watcher } from './core/watcher.ts';

const config = loadConfig();
const index = new SessionIndex(config);

const t0 = Date.now();
await index.build();
console.log(`[index] ${index.size} sessions across ${index.projects().length} projects in ${Date.now() - t0} ms`);

const search = new SearchService(index);
const app = await buildApp({ config, index, search });

const watcher = new Watcher(config, index);
watcher.start();

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`claude-history on http://${config.host}:${config.port} (data root: ${config.dataRoot})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
