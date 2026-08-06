import fs from 'node:fs';
import type { ResumeResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { UUID_RE } from '../core/scanner.ts';
import { launchResume, openInExplorer, openInVsCode } from '../util/launcher.ts';

export function registerResumeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/resume',
    async (request, reply): Promise<ResumeResponse | void> => {
      const { id } = request.params;
      // Strict validation: UUID shape AND membership in the index; the cwd
      // comes exclusively from the index, never from the request.
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      const summary = ctx.index.get(id);
      if (!summary) return reply.code(404).send({ error: 'Session not found' });

      const cwd = summary.projectPath;
      if (!fs.existsSync(cwd)) {
        return reply.code(409).send({ error: `Project directory no longer exists: ${cwd}` });
      }
      try {
        const result = await launchResume(cwd, id);
        return { ok: true, ...result };
      } catch (err) {
        return reply.code(500).send({ error: `Failed to launch terminal: ${String(err)}` });
      }
    },
  );

  // Open the project folder in Explorer or VS Code. Same validation model as
  // resume: id must be in the index, cwd comes only from the index.
  app.post<{ Params: { id: string }; Querystring: { target?: string } }>(
    '/api/sessions/:id/open',
    async (request, reply) => {
      const { id } = request.params;
      const target = request.query.target ?? '';
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (target !== 'explorer' && target !== 'vscode') {
        return reply.code(400).send({ error: 'target must be explorer or vscode' });
      }
      const summary = ctx.index.get(id);
      if (!summary) return reply.code(404).send({ error: 'Session not found' });
      const cwd = summary.projectPath;
      if (!fs.existsSync(cwd)) {
        return reply.code(409).send({ error: `Project directory no longer exists: ${cwd}` });
      }
      try {
        if (target === 'explorer') await openInExplorer(cwd);
        else await openInVsCode(cwd);
        return { ok: true };
      } catch (err) {
        return reply.code(500).send({ error: `Failed to open ${target}: ${String(err)}` });
      }
    },
  );
}
