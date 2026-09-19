import type { FastifyReply } from 'fastify';

/**
 * An abort signal for work that can run for seconds, so a client that gave up
 * stops it.
 *
 * The signal is the RESPONSE closing unfinished, never the request's own close
 * event: the request body arrived long before the work started and says nothing
 * about whether anyone is still listening. Deep search has used this since it
 * existed; git needs the same for a `fetch` nobody is waiting for any more.
 */
export function abortSignalOf(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}
