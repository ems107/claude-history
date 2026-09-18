import fsp from 'node:fs/promises';
import path from 'node:path';
import { isRec } from './jsonl.ts';
import { createLogger } from './logger.ts';

const log = createLogger('chat');

/**
 * Where the plan a session is waiting on actually IS, which is two places.
 *
 * Claude Code up to 2.1.229 put the whole markdown in the `ExitPlanMode` call's
 * own `input.plan`; from 2.1.233 the tool takes no plan at all — its own
 * description tells the model to have "finished writing your plan to the plan
 * file" first — so it has to be read from `~/.claude/plans/<slug>.md`. The path
 * comes in the input when the CLI sends one, because the CLI KNOWS where it
 * wrote the file; the slug only says where it would be.
 *
 * One home, because two things ask: the composer, which holds a question open
 * until the browser answers it, and the bell, which has to name what a session
 * stopped for. They were the same fifteen lines twice, and a version of Claude
 * Code that moves the file again would have moved only one of them.
 *
 * Failing to find either is not fatal and never throws: both callers fall back
 * to showing the call itself, which is what they did for every other tool
 * before any of this existed.
 */
export async function resolvePlan(
  plansDir: string,
  slug: string | null | undefined,
  input: unknown,
): Promise<{ plan: string | null; planFilePath: string | null }> {
  const rec = isRec(input) ? input : {};
  const fromInput = typeof rec.plan === 'string' && rec.plan.trim() ? rec.plan : null;
  const planFilePath =
    (typeof rec.planFilePath === 'string' && rec.planFilePath) || (slug ? path.join(plansDir, `${slug}.md`) : null);
  if (fromInput) return { plan: fromInput, planFilePath };
  if (!planFilePath) return { plan: null, planFilePath: null };
  try {
    const text = await fsp.readFile(planFilePath, 'utf8');
    return { plan: text.trim() ? text : null, planFilePath };
  } catch (err) {
    log.debug(`no plan file at ${planFilePath}`, err);
    return { plan: null, planFilePath };
  }
}
