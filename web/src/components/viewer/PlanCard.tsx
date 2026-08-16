import type { ContentBlock } from '@claude-history/shared';
import { useState } from 'react';
import { formatTokens } from '../../lib/cost.ts';
import { FileRefChip } from './FileRefLink.tsx';
import { FoldHeader } from './FoldHeader.tsx';
import { Markdown } from './Markdown.tsx';

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
function titleOf(markdown: string): string | null {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : null;
}

/**
 * The plan out of an `ExitPlanMode` call, or null for every other tool.
 *
 * The text lives in two places and neither is guaranteed. Claude Code used to
 * put the whole markdown in the call's `input.plan` (14 of 14 calls made by
 * 2.1.222 through 2.1.229); newer versions have the model write the plan to
 * `~/.claude/plans/<slug>.md` first and send no input at all, keeping only a
 * copy on the RESULT when the plan is approved. So both are read, and a plan
 * that is refused by a version that sends neither leaves nothing but the file
 * link — which is still worth drawing, because the file is right there.
 */
export function parsePlan(block: ToolBlockType): ParsedPlan | null {
  if (block.toolName !== 'ExitPlanMode') return null;
  const input = block.input as { plan?: unknown } | null;
  const fromInput = typeof input?.plan === 'string' && input.plan.trim() ? input.plan : null;
  const outcome = block.result?.plan ?? null;
  const text = fromInput ?? outcome?.text ?? null;
  return {
    text,
    title: text ? titleOf(text) : null,
    // No result yet is a real state and not a missing one: the plan is on
    // screen and nobody has answered it.
    status: outcome?.status ?? 'pending',
    filePath: outcome?.filePath ?? null,
    feedback: outcome?.feedback ?? null,
  };
}

const STATUS: Record<ParsedPlan['status'], { label: string; tone: string; box: string }> = {
  approved: { label: '✔ approved', tone: 'text-emerald-400', box: 'border-emerald-500/30 bg-emerald-500/5' },
  rejected: { label: '✖ not approved', tone: 'text-amber-400', box: 'border-amber-500/30 bg-amber-500/5' },
  pending: { label: 'awaiting an answer', tone: 'text-[var(--text-dim)]', box: 'border-zinc-500/25 bg-zinc-500/5' },
};

/**
 * The plan as a part of the conversation rather than as one of the tool calls.
 *
 * Same reasoning as `AnsweredQuestionCard`, which it sits beside: Claude
 * stopping to submit a plan is a turn of the conversation in miniature, and the
 * plan is the design decision every answer after it rests on — folded in among
 * twenty Reads it reads as plumbing. The call itself stays in the run behind
 * this one, with its raw input, its result and its cost, so a `?tool=` link and
 * the cost pills are untouched.
 *
 * The body folds because a plan runs to 25 KB and the conversation has to stay
 * scannable; the heading in the header is what identifies it meanwhile. The
 * REJECTION never folds: it is one sentence, it is the reason the plan was
 * refused, and it is the instruction the next turn acts on.
 */
export function PlanCard({ parsed }: { parsed: ParsedPlan }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[parsed.status];
  return (
    <div className={`my-2 rounded-lg border px-3 py-2 ${status.box}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
          Assistant proposed a plan
        </span>
        <span className={`text-[10px] font-semibold tracking-wider uppercase ${status.tone}`}>{status.label}</span>
      </div>
      {parsed.title && <div className="mt-1 text-sm font-semibold text-[var(--text)]">{parsed.title}</div>}
      {/* The chip is a SIBLING of the fold header, never inside it: nothing
          interactive may be nested in one. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        {parsed.text ? (
          <FoldHeader
            open={open}
            onToggle={() => setOpen((v) => !v)}
            className="rounded px-1 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            {open ? '▾' : '▸'} the plan · {formatTokens(parsed.text.length)} chars
          </FoldHeader>
        ) : (
          <span className="px-1 py-0.5 text-xs text-[var(--text-dim)]">
            The plan itself was not recorded in this transcript.
          </span>
        )}
        {parsed.filePath && (
          <FileRefChip path={parsed.filePath} title={`Open the saved plan — ${parsed.filePath}`} />
        )}
      </div>
      {open && parsed.text && (
        <div className="mt-1.5 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
          <Markdown text={parsed.text} />
        </div>
      )}
      {parsed.feedback && (
        <div className="mt-2 border-l-2 border-amber-500/40 pl-2.5">
          <div className="text-[10px] font-semibold tracking-wider text-amber-400/80 uppercase">the user said</div>
          <div className="mt-0.5 text-sm whitespace-pre-wrap text-[var(--text)]">{parsed.feedback}</div>
        </div>
      )}
    </div>
  );
}

type PlanModeBlock = Extract<ContentBlock, { kind: 'plan-mode' }>;

const EVENT: Record<PlanModeBlock['event'], string> = {
  enter: 'Entered plan mode',
  reentry: 'Back in plan mode',
  exit: 'Left plan mode',
  reference: 'The plan was carried through a compaction',
};

/**
 * The session entering or leaving plan mode: a thin line, because that is what
 * it is — the state changed, and the exchange around it is what matters.
 *
 * The `reference` flavour is the exception: it carries the whole plan,
 * re-injected so it survives a compaction, and that copy folds like any other.
 */
export function PlanModeMarker({ block }: { block: PlanModeBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5 flex flex-wrap items-center gap-2 rounded border border-dashed border-violet-500/30 bg-violet-500/5 px-3 py-1 text-xs">
      <span className="text-[10px] font-semibold tracking-wider text-violet-300 uppercase">plan mode</span>
      <span className="text-[var(--text-dim)]">{EVENT[block.event]}</span>
      {block.planContent && (
        <FoldHeader
          open={open}
          onToggle={() => setOpen((v) => !v)}
          className="rounded px-1 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          {open ? '▾' : '▸'} the plan · {formatTokens(block.planContent.length)} chars
        </FoldHeader>
      )}
      {block.planFilePath && <FileRefChip path={block.planFilePath} title={`Open the plan file — ${block.planFilePath}`} />}
      {open && block.planContent && (
        <div className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
          <Markdown text={block.planContent} />
        </div>
      )}
    </div>
  );
}
