import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { parseSession } from '../core/parser.ts';
import { UUID_RE } from '../core/scanner.ts';

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/sessions', async () => ctx.index.list());

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    const summary = ctx.index.get(id);
    const scanned = ctx.index.getScanned(id);
    if (!summary || !scanned) return reply.code(404).send({ error: 'Session not found' });
    return parseSession(scanned, summary, ctx.config.projectsDir);
  });
}
