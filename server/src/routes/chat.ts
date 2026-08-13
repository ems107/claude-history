import type { ChatAnswerRequest, ChatSendRequest, ChatStatusResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { UUID_RE } from '../core/scanner.ts';

export function registerChatRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Status of the process for one session. Cheap and read-only: the composer
  // polls it while a turn is in flight, on top of the SSE event.
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/chat',
    async (request, reply): Promise<ChatStatusResponse | void> => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });
      return ctx.chat.status(id);
    },
  );

  // Send a prompt. Same validation model as resume: the id must be in the
  // index, and the working directory comes only from there — never from the
  // request. Everything else the service refuses is one string, and it is the
  // same string the composer shows, so a rejection is never silent.
  app.post<{ Params: { id: string }; Body: ChatSendRequest }>(
    '/api/sessions/:id/chat',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });
      const { text, model, effort } = request.body ?? { text: '' };
      if (typeof text !== 'string') return reply.code(400).send({ error: 'text is required' });
      try {
        await ctx.chat.send(id, text, model, effort);
        return { ok: true };
      } catch (err) {
        return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Answer whatever Claude is waiting on: the choices for an AskUserQuestion,
  // or a plain allow/deny for a tool the auto classifier would not take. The
  // turn has been held open since the question was asked, so this is what lets
  // it continue.
  app.post<{ Params: { id: string }; Body: ChatAnswerRequest }>(
    '/api/sessions/:id/chat/answer',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      const answers = request.body?.answers;
      if (answers !== null && (typeof answers !== 'object' || Array.isArray(answers))) {
        return reply.code(400).send({ error: 'answers must be an object or null' });
      }
      try {
        ctx.chat.answer(id, answers);
        return { ok: true };
      } catch (err) {
        return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/sessions/:id/chat/stop', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    await ctx.chat.stop(id);
    return { ok: true };
  });
}
