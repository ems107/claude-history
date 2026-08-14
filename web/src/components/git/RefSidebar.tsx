import type { GitBranch, GitBranchesResponse, GitStash, GitStatus, GitTag, GitWorktree } from '@claude-history/shared';
import { useState, type ReactNode } from 'react';
import { gitApi } from '../../api/git.ts';
import { relativeTime } from '../../lib/format.ts';
import { inputClass } from '../../lib/ui.ts';
import { FoldHeader } from '../viewer/FoldHeader.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
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

/**
 * One hover action on a ref row. It always carries a title, and when it is
 * disabled that title is the server's reason rather than the action's name —
 * a dead control that cannot say why is the bug this whole pattern avoids.
 */
function Act({
  label,
  title,
  onClick,
  disabled,
  reason,
  danger,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  reason?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? (reason ?? title) : title}
      className={`cursor-pointer px-1 text-[11px] ${
        danger ? 'text-[var(--text-dim)] hover:text-red-300' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
      } disabled:cursor-default disabled:opacity-30`}
    >
      {label}
    </button>
  );
}

const rowClass =
  'flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-[11px] hover:bg-[var(--bg-hover)]/60';

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

  const local = branches?.local ?? [];
  const remote = branches?.remote ?? [];

  const run = (work: () => Promise<unknown>): void => {
    if (!repoId) return;
    void action.run(work as () => Promise<never>);
  };
  const checkout = (ref: string) => run(() => gitApi.checkout(repoId as string, { ref }));
  const merge = (ref: string) => run(() => gitApi.merge(repoId as string, { ref }));

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
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setCreating(false);
                  setNewName('');
                }
                if (e.key === 'Enter' && newName.trim() && repoId) {
                  const name = newName.trim();
                  setCreating(false);
                  setNewName('');
                  run(() => gitApi.branchCreate(repoId, { name, checkout: true }));
                }
              }}
              className={`${inputClass} font-mono text-[11px]`}
            />
            <p className="mt-0.5 text-[10px] text-[var(--text-dim)]">
              Enter creates it from HEAD and checks it out. Escape cancels.
            </p>
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
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                <Act
                  label="→"
                  title={branch.worktreePath ? `Checked out in ${branch.worktreePath}` : `Check out ${branch.name}`}
                  disabled={action.busy || !!branch.worktreePath || !!status?.blocked.checkout}
                  reason={status?.blocked.checkout}
                  onClick={() => checkout(branch.name)}
                />
                <Act
                  label="⇥"
                  title={`Merge ${branch.name} into ${status?.branch ?? 'HEAD'}`}
                  disabled={action.busy || !!status?.blocked.merge}
                  reason={status?.blocked.merge}
                  onClick={() => merge(branch.name)}
                />
                <Act label="✕" title={`Delete ${branch.name}`} danger onClick={() => setDeleting(branch)} />
              </span>
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
              <button
                key={branch.fullRef}
                type="button"
                onClick={() => pick(`${branch.remote}/${branch.name}`)}
                onDoubleClick={() => branch.localMissing && checkout(branch.name)}
                title={
                  branch.localMissing
                    ? `Double-click to create a local ${branch.name} tracking ${branch.remote}/${branch.name}`
                    : `${branch.remote}/${branch.name}`
                }
                className={`${rowClass} cursor-pointer pl-4 ${
                  selectedRef === `${branch.remote}/${branch.name}` ? 'bg-[var(--bg-hover)]' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sky-300/85">{branch.name}</span>
                {branch.localMissing && (
                  <span className="shrink-0 text-[10px] text-[var(--text-dim)]" title="No local branch of this name">
                    remote only
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </Section>

      <Section id="tags" title="Tags" count={tags?.length ?? 0} initial={false}>
        {(tags?.length ?? 0) === 0 && <Empty>No tags.</Empty>}
        {tags?.map((tag) => (
          <button
            key={tag.name}
            type="button"
            onClick={() => pick(tag.name)}
            title={tag.subject ?? tag.name}
            className={`${rowClass} cursor-pointer ${selectedRef === tag.name ? 'bg-[var(--bg-hover)]' : ''}`}
          >
            <span className="min-w-0 flex-1 truncate text-amber-400/90">{tag.name}</span>
            {tag.annotated && (
              <span className="shrink-0 text-[10px] text-[var(--text-dim)]" title="Annotated tag">
                a
              </span>
            )}
            {tag.at && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{relativeTime(tag.at)}</span>}
          </button>
        ))}
      </Section>

      <Section id="stashes" title="Stashes" count={stashes?.length ?? 0} initial={false}>
        {(stashes?.length ?? 0) === 0 && <Empty>No stashes.</Empty>}
        {stashes?.map((stash) => (
          <div key={stash.ref} className={rowClass} title={`${stash.ref} on ${stash.branch ?? '?'}`}>
            <span className="shrink-0 font-mono text-[10px] text-purple-400">{stash.index}</span>
            <span className="min-w-0 flex-1 truncate">{stash.message}</span>
            <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{relativeTime(stash.at)}</span>
          </div>
        ))}
      </Section>

      <Section id="worktrees" title="Worktrees" count={worktrees?.length ?? 0} initial={false}>
        {(worktrees?.length ?? 0) === 0 && <Empty>No worktrees.</Empty>}
        {worktrees?.map((wt) => (
          <div key={wt.path} className={rowClass} title={wt.path}>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{wt.path}</span>
            {wt.isMain && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">main</span>}
            {wt.locked && <span className="shrink-0 text-[10px] text-amber-400">locked</span>}
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
    </div>
  );
}
