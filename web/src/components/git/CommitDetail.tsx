import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../../api/git.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { DiffView } from './DiffView.tsx';
import { RefChip } from './RefChip.tsx';

const STATUS_TONE: Record<string, string> = {
  A: 'text-emerald-400',
  M: 'text-amber-400',
  D: 'text-red-400',
  R: 'text-sky-400',
  C: 'text-sky-400',
  T: 'text-purple-400',
};

/**
 * The selected commit: who wrote it, what it says, what it touched, and the
 * diff itself.
 *
 * A merge is shown against its first parent. `git show` prints nothing at all
 * for a merge otherwise, which reads as "this changed no files" — the one
 * thing that is certainly untrue about a merge commit.
 */
export function CommitDetail({
  repoId,
  sha,
  selectedPath,
  onSelectPath,
}: {
  repoId: string;
  sha: string;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
}) {
  const detailQ = useQuery({
    queryKey: ['git', 'commit', repoId, sha],
    queryFn: () => gitApi.commit(repoId, sha),
  });
  const diffQ = useQuery({
    queryKey: ['git', 'diff', repoId, sha, selectedPath],
    queryFn: () => gitApi.diff(repoId, { mode: 'commit', sha, path: selectedPath }),
  });

  if (detailQ.isLoading) return <p className="text-[11px] text-[var(--text-dim)]">Reading the commit…</p>;
  if (detailQ.isError) {
    return <p className="text-[11px] text-red-400">Could not read that commit: {String(detailQ.error)}</p>;
  }
  const detail = detailQ.data;
  if (!detail) return null;
  const { commit } = detail;

  return (
    <div className="space-y-3">
      <div className="rounded border border-[var(--border)] bg-[var(--bg-raised)]/40 p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <button
            type="button"
            onClick={() => void copyPlain(commit.sha)}
            title="Copy the full sha"
            className="cursor-pointer font-mono text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            {commit.sha}
          </button>
          {commit.refs.map((ref) => (
            <RefChip key={`${ref.kind}:${ref.fullRef}`} kind={ref.kind} name={ref.name} isHead={ref.isHead} />
          ))}
        </div>

        <p className="mt-1.5 text-sm">{commit.subject}</p>
        {detail.body && (
          <pre className="mt-1.5 max-h-64 overflow-auto rounded bg-black/30 p-2 text-[11px] whitespace-pre-wrap">
            {detail.body}
          </pre>
        )}

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
          <span title={commit.authorEmail}>
            {commit.authorName} · <span title={formatDateTime(commit.authoredAt)}>{relativeTime(commit.authoredAt)}</span>
          </span>
          {/* Only worth saying when it differs — a rebase or an amend is exactly
              when the difference matters. */}
          {(detail.committerName !== commit.authorName || commit.committedAt !== commit.authoredAt) && (
            <span title={detail.committerEmail}>
              committed by {detail.committerName} ·{' '}
              <span title={formatDateTime(commit.committedAt)}>{relativeTime(commit.committedAt)}</span>
            </span>
          )}
          <span>
            {commit.parents.length === 0
              ? 'root commit'
              : commit.parents.length === 1
                ? `parent ${commit.parents[0].slice(0, 7)}`
                : `merge of ${commit.parents.map((p) => p.slice(0, 7)).join(' and ')}`}
          </span>
          <span className="tabular-nums">
            {detail.files.length} file{detail.files.length === 1 ? '' : 's'}
            {' · '}
            <span className="text-emerald-400">+{detail.additions}</span>{' '}
            <span className="text-red-400">−{detail.deletions}</span>
          </span>
          {commit.parents.length > 1 && <span>shown against its first parent</span>}
        </div>
      </div>

      {detail.files.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => onSelectPath(null)}
            className={`cursor-pointer rounded px-1.5 py-0.5 ${
              selectedPath === null ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
            }`}
          >
            all files
          </button>
          {detail.files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onSelectPath(file.path)}
              title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
              className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-mono ${
                selectedPath === file.path ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]/60'
              }`}
            >
              <span className={`w-2 ${STATUS_TONE[file.status] ?? 'text-[var(--text-dim)]'}`}>{file.status}</span>
              <span className="max-w-[22rem] truncate">{file.path}</span>
            </button>
          ))}
          {detail.truncated && <span className="text-amber-400">…more files than are listed</span>}
        </div>
      )}

      {diffQ.isLoading && <p className="text-[11px] text-[var(--text-dim)]">Reading the diff…</p>}
      {diffQ.isError && <p className="text-[11px] text-red-400">Could not read the diff: {String(diffQ.error)}</p>}
      {diffQ.data && (
        <DiffView files={diffQ.data.files} truncated={diffQ.data.truncated} selectedPath={selectedPath} />
      )}
    </div>
  );
}
