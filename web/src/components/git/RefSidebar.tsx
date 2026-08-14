import type { GitBranchesResponse, GitStash, GitTag, GitWorktree } from '@claude-history/shared';
import { useState, type ReactNode } from 'react';
import { relativeTime } from '../../lib/format.ts';
import { FoldHeader } from '../viewer/FoldHeader.tsx';

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
  children,
}: {
  id: string;
  title: string;
  count: number;
  initial?: boolean;
  children: ReactNode;
}) {
  const [open, toggle] = useFold(id, initial);
  return (
    <div className="border-b border-[var(--border)] pb-1">
      <FoldHeader
        open={open}
        onToggle={toggle}
        className="flex items-center gap-1.5 px-2 py-1 text-[11px] tracking-wider text-[var(--text-dim)] uppercase hover:text-[var(--text)]"
      >
        <span className="w-2">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        <span className="ml-auto tabular-nums">{count}</span>
      </FoldHeader>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

const rowClass =
  'flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-[11px] hover:bg-[var(--bg-hover)]/60';

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-[11px] text-[var(--text-dim)] italic">{children}</p>;
}

export function RefSidebar({
  branches,
  tags,
  stashes,
  worktrees,
  selectedRef,
  onSelectRef,
}: {
  branches: GitBranchesResponse | undefined;
  tags: GitTag[] | undefined;
  stashes: GitStash[] | undefined;
  worktrees: GitWorktree[] | undefined;
  selectedRef: string | null;
  onSelectRef: (ref: string | null) => void;
}) {
  const local = branches?.local ?? [];
  const remote = branches?.remote ?? [];

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
      <Section id="branches" title="Branches" count={local.length}>
        {local.length === 0 && <Empty>No local branches.</Empty>}
        {local.map((branch) => (
          <button
            key={branch.fullRef}
            type="button"
            onClick={() => pick(branch.name)}
            title={
              branch.worktreePath
                ? `Checked out in another worktree: ${branch.worktreePath}`
                : (branch.lastSubject ?? branch.name)
            }
            className={`${rowClass} cursor-pointer ${selectedRef === branch.name ? 'bg-[var(--bg-hover)]' : ''}`}
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
    </div>
  );
}
