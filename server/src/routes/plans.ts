import fsp from 'node:fs/promises';
import path from 'node:path';
import type { PlanEntry, PlansResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { normalizeProjectKey } from '../core/projects.ts';

/**
 * Whether the plan file still holds THIS plan.
 *
 * `~/.claude/plans/<slug>.md` is named after the session slug and OVERWRITTEN,
 * so a session that planned twice keeps only its latest — verified on
 * `quiero-que-planifiques-la-playful-pearl.md`, written by two approvals a day
 * apart, of which only the second survives.
 *
 * The file is read whole and compared in CHARACTERS. Comparing `stat.size` to
 * the recorded length is the obvious shortcut and it is wrong: that is bytes
 * against characters, and every plan on this machine is Spanish — the retention
 * plan is 12,299 characters and 12,546 bytes, so the shortcut answered "gone"
 * for every plan that still existed. There are nine of these files and the
 * largest is 51 KB; reading them is not worth optimising.
 */
async function stillOnDisk(filePath: string, preview: string, chars: number): Promise<boolean> {
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    return text.length === chars && text.startsWith(preview);
  } catch {
    return false;
  }
}

export function registerPlanRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Every plan ever submitted for approval, newest first.
  app.get('/api/plans', async (): Promise<PlansResponse> => {
    const out: PlanEntry[] = [];
    // `list()` already leaves out the hidden project — the auto-reload folder
    // has no filter chip and no sessions anywhere else, so its plans would be
    // stranded here.
    for (const summary of ctx.index.list()) {
      const plans = summary.enrichment?.plans;
      if (!plans?.length) continue;
      const projectKey = normalizeProjectKey(summary.projectPath);
      for (const plan of plans) {
        out.push({
          ...plan,
          sessionId: summary.id,
          sessionTitle: summary.title,
          project: summary.projectPath,
          projectKey,
          projectName: path.basename(summary.projectPath),
          onDisk: plan.filePath ? await stillOnDisk(plan.filePath, plan.preview, plan.chars) : null,
        });
      }
    }
    return out.sort((a, b) => (b.askedAt ?? '').localeCompare(a.askedAt ?? ''));
  });
}
