import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context.ts';
import { createLogger } from './core/logger.ts';
import { isSameOrigin } from './util/sameOrigin.ts';
import { registerAutoReloadRoutes } from './routes/autoReload.ts';
import { registerChatRoutes } from './routes/chat.ts';
import { registerEventRoutes } from './routes/events.ts';
import { registerFileRoutes } from './routes/files.ts';
import { registerLogRoutes } from './routes/logs.ts';
import { registerLiveRoutes } from './routes/live.ts';
import { registerMetaRoutes } from './routes/meta.ts';
import { registerPriceRoutes } from './routes/prices.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import { registerPromptRoutes } from './routes/prompts.ts';
import { registerResumeRoutes } from './routes/resume.ts';
import { registerRetentionRoutes } from './routes/retention.ts';
import { registerSearchRoutes } from './routes/search.ts';
import { registerSettingsRoutes } from './routes/settings.ts';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerSubagentRoutes } from './routes/subagents.ts';
import { registerToolResultRoutes } from './routes/toolResults.ts';
import { registerUpdateRoutes } from './routes/updates.ts';

/**
 * Fastify logs through pino, which writes straight to file descriptor 1 and
 * therefore bypasses `console` entirely — so before this, a 500 or a failed
 * listen() left NOTHING in the log files, which is precisely what they exist
 * for. Giving pino a destination that re-emits into our logger fixes that.
 */
function fastifyLogStream(): { write(line: string): void } {
  const log = createLogger('http');
  return {
    write(line: string) {
      try {
        const entry = JSON.parse(line) as {
          level?: number;
          msg?: string;
          err?: { stack?: string; message?: string };
          req?: { method?: string; url?: string };
          res?: { statusCode?: number };
          reqId?: string;
        };
        const level = entry.level ?? 30;
        const method = entry.req?.method;
        const url = entry.req?.url;
        const status = entry.res?.statusCode;
        const message = [entry.msg ?? 'fastify', method && url ? `(${method} ${url})` : null, status ? `-> ${status}` : null]
          .filter(Boolean)
          .join(' ');
        const extra = entry.err?.stack ? { stack: entry.err.stack, reqId: entry.reqId } : undefined;
        if (level >= 50) log.error(message, extra);
        else if (level >= 40) log.warn(message, extra);
        else log.info(message, extra);
      } catch {
        // Not JSON (or a shape we do not know): keep the raw line rather than lose it.
        log.warn(line.trim());
      }
    },
  };
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({ logger: { level: 'warn', stream: fastifyLogStream() } });

  // Anything that changes state or runs something must come from our own pages.
  // Binding to 127.0.0.1 keeps other machines out but says nothing about the
  // browser on this one, and these endpoints open terminals, stop the server
  // and run Claude — the side effect is the whole attack, no reply needed.
  // Reads are left alone: there is nothing to trigger and no reply to steal.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    if (isSameOrigin(request)) return;
    createLogger('http').warn(
      `refused a cross-origin ${request.method} ${request.url}`,
      { origin: request.headers.origin ?? null, site: request.headers['sec-fetch-site'] ?? null },
    );
    return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  registerMetaRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerSubagentRoutes(app, ctx);
  registerToolResultRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  registerLiveRoutes(app, ctx);
  registerPromptRoutes(app, ctx);
  registerPriceRoutes(app, ctx);
  registerResumeRoutes(app, ctx);
  registerChatRoutes(app, ctx);
  registerUpdateRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerRetentionRoutes(app, ctx);
  registerAutoReloadRoutes(app, ctx);
  registerLogRoutes(app, ctx);
  registerEventRoutes(app, ctx);

  if (config.staticDir) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      // The plugin's own cache-control would overwrite ours.
      cacheControl: false,
      // Asset filenames are content-hashed, so they can be cached hard; the
      // entry document must NOT be, or a cached index.html keeps asking for
      // the previous build's bundles (404s and a blank page after an update).
      setHeaders(res, filePath) {
        res.setHeader(
          'cache-control',
          filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
        );
      },
    });
    // SPA fallback: any non-API GET serves index.html
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.header('cache-control', 'no-store').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
