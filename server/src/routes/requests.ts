import type { RequestDetailResponse, RequestMessageResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { requestBody, requestDetail, requestMessage } from '../core/requestBodies.ts';
import { UUID_RE } from '../core/scanner.ts';

/**
 * The exact request a reply answered (`core/requestBodies.ts`). Read-only, and
 * the file is the one the index holds for the session — nothing about where to
 * read comes from the request beyond two ids validated as uuids.
 */
export function registerRequestRoutes(app: FastifyInstance, ctx: AppContext): void {
  const fileOf = (id: string): string | null => {
    const scanned = ctx.index.getScanned(id);
    return ctx.index.get(id) && scanned ? scanned.filePath : null;
  };

  app.get<{ Params: { id: string; requestId: string } }>(
    '/api/sessions/:id/requests/:requestId',
    async (request, reply): Promise<RequestDetailResponse | void> => {
      const { id, requestId } = request.params;
      if (!UUID_RE.test(id) || !UUID_RE.test(requestId)) return reply.code(400).send({ error: 'Invalid id' });
      const file = fileOf(id);
      if (!file) return reply.code(404).send({ error: 'Session not found' });
      const detail = await requestDetail(file, requestId);
      if (!detail) return reply.code(404).send({ error: 'Request not found' });
      return detail;
    },
  );

  app.get<{ Params: { id: string; requestId: string; index: string } }>(
    '/api/sessions/:id/requests/:requestId/messages/:index',
    async (request, reply): Promise<RequestMessageResponse | void> => {
      const { id, requestId, index } = request.params;
      if (!UUID_RE.test(id) || !UUID_RE.test(requestId) || !/^\d{1,6}$/.test(index)) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const file = fileOf(id);
      if (!file) return reply.code(404).send({ error: 'Session not found' });
      const message = await requestMessage(file, requestId, Number(index));
      if (!message) return reply.code(404).send({ error: 'Message not found' });
      return message;
    },
  );

  app.get<{ Params: { id: string; requestId: string }; Querystring: { download?: string } }>(
    '/api/sessions/:id/requests/:requestId/raw',
    async (request, reply) => {
      const { id, requestId } = request.params;
      if (!UUID_RE.test(id) || !UUID_RE.test(requestId)) return reply.code(400).send({ error: 'Invalid id' });
      const file = fileOf(id);
      if (!file) return reply.code(404).send({ error: 'Session not found' });
      const body = await requestBody(file, requestId);
      if (!body) return reply.code(404).send({ error: 'Request not found, or a part of it is missing' });
      if (request.query.download === '1') {
        reply.header('content-disposition', `attachment; filename="request-${requestId}.json"`);
      }
      return body;
    },
  );
}
