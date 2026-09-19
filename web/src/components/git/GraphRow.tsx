import type { GitCommit } from '@claude-history/shared';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { type GraphRowLayout } from '../../lib/gitGraph.ts';
import { hasSelection } from '../../lib/selection.ts';
import { GraphSvg } from './GraphSvg.tsx';
import { RefChip } from './RefChip.tsx';

/**
 * One commit.
 *
 * Selection is a background plus an outline, never a filter and never a
 * transform: this row will grow a hover card for the sha, and a filtered
 * ancestor becomes the containing block for anything `position: fixed` inside
 * it — which is how a popover ends up anchored to a row instead of to the
 * window.
 *
 * **`stacked` is the phone, and it is an arithmetic problem rather than a
 * taste one.** One line spends 220px on the graph, ~60 on the sha, 112 on the
 * author and 96 on the date before the subject — the only thing anybody scans
 * a history for — gets a pixel. At 360px that leaves the subject nothing. So
 * the same four facts go on two lines inside a 44px row: the refs and the
 * subject above, the sha, the author and the date below, all of them still
 * there and none of them a tooltip.
 */
export function GraphRow({
  commit,
  layout,
  graphW,
  rowH,
  stacked = false,
  selected,
  isHead = false,
  onSelect,
}: {
  commit: GitCommit;
  layout: GraphRowLayout;
  graphW: number;
  /** Decided by the list, because the virtualiser positions rows by the same number. */
  rowH: number;
  stacked?: boolean;
  selected: boolean;
  /** This is where the working tree is standing. */
  isHead?: boolean;
  onSelect: (sha: string) => void;
}) {
  /**
   * **Where you ARE and what you are LOOKING AT are two different rows**, and
   * the list only ever said the second. Scrolling a thousand commits, nothing
   * answered the question this view exists to answer first — which one is
   * checked out — except reading the refs on each row, and a detached HEAD has
   * none to read.
   *
   * So HEAD is the accent as a wash, permanently, and selection stays what it
   * was: a lift and an outline. Written as one ternary chain rather than two
   * appended classes, because two `bg-*` in one list is a question about which
   * one Tailwind emitted last.
   */
  const tone = `${
    isHead
      ? 'bg-[var(--accent)]/12'
      : selected
        ? 'bg-[var(--bg-hover)]'
        : 'hover:bg-[var(--bg-hover)]/50'
  } ${selected ? 'outline outline-1 -outline-offset-1 outline-[var(--accent)]' : ''}`;
  const refs = commit.refs.map((ref) => (
    <RefChip key={`${ref.kind}:${ref.fullRef}`} kind={ref.kind} name={ref.name} isHead={ref.isHead} />
  ));

  const pick = () => {
    // Never steal a selection someone just made in order to copy a sha.
    // On a phone a selection can outlive the tap that made it, and there the
    // row IS the only way into the commit — so the guard would take the page
    // away rather than protect anything.
    if (!stacked && hasSelection()) return;
    onSelect(commit.sha);
  };

  if (stacked) {
    return (
      <div
        data-sha={commit.sha}
        style={{ height: rowH }}
        onClick={pick}
        className={`flex cursor-pointer items-center gap-2 pr-2 text-[11px] ${tone}`}
      >
        <GraphSvg row={layout} width={graphW} height={rowH} />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <span className="flex min-w-0 items-center gap-1">
            {refs}
            <span className="min-w-0 flex-1 truncate text-[var(--text)]">{commit.subject}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-dim)]">
            <span className="shrink-0 font-mono">{commit.shortSha}</span>
            <span className="min-w-0 truncate">{commit.authorName}</span>
            <span className="ml-auto shrink-0 tabular-nums">{relativeTime(commit.authoredAt)}</span>
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      data-sha={commit.sha}
      style={{ height: rowH }}
      onClick={pick}
      className={`flex cursor-pointer items-center gap-2 pr-3 text-[11px] select-text ${tone}`}
    >
      <GraphSvg row={layout} width={graphW} height={rowH} />
      <span className="shrink-0 font-mono text-[var(--text-dim)]">{commit.shortSha}</span>
      {refs}
      <span className="min-w-0 flex-1 truncate text-[var(--text)]" title={commit.subject}>
        {commit.subject}
      </span>
      <span className="w-28 shrink-0 truncate text-[var(--text-dim)]" title={commit.authorEmail}>
        {commit.authorName}
      </span>
      {/* The app's date contract: relative on screen, absolute in the title. */}
      <span
        className="w-24 shrink-0 text-right tabular-nums text-[var(--text-dim)]"
        title={formatDateTime(commit.authoredAt)}
      >
        {relativeTime(commit.authoredAt)}
      </span>
    </div>
  );
}
