import type { SearchMode, SearchWordScope } from '@claude-history/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.ts';
import type { SearchOptions } from '../core/searchText.ts';

const VALID_ROLES = new Set(['title', 'user', 'assistant']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The whole index is 140 ids here; anything beyond this is not a session list. */
const MAX_SESSION_IDS = 2000;

interface Tuning {
  in?: string;
  mode?: string;
  co?: string;
  w?: string;
}

/**
 * Anything unrecognised falls back to the plain phrase search, so a stale or
 * hand-edited URL degrades to the simple behaviour instead of failing.
 */
function readOptions(tuning: Tuning): SearchOptions {
  let roles: Set<string> | undefined;
  if (tuning.in) {
    roles = new Set(tuning.in.split(',').filter((r) => VALID_ROLES.has(r)));
    if (roles.size === 0) roles = undefined;
  }
  const mode: SearchMode = tuning.mode === 'words' ? 'words' : 'phrase';
  const scope: SearchWordScope = tuning.co === 'session' ? 'session' : 'message';
  return { roles, mode, scope, wholeWord: tuning.w === '1' };
}

/**
 * The scan can run for seconds, so a client that gave up must stop it. The
 * signal is the RESPONSE closing unfinished: the request body arrived long ago
 * and its own close event says nothing about whether anyone is still listening.
 */
function abortSignalOf(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}

export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: Tuning & { q?: string } }>('/api/search', async (request, reply) => {
    const q = request.query.q?.trim() ?? '';
    if (q.length < 2) {
      return reply.code(400).send({ error: 'Query must be at least 2 characters' });
    }
    return ctx.search.search(q, readOptions(request.query));
  });

  // A POST because it is not a cheap lookup and because the session list it
  // narrows the scan to would not sit comfortably in a URL.
  app.post<{ Body: Tuning & { q?: string; sessionIds?: unknown } }>(
    '/api/search/deep',
    async (request, reply) => {
      const body = request.body ?? {};
      const q = typeof body.q === 'string' ? body.q.trim() : '';
      if (q.length < 2) {
        return reply.code(400).send({ error: 'Query must be at least 2 characters' });
      }
      let sessionIds: string[] | undefined;
      if (Array.isArray(body.sessionIds)) {
        sessionIds = body.sessionIds.filter((id): id is string => typeof id === 'string' && UUID.test(id));
        if (sessionIds.length > MAX_SESSION_IDS) {
          return reply.code(400).send({ error: 'Too many session ids' });
        }
      } else if (body.sessionIds !== undefined) {
        return reply.code(400).send({ error: 'sessionIds must be an array of session ids' });
      }
      return ctx.deepSearch.run({
        query: q,
        options: readOptions(body),
        sessionIds,
        signal: abortSignalOf(reply),
      });
    },
  );
}
