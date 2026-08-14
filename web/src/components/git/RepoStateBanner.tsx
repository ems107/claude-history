import type { GitStatus } from '@claude-history/shared';
import { useState } from 'react';
import { gitApi } from '../../api/git.ts';
import { btn } from '../../lib/ui.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { useGitAction } from './useGitAction.ts';

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
 * What the repository is in the middle of, and the way out of it.
 *
 * Continue is disabled while anything is still conflicted, and it shows the
 * server's own reason — which counts the files. That is the whole point of the
 * message: somebody stopped here needs to be told what to do, not merely
 * stopped. Conflicts are resolved outside this app, so the escape hatch sits
 * right next to the buttons rather than somewhere else in the UI.
 */
export function RepoStateBanner({ repoId, status }: { repoId: string | null; status: GitStatus | undefined }) {
  const action = useGitAction(repoId);
  const [aborting, setAborting] = useState(false);
  const inProgress = status?.inProgress;
  if (!inProgress || !status || !repoId) return null;

  const conflicted = status.entries.filter((e) => e.conflicted).length;
  const step =
    inProgress.step !== null && inProgress.total !== null ? ` — step ${inProgress.step} of ${inProgress.total}` : '';
  const kind = KIND_LABEL[inProgress.kind] ?? inProgress.kind;

  const go = (act: 'continue' | 'abort' | 'skip') => void action.run(() => gitApi.continuation(repoId, act));
  const open = (target: 'terminal' | 'vscode') => void action.run(() => gitApi.open(repoId, target).then(() => undefined));

  return (
    <div className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <p className="text-amber-300">
        ⚠ {kind}
        {inProgress.headName && ` ${inProgress.headName}`}
        {inProgress.ontoSha && ` onto ${inProgress.ontoSha.slice(0, 7)}`}
        {step}
      </p>
      <p className="mt-0.5 text-[11px] text-amber-300/80">
        {conflicted > 0
          ? `${conflicted} file${conflicted === 1 ? '' : 's'} still conflicted. Fix the markers in an editor, then stage them here.`
          : 'Nothing is conflicted right now.'}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {inProgress.kind === 'merge' ? (
          <span className="text-[11px] text-amber-300/80">
            A merge is finished by committing it — use the working tree.
          </span>
        ) : (
          <button
            type="button"
            onClick={() => go('continue')}
            disabled={action.busy || !!status.blocked.continue}
            title={status.blocked.continue ?? 'Carry on from here'}
            className={btn}
          >
            Continue
          </button>
        )}
        {inProgress.canSkip && (
          <button
            type="button"
            onClick={() => go('skip')}
            disabled={action.busy || !!status.blocked.skip}
            title={status.blocked.skip ?? 'Drop this commit and carry on'}
            className={btn}
          >
            Skip this commit
          </button>
        )}
        <button type="button" onClick={() => setAborting(true)} disabled={action.busy} className={btn}>
          Abort…
        </button>
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => open('terminal')} className={btn} title="Open a terminal here">
            ❯ Terminal
          </button>
          <button type="button" onClick={() => open('vscode')} className={btn} title="Open this repository in VS Code">
            {'{ }'} VS Code
          </button>
        </span>
      </div>

      {/* Always visible, not only as a tooltip. */}
      {status.blocked.continue && <p className="mt-1 text-[11px] text-amber-300/80">{status.blocked.continue}</p>}
      {action.error && <p className="mt-1 text-[11px] text-red-300">{action.error}</p>}

      {aborting && (
        <ConfirmDialog
          title={`Abort the ${inProgress.kind}`}
          body={
            <>
              Everything this {inProgress.kind} has done so far is thrown away and the repository goes back to where it
              started. Any conflict resolution you have not committed goes with it.
            </>
          }
          command={`git ${inProgress.kind === 'cherry-pick' ? 'cherry-pick' : inProgress.kind === 'merge' ? 'merge' : inProgress.kind} --abort`}
          confirmLabel="Abort"
          busy={action.busy}
          onCancel={() => setAborting(false)}
          onConfirm={() => {
            setAborting(false);
            go('abort');
          }}
        />
      )}
    </div>
  );
}
