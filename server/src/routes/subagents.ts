import type { SubagentDetailResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { loadSubagents, parseTranscript } from '../core/parser.ts';
import { findSubagentFile, UUID_RE } from '../core/scanner.ts';

const AGENT_ID_RE = /^[0-9a-f]{6,64}$/i;

export function registerSubagentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Params: { id: string; agentId: string } }>(
    '/api/sessions/:id/subagents/:agentId',
    async (request, reply): Promise<SubagentDetailResponse | void> => {
      const { id, agentId } = request.params;
      if (!UUID_RE.test(id) || !AGENT_ID_RE.test(agentId)) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const scanned = ctx.index.getScanned(id);
      if (!scanned?.sessionDir) return reply.code(404).send({ error: 'Session not found' });

      const metas = await loadSubagents(scanned.sessionDir);
      const meta = metas.find((m) => m.agentId === agentId);
      if (!meta) return reply.code(404).send({ error: 'Subagent not found' });

      // Looked up among the session's agent folders, a workflow run's included,
      // never assembled from the request beyond the id it was validated as.
      const filePath = await findSubagentFile(scanned.sessionDir, agentId);
      if (!filePath) return reply.code(404).send({ error: 'Subagent not found' });
      const { turns, requests } = await parseTranscript(filePath, new Map(), ctx.config.projectsDir);
      return { meta, turns, requests };
    },
  );
}
