import type { GitCommit } from '@claude-history/shared';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { ROW_H, type GraphRowLayout } from '../../lib/gitGraph.ts';
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
 */
export function GraphRow({
  commit,
  layout,
  graphW,
  selected,
  onSelect,
}: {
  commit: GitCommit;
  layout: GraphRowLayout;
  graphW: number;
  selected: boolean;
  onSelect: (sha: string) => void;
}) {
  return (
    <div
      data-sha={commit.sha}
      style={{ height: ROW_H }}
      onClick={() => {
        // Never steal a selection someone just made in order to copy a sha.
        if (hasSelection()) return;
        onSelect(commit.sha);
      }}
      className={`flex cursor-pointer items-center gap-2 pr-3 text-[11px] select-text ${
        selected
          ? 'bg-[var(--bg-hover)] outline outline-1 -outline-offset-1 outline-[var(--accent-dim)]'
          : 'hover:bg-[var(--bg-hover)]/50'
      }`}
    >
      <GraphSvg row={layout} width={graphW} />
      <span className="shrink-0 font-mono text-[var(--text-dim)]">{commit.shortSha}</span>
      {commit.refs.map((ref) => (
        <RefChip key={`${ref.kind}:${ref.fullRef}`} kind={ref.kind} name={ref.name} isHead={ref.isHead} />
      ))}
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
