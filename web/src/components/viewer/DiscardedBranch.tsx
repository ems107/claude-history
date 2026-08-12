import type { PriceTable } from '@claude-history/shared';
import type { ReactNode } from 'react';
import { costEntries, formatUsd, sumCost } from '../../lib/cost.ts';
import { formatDateTime } from '../../lib/format.ts';
import { type SegmentTurn, summarizeTurns } from '../../lib/segments.ts';
import { FoldHeader } from './FoldHeader.tsx';

/**
 * What a `/rewind` cut away, folded into one line.
 *
 * The transcript keeps a rewound branch forever — nothing is deleted, the new
 * prompt is simply hung off an earlier message — so a viewer that reads the file
 * in order shows a conversation that no longer exists, with the live answer
 * appearing to follow messages it never saw. Claude Code walks `parentUuid` and
 * hides it; this fold is the same decision, made visible instead of silent: the
 * turns are one click away, and the header says what they cost, because that
 * money was really spent (unlike a fork's carried-over context).
 */
export function DiscardedBranch({
  turns,
  prices,
  open,
  onToggle,
  children,
}: {
  turns: SegmentTurn[];
  prices: PriceTable;
  open: boolean;
  onToggle: () => void;
  /** The discarded turns — only rendered when open. */
  children?: ReactNode;
}) {
  const { items, prompts, firstAt, lastAt } = summarizeTurns(turns);
  const cost = sumCost(costEntries(items, prices));
  const range =
    firstAt && lastAt ? `${formatDateTime(firstAt)} → ${formatDateTime(lastAt)}` : firstAt ? formatDateTime(firstAt) : '';

  return (
    <div className="rounded border border-dashed border-rose-500/30 bg-rose-500/5">
      <FoldHeader
        open={open}
        onToggle={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs hover:bg-rose-500/5"
        title={
          open
            ? 'Fold this branch back'
            : 'Unfold the branch a /rewind cut away — Claude Code no longer shows it, but it is still in the transcript'
        }
      >
        <span className="text-[var(--text-dim)]">{open ? '▾' : '▸'}</span>
        <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-rose-300 uppercase">
          rewound away
        </span>
        <span>
          <b className="text-[var(--text)]">{turns.length}</b> turn{turns.length === 1 ? '' : 's'}
          {prompts > 0 && (
            <>
              , <b className="text-[var(--text)]">{prompts}</b> prompt{prompts === 1 ? '' : 's'}
            </>
          )}
        </span>
        {range && <span className="text-[var(--text-dim)]">{range}</span>}
        {cost !== null && (
          <span className="font-mono text-[var(--text-dim)]" title="Billed all the same — a rewind does not refund it">
            {formatUsd(cost)}
          </span>
        )}
        <span className="ml-auto text-[var(--text-dim)] opacity-70">discarded by a rewind</span>
      </FoldHeader>
      {open && <div className="space-y-4 border-t border-dashed border-rose-500/30 px-3 py-3">{children}</div>}
    </div>
  );
}
