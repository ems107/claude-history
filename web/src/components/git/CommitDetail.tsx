import type { GitStatus } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { gitApi } from '../../api/git.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { btn, inputClass } from '../../lib/ui.ts';
import { toggleClass } from '../viewer/SessionHeader.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { DiffView } from './DiffView.tsx';
import { RefChip } from './RefChip.tsx';
import { useGitAction } from './useGitAction.ts';

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
/**
 * What you can do from a commit. Reset is the only destructive one and it
 * carries its own confirmation, spelling out what a hard reset takes with it —
 * the modes differ in exactly that, and the difference is the whole decision.
 */
function CommitActions({ repoId, sha, status }: { repoId: string; sha: string; status: GitStatus | undefined }) {
  const action = useGitAction(repoId);
  const [branching, setBranching] = useState(false);
  const [name, setName] = useState('');
  const [resetting, setResetting] = useState<'soft' | 'mixed' | 'hard' | null>(null);
  const short = sha.slice(0, 7);
  const dirty = (status?.entries.length ?? 0) > 0;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className={btn}
        disabled={action.busy || !!status?.blocked.checkout}
        title={status?.blocked.checkout ?? `Check out ${short} (this detaches HEAD)`}
        onClick={() => void action.run(() => gitApi.checkout(repoId, { ref: sha }))}
      >
        Check out
      </button>
      <button type="button" className={btn} disabled={action.busy} onClick={() => setBranching(true)}>
        Branch here
      </button>
      <button
        type="button"
        className={btn}
        disabled={action.busy || !!status?.blocked.reset}
        title={status?.blocked.reset ?? `Move ${status?.branch ?? 'HEAD'} to ${short}`}
        onClick={() => setResetting('mixed')}
      >
        Reset here…
      </button>
      {action.error && <span className="text-[11px] text-red-300">{action.error}</span>}

      {branching && (
        <span className="flex items-center gap-1.5">
          <input
            autoFocus
            type="text"
            spellCheck={false}
            value={name}
            placeholder="feature/from-here"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setBranching(false);
                setName('');
              }
              if (e.key === 'Enter' && name.trim()) {
                const branch = name.trim();
                setBranching(false);
                setName('');
                void action.run(() => gitApi.branchCreate(repoId, { name: branch, from: sha, checkout: true }));
              }
            }}
            className={`${inputClass} w-56 font-mono text-[11px]`}
          />
          <span className="text-[10px] text-[var(--text-dim)]">Enter creates it from {short}</span>
        </span>
      )}

      {resetting && (
        <ConfirmDialog
          title={`Reset to ${short}`}
          body={
            <>
              <p>
                <span className="font-mono">soft</span> keeps everything staged,{' '}
                <span className="font-mono">mixed</span> keeps your files but unstages them, and{' '}
                <span className="font-mono">hard</span> throws away every change in the working tree.
              </p>
              {dirty && (
                <p className="mt-1 text-amber-400">
                  There {status?.entries.length === 1 ? 'is' : 'are'} {status?.entries.length} uncommitted change
                  {status?.entries.length === 1 ? '' : 's'} right now — a hard reset would take{' '}
                  {status?.entries.length === 1 ? 'it' : 'them'} with it.
                </p>
              )}
              <div className="mt-2 flex gap-1.5">
                {(['soft', 'mixed', 'hard'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setResetting(mode)}
                    className={resetting === mode ? toggleClass(true) : toggleClass(false)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </>
          }
          command={`git reset --${resetting} ${short}`}
          requireTyped={resetting === 'hard' && dirty ? short : undefined}
          confirmLabel={`Reset --${resetting}`}
          busy={action.busy}
          onCancel={() => setResetting(null)}
          onConfirm={() => {
            const mode = resetting;
            setResetting(null);
            void action.run(() => gitApi.reset(repoId, { sha, mode, confirm: true }));
          }}
        />
      )}
    </div>
  );
}

export function CommitDetail({
  repoId,
  sha,
  status,
  selectedPath,
  onSelectPath,
}: {
  repoId: string;
  sha: string;
  status: GitStatus | undefined;
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

        <CommitActions repoId={repoId} sha={commit.sha} status={status} />

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
