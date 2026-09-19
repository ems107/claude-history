import type { GitCommitFile, GitStatus } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { gitApi } from '../../api/git.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { actionClass, inputClass, segmentClass, segmentedClass, toggleClass } from '../controlClass.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { FileDiffBody } from './DiffView.tsx';
import { RefChip } from './RefChip.tsx';
import { SplitButton, type SplitOption } from './SplitButton.tsx';
import { useGitAction } from './useGitAction.ts';

const STATUS_TONE: Record<string, string> = {
  A: 'text-emerald-400',
  M: 'text-amber-400',
  D: 'text-red-400',
  R: 'text-sky-400',
  C: 'text-sky-400',
  T: 'text-purple-400',
};

const STATUS_WORD: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type changed',
  U: 'unmerged',
};

/**
 * What you can do from a commit. Reset is the only destructive one and it
 * carries its own confirmation, spelling out what a hard reset takes with it —
 * the modes differ in exactly that, and the difference is the whole decision.
 *
 * **Checking out is a split button**, like fetch and pull on the bar above.
 * `git checkout <sha>` detaches HEAD, which is the right default here and a
 * surprise to anybody who has not met it; and when a branch is sitting on this
 * very commit, checking THAT out gives the same files with HEAD still attached,
 * which is almost always what was meant. Both were one button that silently did
 * the first, so the second was reachable only by finding the branch again in
 * another panel. The menu names each one and prints the command it runs.
 */
