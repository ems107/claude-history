import type { MetaResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { isLocalRequest } from '../util/remote.ts';
import { APP_VERSION } from '../version.ts';

export function registerMetaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/meta', async (request): Promise<MetaResponse> => ({
    dataRoot: ctx.config.dataRoot,
    cacheDir: ctx.config.cacheDir,
    projectCount: ctx.index.projects().length,
    sessionCount: ctx.index.size,
    indexState: ctx.index.state,
    enrichedCount: ctx.index.enrichedCount,
    cacheHits: ctx.index.cacheHits,
    version: APP_VERSION,
    devInstance: ctx.config.devInstance,
    // Per request, not per server: the same server answers both, and this is
    // the only place the browser can learn which kind of client it is.
    remote: !isLocalRequest(request),
  }));
}
