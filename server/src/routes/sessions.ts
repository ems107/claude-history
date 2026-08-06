import type { LineageResponse } from '@claude-history/shared';
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

  // Rename a session LOCALLY (override stored in userdata.json — this tool
  // never writes into ~/.claude, so Claude Code's own /resume keeps showing
  // the original title). Empty title removes the override.
  app.put<{ Params: { id: string }; Body: { title?: unknown } }>(
    '/api/sessions/:id/title',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });
      const raw = request.body?.title;
      if (raw !== undefined && typeof raw !== 'string') {
        return reply.code(400).send({ error: 'title must be a string' });
      }
      const title = (raw ?? '').trim().slice(0, 300);
      await ctx.index.setTitleOverride(id, title || null);
      return { ok: true, summary: ctx.index.get(id) };
    },
  );

  // Full resume/fork lineage graph around a session (transitive closure over
  // resumedFrom ancestry + descendants). Referenced-but-deleted sessions
  // appear as exists:false nodes.
  app.get<{ Params: { id: string } }>('/api/sessions/:id/lineage', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });

    const nodes = new Map<string, LineageResponse['nodes'][number]>();
    const edges = new Set<string>();
    const queue = [id];
    while (queue.length > 0 && nodes.size < 200) {
      const current = queue.shift()!;
      if (nodes.has(current)) continue;
      const s = ctx.index.get(current);
      nodes.set(current, {
        id: current,
        exists: s !== undefined,
        title: s?.title ?? null,
        projectKey: s?.projectKey ?? null,
        projectName: s?.projectName ?? null,
        createdAt: s?.createdAt ?? null,
        lastActivityAt: s?.lastActivityAt ?? null,
      });
      if (!s) continue;
      for (const ancestor of s.enrichment?.resumedFrom ?? []) {
        edges.add(`${ancestor}>${current}`);
        queue.push(ancestor);
      }
      for (const child of s.descendants) {
        edges.add(`${current}>${child}`);
        queue.push(child);
      }
    }
    const response: LineageResponse = {
      nodes: [...nodes.values()],
      edges: [...edges].map((e) => {
        const [from, to] = e.split('>');
        return { from, to };
      }),
    };
    return response;
  });

  // Pin/unpin a session (stored in userdata.json, never in ~/.claude).
  app.put<{ Params: { id: string }; Body: { pinned?: unknown } }>(
    '/api/sessions/:id/pin',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });
      if (typeof request.body?.pinned !== 'boolean') {
        return reply.code(400).send({ error: 'pinned must be a boolean' });
      }
      await ctx.index.setPinned(id, request.body.pinned);
      return { ok: true, summary: ctx.index.get(id) };
    },
  );
}
