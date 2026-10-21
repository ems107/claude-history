import type { ElevatedTerminalsStatus } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { createLogger } from '../core/logger.ts';

const log = createLogger('elevated');

/**
 * Administrator terminals: whether this copy has its scheduled task, and the
 * two buttons that register and remove it.
 *
 * Turning it on and off are local-only (`util/localOnlyRoutes.ts`) for the
 * firewall's reason — each raises a UAC prompt on this machine's desktop. USING
 * it is not: once the task exists an elevated terminal starts with no prompt
 * at all, from wherever the request came, and that is the feature.
 */
export function registerElevatedTerminalRoutes(app: FastifyInstance, ctx: AppContext): void {
  // A fresh read, not the cache: this is the panel, opened by somebody who may
  // have just deleted the task in Task Scheduler and come back to check.
  app.get('/api/elevated-terminals', async (): Promise<ElevatedTerminalsStatus> => ctx.elevated.refresh());

  app.post('/api/elevated-terminals', async (_request, reply) => {
    try {
      return await ctx.elevated.enable();
    } catch (err) {
      // Cancelling the UAC dialog lands here, and it is the likeliest way to.
      log.warn('could not register the elevated host task', err);
      return reply.code(409).send({
        error: `Administrator terminals were not turned on — Windows has to approve it on this machine. ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  });

  app.delete('/api/elevated-terminals', async (_request, reply) => {
    try {
      return await ctx.elevated.disable();
    } catch (err) {
      log.warn('could not remove the elevated host task', err);
      return reply.code(409).send({
        error: `Administrator terminals were not turned off — Windows has to approve it on this machine. ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  });
}
