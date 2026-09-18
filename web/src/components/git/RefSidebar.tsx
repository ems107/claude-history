import {
  DEFAULT_SETTINGS,
  GIT_MERGE_MODES,
  type GitBranch,
  type GitBranchesResponse,
  type GitMergeMode,
  type GitStash,
  type GitStatus,
  type GitTag,
  type GitWorktree,
} from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../../api/client.ts';
import { gitApi } from '../../api/git.ts';
import { relativeTime } from '../../lib/format.ts';
import { useBackDismiss, useIsMobile } from '../../lib/mobile.ts';
import { actionClass, inputClass } from '../controlClass.ts';
import { FoldHeader } from '../FoldHeader.tsx';
import { Sheet } from '../Sheet.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { type SplitOption } from './SplitButton.tsx';
import { ACT_CLASS, RowActions, rowClass } from './RowActions.tsx';
import { useGitAction } from './useGitAction.ts';

/**
 * Branches, remotes, tags, stashes and worktrees, each in a section that folds.
 *
 * The fold state is per section and lives in localStorage, because it is about
 * how the reader wants the page laid out and not about what is being shown —
 * the same line the search panel draws between the URL and local preferences.
 */
function useFold(key: string, initial: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(`git.fold.${key}`);
    return stored === null ? initial : stored === '1';
  });
  return [
    open,
    () => {
      setOpen((prev) => {
        localStorage.setItem(`git.fold.${key}`, prev ? '0' : '1');
        return !prev;
      });
    },
  ];
}

