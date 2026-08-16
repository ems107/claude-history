import type {
  ChatAnswerRequest,
  ChatPermissionMode,
  ChatPlanDecision,
  ChatSendRequest,
  ChatStatusResponse,
} from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { UUID_RE } from '../core/scanner.ts';

/**
 * The modes a request may ask for. Narrow on purpose: the SDK accepts six, and
 * `bypassPermissions` is not something an HTTP body should be able to reach —
 * anything else is treated as unset and falls back to the default.
 */
const MODES = new Set<ChatPermissionMode>(['auto', 'plan']);
const asMode = (v: unknown): ChatPermissionMode | undefined =>
  MODES.has(v as ChatPermissionMode) ? (v as ChatPermissionMode) : undefined;

const DECISIONS = new Set<ChatPlanDecision>(['approve-auto', 'approve-manual', 'keep-planning']);
const asDecision = (v: unknown): ChatPlanDecision | undefined =>
  DECISIONS.has(v as ChatPlanDecision) ? (v as ChatPlanDecision) : undefined;

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
      const { text, model, effort, permissionMode } = request.body ?? { text: '' };
      if (typeof text !== 'string') return reply.code(400).send({ error: 'text is required' });
      try {
        await ctx.chat.send(id, text, model, effort, asMode(permissionMode));
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
      const annotations = request.body?.annotations;
      if (annotations != null && (typeof annotations !== 'object' || Array.isArray(annotations))) {
        return reply.code(400).send({ error: 'annotations must be an object or null' });
      }
      const note = typeof request.body?.note === 'string' ? request.body.note : undefined;
      try {
        ctx.chat.answer(id, answers, asDecision(request.body?.decision), note, annotations ?? null);
        return { ok: true };
      } catch (err) {
        return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Start the process without a prompt. The composer offers this because the
  // model list and each model's effort levels come from a running CLI and from
  // nowhere else — the alternative was showing a guess that aged badly.
  app.post<{
    Params: { id: string };
    Body: { model?: string; effort?: string | null; permissionMode?: ChatPermissionMode };
  }>(
    '/api/sessions/:id/chat/start',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });
      try {
        ctx.chat.open(id, request.body?.model, request.body?.effort, asMode(request.body?.permissionMode));
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
