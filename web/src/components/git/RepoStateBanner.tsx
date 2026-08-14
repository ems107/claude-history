import type { GitStatus } from '@claude-history/shared';

const KIND_LABEL: Record<string, string> = {
  merge: 'Merging',
  rebase: 'Rebasing',
  'rebase-interactive': 'Rebasing (interactive)',
  am: 'Applying patches',
  'cherry-pick': 'Cherry-picking',
  revert: 'Reverting',
  bisect: 'Bisecting',
};

/**
 * What the repository is in the middle of.
 *
 * Read-only for now: the buttons that finish or abort it arrive with the rest
 * of the write half. Showing the state before that is not a placeholder — a
 * repository sitting in a half-finished rebase is exactly the thing a viewer
 * must not stay quiet about, and every operation it blocks already says so.
 */
export function RepoStateBanner({ status }: { status: GitStatus | undefined }) {
  const inProgress = status?.inProgress;
  if (!inProgress || !status) return null;

  const conflicted = status.entries.filter((e) => e.conflicted).length;
  const step =
    inProgress.step !== null && inProgress.total !== null ? ` — step ${inProgress.step} of ${inProgress.total}` : '';

  return (
    <div className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <p className="text-amber-300">
        ⚠ {KIND_LABEL[inProgress.kind] ?? inProgress.kind}
        {inProgress.headName && ` ${inProgress.headName}`}
        {inProgress.ontoSha && ` onto ${inProgress.ontoSha.slice(0, 7)}`}
        {step}
      </p>
      <p className="mt-0.5 text-[11px] text-amber-300/80">
        {conflicted > 0
          ? `${conflicted} file${conflicted === 1 ? '' : 's'} still conflicted. Conflicts are resolved outside this app — open the repository, fix the markers, then come back.`
          : 'Nothing is conflicted right now.'}
      </p>
    </div>
  );
}
