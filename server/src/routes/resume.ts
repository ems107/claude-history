import fs from 'node:fs';
import type { ResumeResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { pidAlive } from '../core/live.ts';
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
      // Two writers on one transcript is what produces the duplicated uuids and
      // replayed segments the parser has to undo, and the composer already
      // refuses a prompt for exactly this reason (`sendBlockedReason`).
      // Launching a second terminal is the same corruption through the other
      // door — and the likelier one, with a window open per monitor.
      //
      // Our own process first: it registers a pid file like any other CLI, so
      // the check below would find it and blame a terminal that does not exist.
      if (ctx.chat.status(id).running) {
        return reply.code(409).send({
          error: 'The app is already running Claude in this session — stop it in the composer first, or two writers would corrupt its transcript.',
        });
      }
      // `pidAlive` is re-checked rather than trusted from the list: that list is
      // only rebuilt when something writes to ~/.claude/sessions, and a CLI
      // killed outright writes nothing on the way out, so its file would block
      // the session forever.
      const open = ctx.index.liveSessions.find((l) => l.sessionId === id && pidAlive(l.pid));
      if (open) {
        return reply.code(409).send({
          error: `This session is already open in a terminal (pid ${String(open.pid)}) — resuming it twice would corrupt its transcript. Close that window first, or copy the command if you mean to.`,
        });
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
