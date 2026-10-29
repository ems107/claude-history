import type { BashEditDiffSettingResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { readBashEditDiffSetting } from '../core/bashEditDiffSetting.ts';

export function registerBashEditDiffSettingRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Read fresh every time, like the thinking setting: the panel's Refresh is
  // this call, pressed after the file was edited by hand.
  app.get(
    '/api/claude-settings/bash-edit-diff',
    async (): Promise<BashEditDiffSettingResponse> => readBashEditDiffSetting(ctx.config, ctx.index),
  );
}
