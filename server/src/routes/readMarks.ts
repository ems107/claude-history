import type { ReadMarksResponse } from '@claude-history/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.ts';

/**
 * What has been read, and saying that something has been.
 *
 * All of it reads `core/readMarks.ts`, which is where the rule about what a mark
 * means lives. Nothing here is local-only: it opens no window on the server's
 * desktop, and a signed-in browser on another machine has exactly the same
 * reason to know what is unread as this one does — it is the same person's
 * reading either way.
 */
export function registerReadMarkRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/read-marks', async (): Promise<ReadMarksResponse> => ({ marks: ctx.readMarks.list() }));

  /**
   * The session view, on the way in and on every growth it is watching — which
   * is why the answer carries the whole set: the row is then right before the
   * SSE round trip lands, exactly as dismissing a notification does.
   *
   * The id comes off the path and is looked up in the index, so an unknown one
   * is a 404 rather than a number stored against nothing.
   */
  app.post('/api/sessions/:id/read', async (request, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Unknown session.' });
    ctx.readMarks.read(id);
    return { marks: ctx.readMarks.list() } satisfies ReadMarksResponse;
  });
}
