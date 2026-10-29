import type { ThinkingSettingResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { readThinkingSetting } from '../core/thinkingSetting.ts';

export function registerThinkingSettingRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Read fresh every time, like the retention: the panel's Refresh is this call,
  // pressed after the file was edited by hand.
  app.get(
    '/api/claude-settings/thinking',
    async (): Promise<ThinkingSettingResponse> => readThinkingSetting(ctx.config, ctx.index.projects()),
  );
}