function Section({
  id,
  title,
  count,
  initial = true,
  actions,
  children,
}: {
  id: string;
  title: string;
  count: number;
  initial?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, toggle] = useFold(id, initial);
  return (
    <div className="border-b border-[var(--border)] pb-1">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <FoldHeader
          open={open}
          onToggle={toggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] tracking-wider text-[var(--text-dim)] uppercase hover:text-[var(--text)]"
        >
          <span className="w-2">{open ? '▾' : '▸'}</span>
          <span>{title}</span>
          <span className="ml-auto tabular-nums">{count}</span>
        </FoldHeader>
        {/* A sibling: nothing interactive may live inside a FoldHeader. */}
        {actions}
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-[11px] text-[var(--text-dim)] italic">{children}</p>;
}

export function RefSidebar({
  repoId,
  status,
  branches,
  tags,
  stashes,
  worktrees,
  selectedRef,
  onSelectRef,
}: {
  repoId: string | null;
  status: GitStatus | undefined;
  branches: GitBranchesResponse | undefined;
  tags: GitTag[] | undefined;
  stashes: GitStash[] | undefined;
  worktrees: GitWorktree[] | undefined;
  selectedRef: string | null;
  onSelectRef: (ref: string | null) => void;
}) {
  const action = useGitAction(repoId);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<GitBranch | null>(null);
  const [tagging, setTagging] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const [deletingTag, setDeletingTag] = useState<GitTag | null>(null);
  const [droppingStash, setDroppingStash] = useState<GitStash | null>(null);
  const [addingWorktree, setAddingWorktree] = useState(false);
  const [worktreePath, setWorktreePath] = useState('');
  const [removingWorktree, setRemovingWorktree] = useState<GitWorktree | null>(null);

  const local = branches?.local ?? [];
  const remote = branches?.remote ?? [];
  // Which merge the glyph runs. The server reads the same setting when the
  // request names no mode, so the label and the command cannot disagree.
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const mergeDefault = settings.data?.settings.gitMergeDefault ?? DEFAULT_SETTINGS.gitMergeDefault;

  const run = (work: () => Promise<unknown>): void => {
    if (!repoId) return;
    void action.run(work as () => Promise<never>);
  };
  const checkout = (ref: string) => run(() => gitApi.checkout(repoId as string, { ref }));
  const merge = (ref: string, mode?: GitMergeMode) => run(() => gitApi.merge(repoId as string, { ref, mode }));

  // The three ways to merge, next to the branch rather than in a dialog. The
  // glyph runs the configured one — the server picks the same one when the
  // request names none — and the caret beside it offers the others.
  const mergeOptions = (name: string): SplitOption[] => [
    {
      key: GIT_MERGE_MODES[0],
      label: `Merge ${name}`,
      command: `git merge --no-edit ${name}`,
      hint: 'Moves the pointer when it can, and leaves a merge commit only when the two sides really diverged.',
      blocked: status?.blocked.merge ?? null,
      run: () => merge(name, 'ff'),
    },
    {
      key: 'no-ff',
      label: `Merge ${name}, always with a commit`,
      command: `git merge --no-ff --no-edit ${name}`,
      hint: 'The branch stays visible in the graph for ever, at the cost of a commit each time.',
      blocked: status?.blocked.merge ?? null,
      run: () => merge(name, 'no-ff'),
    },
    {
      key: 'squash',
      label: `Squash ${name} into the index`,
      command: `git merge --squash ${name}`,
      hint: 'Stages the whole result as your own change and commits nothing — the branch is not recorded as merged.',
      blocked: status?.blocked.merge ?? null,
      run: () => merge(name, 'squash'),
    },
  ];

  // Remote branches grouped by their remote, which is how anyone reads them.
  const byRemote = new Map<string, typeof remote>();
  for (const branch of remote) {
    const group = byRemote.get(branch.remote);
    if (group) group.push(branch);
    else byRemote.set(branch.remote, [branch]);
  }

  const pick = (ref: string) => onSelectRef(selectedRef === ref ? null : ref);

  return (
    <div className="h-full overflow-y-auto text-xs">
      <Section
        id="branches"
        title="Branches"
        count={local.length}
        actions={
          repoId && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              title="Create a branch here"
              className="shrink-0 cursor-pointer px-1 text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              + new
            </button>
          )
        }
      >
        {creating && (
          <div className="px-2 py-1">
            <input
              autoFocus
              type="text"
              spellCheck={false}
              value={newName}
              placeholder="feature/something"
              onChange={(e) => setNewName(e.target.value)}
              className={`${inputClass} font-mono text-[11px]`}
            />
            <div className="mt-1 flex items-center gap-1.5">
              <button
                type="button"
                disabled={!newName.trim() || action.busy || !repoId}
                onClick={() => {
                  const name = newName.trim();
                  setCreating(false);
                  setNewName('');
                  if (repoId) run(() => gitApi.branchCreate(repoId, { name, checkout: true }));
                }}
                className={actionClass}
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                }}
                className={actionClass}
              >
                Cancel
              </button>
              <span className="text-[10px] text-[var(--text-dim)]">from HEAD, and checks it out</span>
            </div>
          </div>
        )}
        {local.length === 0 && <Empty>No local branches.</Empty>}
        {local.map((branch) => (
          <div
            key={branch.fullRef}
            className={`group ${rowClass} ${selectedRef === branch.name ? 'bg-[var(--bg-hover)]' : ''}`}
          >
            <button
              type="button"
              onClick={() => pick(branch.name)}
              title={
                branch.worktreePath
                  ? `Checked out in another worktree: ${branch.worktreePath}`
                  : (branch.lastSubject ?? branch.name)
              }
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
            >
              <span className={`w-2 shrink-0 ${branch.current ? 'text-[var(--accent)]' : 'text-transparent'}`}>●</span>
              <span
                className={`min-w-0 flex-1 truncate ${
                  branch.current ? 'font-semibold text-[var(--text)]' : 'text-[var(--text)]/85'
                }`}
              >
                {branch.name}
              </span>
              {branch.upstreamGone && (
                <span className="shrink-0 text-[10px] text-amber-400" title="Its upstream no longer exists">
                  gone
                </span>
              )}
              {(branch.ahead > 0 || branch.behind > 0) && (
                <span
                  className="shrink-0 tabular-nums text-[10px] text-[var(--text-dim)]"
                  title={`${branch.ahead} ahead, ${branch.behind} behind ${branch.upstream ?? 'its upstream'}`}
                >
                  {branch.ahead > 0 && `↑${branch.ahead}`}
                  {branch.behind > 0 && `↓${branch.behind}`}
                </span>
              )}
              {branch.worktreePath && (
                <span className="shrink-0 text-[10px] text-sky-300" title={branch.worktreePath}>
                  wt
                </span>
              )}
            </button>
            {!branch.current && repoId && (
              <RowActions
                name={branch.name}
                say={action.say}
                actions={[
                  {
                    label: '→',
                    words: `Check out ${branch.name}`,
                    hint: 'Move HEAD here; what you have changed comes with you',
                    disabled: action.busy || !!branch.worktreePath || !!status?.blocked.checkout,
                    reason: branch.worktreePath
                      ? `It is checked out in ${branch.worktreePath}`
                      : status?.blocked.checkout,
                    run: () => checkout(branch.name),
                  },
                  {
                    label: '⇥',
                    words: `Merge ${branch.name} into ${status?.branch ?? 'HEAD'}`,
                    hint: 'The way your settings say',
                    disabled: action.busy || !!status?.blocked.merge,
                    reason: status?.blocked.merge,
                    coveredByMenu: true,
                    run: () => merge(branch.name),
                  },
                  {
                    label: '▾',
                    words: 'The other ways to merge it',
                    disabled: action.busy,
                    menu: { options: mergeOptions(branch.name), mainKey: mergeDefault },
                  },
                  {
                    label: '✕',
                    words: `Delete ${branch.name}`,
                    hint: 'Asks first',
                    danger: true,
                    run: () => setDeleting(branch),
                  },
                ]}
              />
            )}
          </div>
        ))}
      </Section>

      <Section id="remotes" title="Remotes" count={remote.length} initial={false}>
        {remote.length === 0 && <Empty>No remote branches.</Empty>}
        {[...byRemote.entries()].map(([name, group]) => (
          <div key={name}>
            <p className="px-2 pt-1 text-[10px] tracking-wide text-[var(--text-dim)]">{name}</p>
            {group.map((branch) => (
              <div
                key={branch.fullRef}
                className={`group ${rowClass} pl-4 ${
                  selectedRef === `${branch.remote}/${branch.name}` ? 'bg-[var(--bg-hover)]' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => pick(`${branch.remote}/${branch.name}`)}
                  title={`${branch.remote}/${branch.name}`}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-sky-300/85">{branch.name}</span>
                  {branch.localMissing && (
                    <span className="shrink-0 text-[10px] text-[var(--text-dim)]" title="No local branch of this name">
                      remote only
                    </span>
                  )}
                </button>
                {branch.localMissing && repoId && (
                  <RowActions
                    name={`${branch.remote}/${branch.name}`}
                    say={action.say}
                    actions={[
                      {
                        label: '→',
                        words: `Create a local ${branch.name}`,
                        hint: `Tracking ${branch.remote}/${branch.name}`,
                        disabled: action.busy || !!status?.blocked.checkout,
                        reason: status?.blocked.checkout,
                        run: () => checkout(branch.name),
                      },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </Section>

      <Section
        id="tags"
        title="Tags"
        count={tags?.length ?? 0}
        initial={false}
        actions={
          repoId && (
            <button
              type="button"
              onClick={() => setTagging(true)}
              className="shrink-0 cursor-pointer px-1 text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              + new
            </button>
          )
        }
      >
        {tagging && repoId && (
          <div className="px-2 py-1">
            <input
              autoFocus
              type="text"
              spellCheck={false}
              value={tagName}
              placeholder="v1.2.3"
              onChange={(e) => setTagName(e.target.value)}
              className={`${inputClass} font-mono text-[11px]`}
            />
            <input
              type="text"
              spellCheck={false}
              value={tagMessage}
              placeholder="Message (optional — makes it annotated)"
              onChange={(e) => setTagMessage(e.target.value)}
              className={`${inputClass} mt-1 text-[11px]`}
            />
            <div className="mt-1 flex gap-1.5">
              <button
                type="button"
                disabled={!tagName.trim() || action.busy}
                className={actionClass}
                onClick={() => {
                  const name = tagName.trim();
                  const message = tagMessage.trim();
                  setTagging(false);
                  setTagName('');
                  setTagMessage('');
                  run(() => gitApi.tagCreate(repoId, { name, message: message || undefined }));
                }}
              >
                Create at HEAD
              </button>
              <button
                type="button"
                className={actionClass}
                onClick={() => {
                  setTagging(false);
                  setTagName('');
                  setTagMessage('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {(tags?.length ?? 0) === 0 && <Empty>No tags.</Empty>}
        {tags?.map((tag) => (
          <div key={tag.name} className={`group ${rowClass} ${selectedRef === tag.name ? 'bg-[var(--bg-hover)]' : ''}`}>
            <button
              type="button"
              onClick={() => pick(tag.name)}
              title={tag.subject ?? tag.name}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-amber-400/90">{tag.name}</span>
              {tag.annotated && (
                <span className="shrink-0 text-[10px] text-[var(--text-dim)]" title="Annotated tag">
                  a
                </span>
              )}
              {tag.at && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{relativeTime(tag.at)}</span>}
            </button>
            {repoId && (
              <RowActions
                name={tag.name}
                say={action.say}
                actions={[
                  {
                    label: '↑',
                    words: `Publish ${tag.name} to the remote`,
                    hint: 'git push <remote> ' + tag.name,
                    disabled: action.busy,
                    run: () => run(() => gitApi.pushTag(repoId, { name: tag.name })),
                  },
                  {
                    label: '✕',
                    words: `Delete ${tag.name}`,
                    hint: 'Here only, not on the remote. Asks first',
                    danger: true,
                    run: () => setDeletingTag(tag),
                  },
                ]}
              />
            )}
          </div>
        ))}
      </Section>

      <Section
        id="stashes"
        title="Stashes"
        count={stashes?.length ?? 0}
        initial={false}
        actions={
          repoId && (
            <button
              type="button"
              disabled={action.busy || !!status?.blocked.stash}
              title={status?.blocked.stash ?? 'Put everything aside and clean the tree'}
              onClick={() => run(() => gitApi.stash(repoId, { includeUntracked: true }))}
              className="shrink-0 cursor-pointer px-1 text-[10px] text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30"
            >
              + stash all
            </button>
          )
        }
      >
        {(stashes?.length ?? 0) === 0 && <Empty>No stashes.</Empty>}
        {stashes?.map((stash) => (
          <div key={stash.ref} className={`group ${rowClass}`} title={`${stash.ref} on ${stash.branch ?? '?'}`}>
            <span className="shrink-0 font-mono text-[10px] text-purple-400">{stash.index}</span>
            <span className="min-w-0 flex-1 truncate">{stash.message}</span>
            <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{relativeTime(stash.at)}</span>
            {repoId && (
              <RowActions
                name={stash.message || `stash@{${stash.index}}`}
                say={action.say}
                actions={[
                  {
                    label: '↓',
                    words: 'Apply it, and keep it in the list',
                    hint: 'git stash apply',
                    disabled: action.busy,
                    run: () => run(() => gitApi.stashAction(repoId, 'apply', { index: stash.index })),
                  },
                  {
                    label: '⤓',
                    words: 'Apply it and take it off the list',
                    hint: 'git stash pop',
                    disabled: action.busy,
                    run: () => run(() => gitApi.stashAction(repoId, 'pop', { index: stash.index })),
                  },
                  {
                    label: '✕',
                    words: 'Throw it away',
                    hint: 'Asks first: a dropped stash is not in any commit',
                    danger: true,
                    run: () => setDroppingStash(stash),
                  },
                ]}
              />
            )}
          </div>
        ))}
      </Section>

      <Section
        id="worktrees"
        title="Worktrees"
        count={worktrees?.length ?? 0}
        initial={false}
        actions={
          repoId && (
            <button
              type="button"
              onClick={() => setAddingWorktree(true)}
              className="shrink-0 cursor-pointer px-1 text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              + new
            </button>
          )
        }
      >
        {addingWorktree && repoId && (
          <div className="px-2 py-1">
            <input
              autoFocus
              type="text"
              spellCheck={false}
              value={worktreePath}
              placeholder="C:\Users\you\Git\project-feature"
              onChange={(e) => setWorktreePath(e.target.value)}
              className={`${inputClass} font-mono text-[11px]`}
            />
            <p className="mt-0.5 text-[10px] text-[var(--text-dim)]">
              A second working tree of this repository, checked out at{' '}
              <span className="font-mono">{selectedRef ?? 'HEAD'}</span>. The folder must not exist yet.
            </p>
            <div className="mt-1 flex gap-1.5">
              <button
                type="button"
                disabled={!worktreePath.trim() || action.busy}
                className={actionClass}
                onClick={() => {
                  const target = worktreePath.trim();
                  setAddingWorktree(false);
                  setWorktreePath('');
                  run(() => gitApi.worktreeAdd(repoId, { path: target, ref: selectedRef ?? 'HEAD' }));
                }}
              >
                Add
              </button>
              <button
                type="button"
                className={actionClass}
                onClick={() => {
                  setAddingWorktree(false);
                  setWorktreePath('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {(worktrees?.length ?? 0) === 0 && <Empty>No worktrees.</Empty>}
        {worktrees?.map((wt) => (
          <div key={wt.path} className={`group ${rowClass}`} title={wt.path}>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{wt.path}</span>
            {wt.branch && (
              <span className="shrink-0 text-[10px] text-[var(--accent)]">
                {wt.branch.replace(/^refs\/heads\//, '')}
              </span>
            )}
            {wt.isMain && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">main</span>}
            {wt.locked && <span className="shrink-0 text-[10px] text-amber-400">locked</span>}
            {repoId && !wt.isMain && (
              <RowActions
                name={wt.path}
                say={action.say}
                actions={[
                  {
                    label: '✕',
                    words: 'Remove this worktree',
                    hint: 'Asks first. The folder goes with it',
                    danger: true,
                    run: () => setRemovingWorktree(wt),
                  },
                ]}
              />
            )}
          </div>
        ))}
      </Section>

      {action.error && (
        <p className="m-2 rounded border border-red-500/40 bg-red-500/10 p-1.5 text-[11px] text-red-300">
          {action.error}
        </p>
      )}
      {action.note && <p className="m-2 text-[11px] text-emerald-400">{action.note}</p>}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}`}
          body={
            <>
              {deleting.ahead > 0 || !deleting.upstream ? (
                <>
                  This branch has work that may exist nowhere else. Deleting it leaves{' '}
                  <span className="font-mono">{deleting.sha.slice(0, 7)}</span> unreachable, and git will not offer it
                  back.
                </>
              ) : (
                <>Its commits are on {deleting.upstream}, so nothing is lost by deleting the local branch.</>
              )}
            </>
          }
          command={`git branch -D -- ${deleting.name}`}
          requireTyped={deleting.ahead > 0 || !deleting.upstream ? deleting.name : undefined}
          confirmLabel="Delete"
          busy={action.busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const name = deleting.name;
            setDeleting(null);
            if (repoId) run(() => gitApi.branchDelete(repoId, { name, force: true, confirm: true }));
          }}
        />
      )}

      {deletingTag && repoId && (
        <ConfirmDialog
          title={`Delete the tag ${deletingTag.name}`}
          body={
            <>
              This removes it here only. If it has been published, the remote still has it — deleting it there is a
              separate act.
            </>
          }
          command={`git tag -d ${deletingTag.name}`}
          confirmLabel="Delete"
          busy={action.busy}
          onCancel={() => setDeletingTag(null)}
          onConfirm={() => {
            const name = deletingTag.name;
            setDeletingTag(null);
            run(() => gitApi.tagDelete(repoId, { name, confirm: true }));
          }}
        />
      )}

      {droppingStash && repoId && (
        <ConfirmDialog
          title="Throw this stash away"
          body={
            <>
              <span className="font-mono">{droppingStash.message}</span> — stashed{' '}
              {relativeTime(droppingStash.at)}. Nothing in this app can bring it back, and it is not on any branch.
            </>
          }
          command={`git stash drop ${droppingStash.ref}`}
          confirmLabel="Drop"
          busy={action.busy}
          onCancel={() => setDroppingStash(null)}
          onConfirm={() => {
            const index = droppingStash.index;
            setDroppingStash(null);
            run(() => gitApi.stashAction(repoId, 'drop', { index, confirm: true }));
          }}
        />
      )}

      {removingWorktree && repoId && (
        <ConfirmDialog
          title="Remove this worktree"
          body={
            <>
              The folder <span className="font-mono">{removingWorktree.path}</span> is deleted. Commits made in it stay
              in the repository — anything uncommitted there does not.
            </>
          }
          command={`git worktree remove ${removingWorktree.path}`}
          confirmLabel="Remove"
          busy={action.busy}
          onCancel={() => setRemovingWorktree(null)}
          onConfirm={() => {
            const target = removingWorktree.path;
            setRemovingWorktree(null);
            run(() => gitApi.worktreeRemove(repoId, { path: target, force: true, confirm: true }));
          }}
        />
      )}
    </div>
  );
}
