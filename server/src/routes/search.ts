import type { SearchMode, SearchWordScope } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

const VALID_ROLES = new Set(['title', 'user', 'assistant']);

interface SearchQuerystring {
  q?: string;
  in?: string;
  mode?: string;
  co?: string;
  w?: string;
}

export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: SearchQuerystring }>('/api/search', async (request, reply) => {
    const q = request.query.q?.trim() ?? '';
    if (q.length < 2) {
      return reply.code(400).send({ error: 'Query must be at least 2 characters' });
    }
    let roles: Set<string> | undefined;
    if (request.query.in) {
      roles = new Set(request.query.in.split(',').filter((r) => VALID_ROLES.has(r)));
      if (roles.size === 0) roles = undefined;
    }
    // Anything unrecognised falls back to the plain phrase search, so a stale or
    // hand-edited URL degrades to the simple behaviour instead of failing.
    const mode: SearchMode = request.query.mode === 'words' ? 'words' : 'phrase';
    const scope: SearchWordScope = request.query.co === 'session' ? 'session' : 'message';
    return ctx.search.search(q, { roles, mode, scope, wholeWord: request.query.w === '1' });
  });
}
