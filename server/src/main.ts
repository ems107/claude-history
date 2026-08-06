import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = await buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`claude-history server on http://${config.host}:${config.port} (data root: ${config.dataRoot})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
