import type { ContentBlock } from '@claude-history/shared';
import { useState } from 'react';
import { formatTokens } from '../../lib/cost.ts';
import type { ParsedPlan } from '../../lib/plans.ts';
import { FileRefChip } from './FileRefLink.tsx';
import { FoldHeader } from './FoldHeader.tsx';
import { Markdown } from './Markdown.tsx';

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
