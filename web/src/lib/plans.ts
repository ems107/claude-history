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

/** One remark the reader filed against a passage of the plan. */
export interface PlanFeedbackComment {
  quote: string;
  heading: string | null;
  text: string;
}

/** What the user sent back with a plan, taken apart. */
export interface PlanFeedback {
  /** What they typed in their own words, if anything. */
  note: string | null;
  comments: PlanFeedbackComment[];
}

/** The line this app (and Claude Code's IDE panel) writes before the comments. */
const COMMENTS_MARKER = 'Comments on the plan:';

/**
 * Read the comments back out of a plan's feedback.
 *
 * The feedback is ONE string — that is all the transcript keeps, and all Claude
 * ever saw ([AI_AGENTS_QUESTIONS_PLANS.md](../../docs/AI_AGENTS_QUESTIONS_PLANS.md)) —
 * so the note and the remarks arrive glued together in the shape they were sent:
 * a `Comments on the plan:` line and then `[Re: "<quote>" · under "<heading>"]
 * <comment>` per remark. Splitting them again is presentation only: the wire
 * format is what the model reads and is not changed for the sake of the card.
 *
 * Entries are cut at a line STARTING a new `[Re: "`, never at every newline: a
 * comment is a textarea and may hold several lines. Anything that does not parse
 * leaves the whole feedback as a plain note, which is the truthful fallback for
 * a plan refused from a terminal or by another client.
 */
export function parsePlanFeedback(feedback: string): PlanFeedback {
  const at = feedback.lastIndexOf(COMMENTS_MARKER);
  if (at < 0) return { note: feedback.trim() || null, comments: [] };
  const note = feedback.slice(0, at).trim();
  const body = feedback.slice(at + COMMENTS_MARKER.length).trim();
  const comments: PlanFeedbackComment[] = [];
  for (const entry of body.split(/\n(?=\[Re: ")/)) {
    const m = /^\[Re: "([\s\S]*?)"(?: · under "([\s\S]*?)")?\]\s*([\s\S]*)$/.exec(entry.trim());
    if (!m) return { note: feedback.trim() || null, comments: [] };
    comments.push({ quote: m[1], heading: m[2] ?? null, text: m[3].trim() });
  }
  if (comments.length === 0) return { note: feedback.trim() || null, comments: [] };
  return { note: note || null, comments };
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
