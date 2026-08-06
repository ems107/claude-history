import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ToolResultFileResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

const MAX_BYTES = 4 * 1024 * 1024;

export function registerToolResultRoutes(app: FastifyInstance, ctx: AppContext): void {
  // `path` is projects-relative, produced by the parser (offloadedFile).
  app.get<{ Querystring: { path?: string } }>(
    '/api/tool-results',
    async (request, reply): Promise<ToolResultFileResponse | void> => {
      const relPath = request.query.path ?? '';
      if (!relPath || relPath.includes('..') || path.isAbsolute(relPath)) {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      const resolved = path.resolve(ctx.config.projectsDir, relPath);
      const inside = resolved.startsWith(ctx.config.projectsDir + path.sep);
      const parentIsToolResults = path.basename(path.dirname(resolved)) === 'tool-results';
      const isTxt = resolved.endsWith('.txt');
      if (!inside || !parentIsToolResults || !isTxt) {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      try {
        const stat = await fsp.stat(resolved);
        const fh = await fsp.open(resolved, 'r');
        try {
          const len = Math.min(stat.size, MAX_BYTES);
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, 0);
          return { text: buf.toString('utf8'), sizeBytes: stat.size };
        } finally {
          await fh.close();
        }
      } catch {
        return reply.code(404).send({ error: 'Tool result file not found' });
      }
    },
  );
}
