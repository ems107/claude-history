import type { ContentBlock } from '@claude-history/shared';

type ToolBlockType = Extract<ContentBlock, { kind: 'tool' }>;

export interface ParsedPlan {
  /** The plan itself. Null only when neither the call nor the result carried it. */
  text: string | null;
  /** Its first `# heading` — what names it when it is folded. */
  title: string | null;
  status: 'approved' | 'rejected' | 'pending';
  filePath: string | null;
  /** What the user said instead of approving. */
  feedback: string | null;
}

/** The first `# heading` of a plan. Mirrors `planTitle` on the server. */
export function planTitle(markdown: string): string | null {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : null;
}

/**
 * The plan out of an `ExitPlanMode` call, or null for every other tool.
 *
 * Pure and free of the DOM on purpose: the card, the export and the per-message
 * copy all read a plan the same way, and the last two must never disagree with
 * what is on screen.
 *
 * The text lives in two places and neither is guaranteed. Claude Code used to
 * put the whole markdown in the call's `input.plan` (14 of 14 calls made by
 * 2.1.222 through 2.1.229); newer versions have the model write the plan to
 * `~/.claude/plans/<slug>.md` first and send no input at all, keeping a copy
 * only on the RESULT of an APPROVED plan. So both are read, and a plan refused
 * by a version that sends neither leaves only the file link — still worth
 * drawing, because the file is right there.
 */
export function parsePlan(block: ToolBlockType): ParsedPlan | null {
  if (block.toolName !== 'ExitPlanMode') return null;
  const input = block.input as { plan?: unknown } | null;
  const fromInput = typeof input?.plan === 'string' && input.plan.trim() ? input.plan : null;
  const outcome = block.result?.plan ?? null;
  const text = fromInput ?? outcome?.text ?? null;
  return {
    text,
    title: text ? planTitle(text) : null,
    // No result yet is a real state and not a missing one: the plan is on
    // screen and nobody has answered it.
    status: outcome?.status ?? 'pending',
    filePath: outcome?.filePath ?? null,
    feedback: outcome?.feedback ?? null,
  };
}
