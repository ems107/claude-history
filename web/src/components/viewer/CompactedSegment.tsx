import type { PriceTable } from '@claude-history/shared';
import type { ReactNode } from 'react';
import { formatContextTokens } from '../../lib/context.ts';
import { costEntries, formatUsd, sumCost } from '../../lib/cost.ts';
import { formatDateTime } from '../../lib/format.ts';
import { type Segment, summarizeSegment } from '../../lib/segments.ts';
import { FoldHeader } from '../FoldHeader.tsx';

/**
 * A stretch of conversation the model no longer sees, folded into one line.
 *
 * A compacted session is mostly this: 95 % of the scroll can be context that
 * was dropped hours ago, which used to read exactly like the part still alive.
 * Collapsed by default for that reason — and the header carries the figures the
 * boundary panel would have shown, so folding it hides nothing that matters at
 * a glance.
 */
export function CompactedSegment({
  segment,
  prices,
  open,
  onToggle,
  children,
}: {
  segment: Segment;
  prices: PriceTable;
  open: boolean;
  onToggle: () => void;
  /** The segment's turns — only rendered when open. */
  children?: ReactNode;
}) {
  const { items, prompts, firstAt, lastAt } = summarizeSegment(segment);
  const cost = sumCost(costEntries(items, prices));
  const b = segment.boundary;

  const range =
    firstAt && lastAt ? `${formatDateTime(firstAt)} → ${formatDateTime(lastAt)}` : firstAt ? formatDateTime(firstAt) : '';

  return (
    <div className="rounded border border-amber-500/25 bg-amber-500/5">
      <FoldHeader
        open={open}
        onToggle={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs hover:bg-amber-500/5"
        title={open ? 'Fold this context back' : 'Unfold everything that was compacted away here'}
      >
        <span className="text-[var(--text-dim)]">{open ? '▾' : '▸'}</span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300 uppercase">
          earlier context
        </span>
        <span>
          <b className="text-[var(--text)]">{prompts}</b> prompt{prompts === 1 ? '' : 's'}
        </span>
        {range && <span className="text-[var(--text-dim)]">{range}</span>}
        {cost !== null && <span className="font-mono text-[var(--text-dim)]">{formatUsd(cost)}</span>}
        {b && b.preTokens !== null && b.postTokens !== null && (
          <span className="ml-auto font-mono text-[var(--text-dim)]">
            compacted {formatContextTokens(b.preTokens)} → {formatContextTokens(b.postTokens)}
            {b.trigger ? ` (${b.trigger})` : ''}
          </span>
        )}
      </FoldHeader>
      {open && <div className="space-y-4 border-t border-amber-500/25 px-3 py-3">{children}</div>}
    </div>
  );
}