function CommitActions({
  repoId,
  sha,
  status,
  isMerge,
  refs,
}: {
  repoId: string;
  sha: string;
  status: GitStatus | undefined;
  isMerge: boolean;
  refs: { kind: string; name: string; fullRef: string; isHead: boolean }[];
}) {
  const action = useGitAction(repoId);
  const [branching, setBranching] = useState(false);
  const [name, setName] = useState('');
  const [resetting, setResetting] = useState<'soft' | 'mixed' | 'hard' | null>(null);
  const [rebasing, setRebasing] = useState(false);
  const short = sha.slice(0, 7);
  const dirty = (status?.entries.length ?? 0) > 0;

  // A local branch whose tip IS this commit, and which is not the one we are
  // standing on — checking out the branch you are already on is not an option,
  // it is a no-op with a confirmation dialog's worth of ceremony.
  const branchesHere = refs.filter((r) => r.kind === 'branch' && !r.isHead);
  const checkoutOptions: SplitOption[] = [
    {
      key: 'commit',
      label: `Check out ${short} itself`,
      command: `git checkout ${short}`,
      hint: 'Detaches HEAD: these are the files, and you are on no branch until you switch to one.',
      blocked: status?.blocked.checkout ?? null,
      run: () => void action.run(() => gitApi.checkout(repoId, { ref: sha })),
    },
    ...branchesHere.map((ref) => ({
      key: `branch:${ref.fullRef}`,
      label: `Check out ${ref.name}`,
      command: `git checkout ${ref.name}`,
      hint: 'A branch at this very commit — the same files, and HEAD stays attached to it.',
      short: ref.name,
      blocked: status?.blocked.checkout ?? null,
      run: () => void action.run(() => gitApi.checkout(repoId, { ref: ref.name })),
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 max-md:gap-2">
      <SplitButton
        label="Check out"
        busy={action.busy}
        defaultKey="commit"
        options={checkoutOptions}
        title={branchesHere.length > 0 ? 'This commit, or a branch standing on it' : 'Move HEAD to this commit'}
      />
      <button type="button" className={actionClass} disabled={action.busy} onClick={() => setBranching(true)}>
        Branch here
      </button>
      <button
        type="button"
        className={actionClass}
        disabled={action.busy || !!status?.blocked.cherryPick}
        title={status?.blocked.cherryPick ?? `Copy ${short} onto ${status?.branch ?? 'HEAD'}`}
        onClick={() => void action.run(() => gitApi.cherryPick(repoId, { shas: [sha], mainline: isMerge ? 1 : undefined }))}
      >
        Cherry-pick
      </button>
      <button
        type="button"
        className={actionClass}
        disabled={action.busy || !!status?.blocked.revert}
        title={status?.blocked.revert ?? `Add a commit undoing ${short}`}
        onClick={() => void action.run(() => gitApi.revert(repoId, { shas: [sha], mainline: isMerge ? 1 : undefined }))}
      >
        Revert
      </button>
      <button
        type="button"
        className={actionClass}
        disabled={action.busy || !!status?.blocked.rebase}
        title={status?.blocked.rebase ?? `Replay ${status?.branch ?? 'HEAD'} on top of ${short}`}
        onClick={() => setRebasing(true)}
      >
        Rebase onto…
      </button>
      <button
        type="button"
        className={actionClass}
        disabled={action.busy || !!status?.blocked.reset}
        title={status?.blocked.reset ?? `Move ${status?.branch ?? 'HEAD'} to ${short}`}
        onClick={() => setResetting('mixed')}
      >
        Reset here…
      </button>
      {action.error && <span className="w-full text-[11px] text-red-300">{action.error}</span>}
      {action.note && <span className="w-full truncate text-[11px] text-emerald-400">{action.note.split('\n')[0]}</span>}

      {rebasing && (
        <ConfirmDialog
          title={`Rebase ${status?.branch ?? 'HEAD'} onto ${short}`}
          body={
            <>
              Every commit on {status?.branch ?? 'this branch'} that is not already on {short} is replayed on top of
              it, as a NEW commit each. The old ones stay reachable only through the reflog, and anyone who has pulled
              this branch will have to reconcile.
              {isMerge && <p className="mt-1 text-amber-400">This is a merge commit, which makes it an unusual base.</p>}
            </>
          }
          command={`git rebase ${short}`}
          confirmLabel="Rebase"
          busy={action.busy}
          onCancel={() => setRebasing(false)}
          onConfirm={() => {
            setRebasing(false);
            void action.run(() => gitApi.rebase(repoId, { onto: sha }));
          }}
        />
      )}

      {branching && (
        <span className="flex w-full items-center gap-1.5 max-md:flex-wrap">
          <input
            autoFocus
            type="text"
            spellCheck={false}
            value={name}
            placeholder="feature/from-here"
            onChange={(e) => setName(e.target.value)}
            className={`${inputClass} w-56 font-mono text-[11px] max-md:min-h-10 max-md:w-full max-md:min-w-0 max-md:text-sm`}
          />
          <button
            type="button"
            className={actionClass}
            disabled={!name.trim() || action.busy}
            onClick={() => {
              const branch = name.trim();
              setBranching(false);
              setName('');
              void action.run(() => gitApi.branchCreate(repoId, { name: branch, from: sha, checkout: true }));
            }}
          >
            Create from {short}
          </button>
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              setBranching(false);
              setName('');
            }}
          >
            Cancel
          </button>
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

/**
 * One changed file, closed — and its diff only once somebody opens it.
 *
 * This list used to be drawn twice: a strip of path chips that filtered the
 * diff, and under it the diff itself with a fold header per file saying the
 * same paths again. Two controls for one idea, and on a phone the strip alone
 * was most of the screen. What is left is the fold headers, which are the ones
 * that can show a diff without throwing the others away.
 *
 * **Closed by default and fetched on opening**, which is the other half of it:
 * the whole commit's diff was being read to draw a list of file names, and a
 * commit that touches forty files is forty diffs nobody asked for.
 *
 * The path goes over two lines — the name, then the folder under it in a dimmer
 * colour, ellipsised at the START, because the front of a path is the half you
 * can guess. One line of `src/components/git/CommitDetail.tsx` at 360px is a
 * name you cannot read in the one place it matters.
 */
function CommitFileRow({ repoId, sha, file }: { repoId: string; sha: string; file: GitCommitFile }) {
  const [open, setOpen] = useState(false);
  const cut = file.path.lastIndexOf('/');
  const dir = cut === -1 ? '' : file.path.slice(0, cut);
  const base = cut === -1 ? file.path : file.path.slice(cut + 1);
  const diffQ = useQuery({
    queryKey: ['git', 'diff', repoId, sha, file.path],
    queryFn: () => gitApi.diff(repoId, { mode: 'commit', sha, path: file.path }),
    enabled: open,
  });

  return (
    <div className="overflow-hidden rounded border border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        className="flex w-full cursor-pointer items-center gap-2 bg-[var(--bg-raised)]/60 px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]/60 max-md:min-h-14 max-md:gap-2.5 max-md:px-2.5"
      >
        <span aria-hidden className="w-2 shrink-0 text-[var(--text-dim)]">
          {open ? '▾' : '▸'}
        </span>
        <span
          className={`w-3 shrink-0 text-center font-mono text-xs font-semibold ${STATUS_TONE[file.status] ?? 'text-[var(--text-dim)]'}`}
          title={STATUS_WORD[file.status] ?? file.status}
        >
          {file.status}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs max-md:text-[13px]">{base}</span>
          {(dir || file.origPath) && (
            <span className="truncate-start block max-w-full truncate font-mono text-[10px] text-[var(--text-dim)]">
              {file.origPath ? `${file.origPath} → ${dir || '.'}` : dir}
            </span>
          )}
        </span>
        {file.binary ? (
          <span className="shrink-0 text-[10px] text-[var(--text-dim)]">binary</span>
        ) : (
          file.additions !== null &&
          file.deletions !== null && (
            <span className="shrink-0 tabular-nums text-[10px] max-md:text-[11px]">
              <span className="text-emerald-400">+{file.additions}</span>{' '}
              <span className="text-red-400">−{file.deletions}</span>
            </span>
          )
        )}
      </button>
      {open && (
        <>
          {diffQ.isLoading && <p className="px-2 py-2 text-[11px] text-[var(--text-dim)]">Reading the diff…</p>}
          {diffQ.isError && (
            <p className="px-2 py-2 text-[11px] text-red-400">Could not read it: {String(diffQ.error)}</p>
          )}
          {diffQ.data?.files[0] && <FileDiffBody file={diffQ.data.files[0]} />}
          {diffQ.data && diffQ.data.files.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-[var(--text-dim)]">Nothing to show for this file.</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The selected commit: who wrote it, what it says, and what it touched.
 *
 * **Two tabs, because they are two questions.** The message and the facts
 * around it are one screen; the files are another, and a commit that changes
 * thirty of them used to push everything about the commit itself off the top
 * before you had read the subject. On a phone that was the whole of the first
 * screenful spent on a list you had to scroll past.
 *
 * A merge is shown against its first parent. `git show` prints nothing at all
 * for a merge otherwise, which reads as "this changed no files" — the one
 * thing that is certainly untrue about a merge commit.
 */
export function CommitDetail({
  repoId,
  sha,
  status,
}: {
  repoId: string;
  sha: string;
  status: GitStatus | undefined;
}) {
  const [pane, setPane] = useState<'about' | 'files'>('about');
  const detailQ = useQuery({
    queryKey: ['git', 'commit', repoId, sha],
    queryFn: () => gitApi.commit(repoId, sha),
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
      <span className={segmentedClass}>
        <button type="button" onClick={() => setPane('about')} className={segmentClass(pane === 'about')}>
          Message
        </button>
        <button type="button" onClick={() => setPane('files')} className={segmentClass(pane === 'files')}>
          <span className="truncate">Files</span>
          <span className="shrink-0 rounded bg-[var(--accent)]/20 px-1 text-[10px] tabular-nums text-[var(--accent)]">
            {detail.files.length}
            {detail.truncated ? '+' : ''}
          </span>
        </button>
      </span>

      {pane === 'about' ? (
        <>
          <div className="rounded border border-[var(--border)] bg-[var(--bg-raised)]/40 p-3">
            <p className="text-sm font-medium">{commit.subject}</p>
            {detail.body && (
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-black/30 p-2 text-[11px] whitespace-pre-wrap">
                {detail.body}
              </pre>
            )}
            {commit.refs.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {commit.refs.map((ref) => (
                  <RefChip key={`${ref.kind}:${ref.fullRef}`} kind={ref.kind} name={ref.name} isHead={ref.isHead} />
                ))}
              </div>
            )}
          </div>

          <CommitActions
            repoId={repoId}
            sha={commit.sha}
            status={status}
            isMerge={commit.parents.length > 1}
            refs={commit.refs}
          />

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px] max-md:text-xs">
            <dt className="text-[var(--text-dim)]">Author</dt>
            <dd className="min-w-0 truncate" title={commit.authorEmail}>
              {commit.authorName} ·{' '}
              <span className="text-[var(--text-dim)]" title={formatDateTime(commit.authoredAt)}>
                {relativeTime(commit.authoredAt)}
              </span>
            </dd>
            {/* Only worth saying when it differs — a rebase or an amend is
                exactly when the difference matters. */}
            {(detail.committerName !== commit.authorName || commit.committedAt !== commit.authoredAt) && (
              <>
                <dt className="text-[var(--text-dim)]">Committer</dt>
                <dd className="min-w-0 truncate" title={detail.committerEmail}>
                  {detail.committerName} ·{' '}
                  <span className="text-[var(--text-dim)]" title={formatDateTime(commit.committedAt)}>
                    {relativeTime(commit.committedAt)}
                  </span>
                </dd>
              </>
            )}
            <dt className="text-[var(--text-dim)]">Changed</dt>
            <dd className="tabular-nums">
              {detail.files.length} file{detail.files.length === 1 ? '' : 's'}
              {' · '}
              <span className="text-emerald-400">+{detail.additions}</span>{' '}
              <span className="text-red-400">−{detail.deletions}</span>
              {commit.parents.length > 1 && (
                <span className="text-[var(--text-dim)]"> · against its first parent</span>
              )}
            </dd>
            <dt className="text-[var(--text-dim)]">
              {commit.parents.length === 1 ? 'Parent' : commit.parents.length > 1 ? 'Parents' : 'Root'}
            </dt>
            <dd className="min-w-0 truncate font-mono">
              {commit.parents.length === 0
                ? 'no parent — the first commit'
                : commit.parents.map((p) => p.slice(0, 7)).join(' · ')}
            </dd>
            <dt className="text-[var(--text-dim)]">Sha</dt>
            <dd className="min-w-0">
              <button
                type="button"
                onClick={() => void copyPlain(commit.sha)}
                title="Copy the full sha"
                // `inline-flex items-center` and not a bare button: with a
                // 40px floor and nothing to centre it, the sha sat on the
                // bottom edge of its own box and read as a line below its label.
                className="inline-flex max-w-full cursor-pointer items-center truncate font-mono text-[var(--text-dim)] hover:text-[var(--text)] max-md:min-h-10"
              >
                {commit.sha}
              </button>
            </dd>
          </dl>
        </>
      ) : detail.files.length === 0 ? (
        <p className="text-[11px] text-[var(--text-dim)]">This commit changed no files.</p>
      ) : (
        <div className="space-y-1.5">
          {detail.files.map((file) => (
            <CommitFileRow key={file.path} repoId={repoId} sha={sha} file={file} />
          ))}
          {detail.truncated && (
            <p className="text-[11px] text-amber-400">More files changed than are listed here.</p>
          )}
        </div>
      )}
    </div>
  );
}
