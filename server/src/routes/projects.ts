import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * The projects, and `?all=1` for the ones that are hidden too.
   *
   * One route rather than two because it is one list with one shape: the flag
   * only decides whether `hiddenProjects` has been applied to it. Everything
   * that BROWSES wants the default — a hidden project has no rows, no filter
   * chip and no place in the counts — and the only caller of `all` is the
   * settings page, which is where a hidden project is brought back from and so
   * is the one place that must be able to see one.
   */
  app.get<{ Querystring: { all?: string } }>('/api/projects', async (request) =>
    request.query.all === '1' ? ctx.index.projectsAll() : ctx.index.projects(),
  );
}
