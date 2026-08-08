import path from 'node:path';
import type { PromptsResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { normalizeProjectKey } from '../core/projects.ts';

export function registerPromptRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Every prompt ever typed, from the global ~/.claude/history.jsonl.
  app.get('/api/prompts', async (): Promise<PromptsResponse> => {
    return ctx.index.historyData.entries
      .map((e) => ({
        display: e.display,
        timestamp: e.timestamp,
        project: e.project,
        projectKey: normalizeProjectKey(e.project),
        projectName: path.basename(e.project),
        sessionId: e.sessionId,
        sessionExists: ctx.index.get(e.sessionId) !== undefined,
      }))
      // A hidden project has no filter chip and no sessions anywhere else, so
      // leaving its prompts here would strand them.
      .filter((e) => !ctx.index.isHiddenProject(e.projectKey))
      .sort((a, b) => b.timestamp - a.timestamp);
  });
}
