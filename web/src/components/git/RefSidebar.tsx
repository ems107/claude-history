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
import { Fragment, useState, type ReactNode } from 'react';
import { api } from '../../api/client.ts';
import { gitApi } from '../../api/git.ts';
import { relativeTime } from '../../lib/format.ts';
import { groupRefs, type RefNode } from '../../lib/refTree.ts';
import { actionClass, inputClass } from '../controlClass.ts';
import { FoldHeader } from '../FoldHeader.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { CHEVRON, SectionAction } from './SectionAction.tsx';
import { type SplitOption } from './SplitButton.tsx';
import { RowActions, rowClass } from './RowActions.tsx';
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

/**
 * Which branch folders are CLOSED, remembered across visits.
 *
 * The collapsed set rather than the open one, so a folder that did not exist
 * when you last looked — the branch you pushed this morning — arrives open.
 * One key for the lot: a folder name is not worth a localStorage entry each,
 * and the whole point of this state is that it is trivia.
 */
const FOLDERS_KEY = 'git.refFolders';

function useFolders(): { closed: (path: string) => boolean; toggle: (path: string) => void } {
  const [closed, setClosed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(FOLDERS_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  return {
    closed: (path) => closed.has(path),
    toggle: (path) => {
      setClosed((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        try {
          localStorage.setItem(FOLDERS_KEY, JSON.stringify([...next]));
        } catch {
          // A private window with storage off is not a reason to stop folding.
        }
        return next;
      });
    },
  };
}

function Section({
  id,
  title,
  count,
  initial = true,
  forceOpen = false,
  actions,
  children,
}: {
  id: string;
  title: string;
  count: number;
  initial?: boolean;
  /** Filtering opens every section that has a hit: a fold is not an answer. */
  forceOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [folded, toggle] = useFold(id, initial);
  const open = forceOpen || folded;
  return (
    <div className="border-b border-[var(--border)] pb-1">
      <div className="flex items-center gap-1.5 px-2">
        <FoldHeader
          open={open}
          onToggle={toggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase hover:text-[var(--text)] max-md:min-h-10"
        >
          <span aria-hidden className={CHEVRON}>
            {open ? '▾' : '▸'}
          </span>
          <span>{title}</span>
          <span className="ml-auto rounded bg-[var(--bg-hover)] px-1.5 tabular-nums">{count}</span>
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

/** How far in a row sits, by how deep its folder is. */
const indent = (depth: number): number => 8 + depth * 14;

/**
 * A branch list drawn as the tree its slashes already describe.
 *
 * Generic over what a leaf is, because remote branches and tags are the same
 * shape — `origin/edgar/DES-1` and `v1.2.3` both split on the same character —
 * and three copies of a recursive renderer is three places for the indent
 * arithmetic to disagree.
 */
function Tree<T>({
  nodes,
  depth,
  closed,
  toggle,
  leaf,
}: {
  nodes: RefNode<T>[];
  depth: number;
  closed: (path: string) => boolean;
  toggle: (path: string) => void;
  leaf: (item: T, name: string, depth: number) => ReactNode;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'leaf' ? (
          <Fragment key={`l:${node.path}`}>{leaf(node.item, node.name, depth)}</Fragment>
        ) : (
          <Fragment key={`f:${node.path}`}>
            <button
              type="button"
              onClick={() => toggle(node.path)}
              aria-expanded={!closed(node.path)}
              style={{ paddingLeft: indent(depth) }}
              // The same rhythm as the rows it holds — a list whose folders are
              // shorter than their contents reads as two lists interleaved —
              // and a tint, which is what says "this one is a heading" at a
              // glance where 14px of indentation does not.
              className="flex w-full cursor-pointer items-center gap-1.5 bg-[var(--bg-raised)]/50 py-0.5 pr-2 text-left text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] max-md:min-h-12 max-md:gap-2 max-md:text-[13px]"
            >
              <span aria-hidden className={CHEVRON}>
                {closed(node.path) ? '▸' : '▾'}
              </span>
              <span className="min-w-0 flex-1 truncate">{node.name}/</span>
              <span className="shrink-0 tabular-nums opacity-70">{node.count}</span>
            </button>
            {!closed(node.path) && (
              <Tree nodes={node.children} depth={depth + 1} closed={closed} toggle={toggle} leaf={leaf} />
            )}
          </Fragment>
        ),
      )}
    </>
  );
}

/** A count or a state, as a pill rather than as four more characters of text. */
function Chip({ tone, title, children }: { tone: string; title?: string; children: ReactNode }) {
  return (
    <span className={`shrink-0 rounded px-1 text-[10px] tabular-nums ${tone}`} title={title}>
      {children}
    </span>
  );
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
  const [filter, setFilter] = useState('');
  const folders = useFolders();
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

  /**
   * The filter, which is a plain substring and deliberately not a fuzzy match.
   *
   * These are branch names you already know — you are typing the bit you
   * remember, `DES-32`, and every character has to narrow the list or the box
   * is lying. A fuzzy matcher answers `edgar/DES-32683` to `dst` and then has to
   * explain itself; there is nothing to explain here.
   */
  const needle = filter.trim().toLowerCase();
  const hit = (text: string): boolean => needle === '' || text.toLowerCase().includes(needle);
  const filtering = needle !== '';

  const local = (branches?.local ?? []).filter((b) => hit(b.name));
  const remote = (branches?.remote ?? []).filter((b) => hit(`${b.remote}/${b.name}`));
  const tagList = (tags ?? []).filter((t) => hit(t.name));
  const stashList = (stashes ?? []).filter((s) => hit(s.message));
  const worktreeList = (worktrees ?? []).filter((w) => hit(w.path) || hit(w.branch ?? ''));
  const nothing =
    filtering &&
    local.length === 0 &&
    remote.length === 0 &&
    tagList.length === 0 &&
    stashList.length === 0 &&
    worktreeList.length === 0;

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

  // Remote branches keep their remote as the outermost folder, which is how
  // anyone reads them — and then group by slash like everything else.
  const remoteTree = groupRefs(remote, (b) => `${b.remote}/${b.name}`);
  const localTree = groupRefs(local, (b) => b.name);
  const tagTree = groupRefs(tagList, (t) => t.name);

  // Filtering opens every folder: a hit hidden inside a fold is a search that
  // says it found something and shows you nothing.
  const closed = (path: string) => !filtering && folders.closed(path);

  const pick = (ref: string) => onSelectRef(selectedRef === ref ? null : ref);

  const branchRow = (branch: GitBranch, name: string, depth: number) => (
    <div
      key={branch.fullRef}
      style={{ paddingLeft: indent(depth) }}
      className={`group ${rowClass} ${
        branch.current ? 'bg-[var(--accent)]/8' : selectedRef === branch.name ? 'bg-[var(--bg-hover)]' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => pick(branch.name)}
        title={
          branch.worktreePath
            ? `Checked out in another worktree: ${branch.worktreePath}`
            : (branch.lastSubject ?? branch.name)
        }
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${branch.current ? 'bg-[var(--accent)]' : 'bg-transparent'}`}
        />
        <span
          className={`min-w-0 flex-1 truncate ${
            branch.current ? 'font-semibold text-[var(--accent)]' : 'text-[var(--text)]/85'
          }`}
        >
          {name}
        </span>
        {branch.upstreamGone && (
          <Chip tone="bg-amber-400/15 text-amber-400" title="Its upstream no longer exists">
            gone
          </Chip>
        )}
        {(branch.ahead > 0 || branch.behind > 0) && (
          <Chip
            tone="bg-[var(--bg-hover)] text-[var(--text-dim)]"
            title={`${branch.ahead} ahead, ${branch.behind} behind ${branch.upstream ?? 'its upstream'}`}
          >
            {branch.ahead > 0 && `↑${branch.ahead}`}
            {branch.ahead > 0 && branch.behind > 0 && ' '}
            {branch.behind > 0 && `↓${branch.behind}`}
          </Chip>
        )}
        {branch.worktreePath && (
          <Chip tone="bg-sky-400/15 text-sky-300" title={branch.worktreePath}>
            wt
          </Chip>
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
              reason: branch.worktreePath ? `It is checked out in ${branch.worktreePath}` : status?.blocked.checkout,
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
  );

  return (
    <div className="h-full overflow-y-auto text-xs">
      {/* Stuck to the top of the scroller rather than placed above it: the one
          box on this panel that must be reachable without scrolling back up,
          and the panel is the scroller in both of the shapes it is drawn in —
          a column on a desktop, a sheet on a phone. */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)] p-2">
        <input
          type="search"
          value={filter}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name…"
          aria-label="Filter branches, tags and stashes by name"
          className={`${inputClass} w-full pr-7 text-xs max-md:min-h-10 max-md:text-sm`}
        />
        {filtering && (
          <button
            type="button"
            onClick={() => setFilter('')}
            aria-label="Clear the filter"
            className="absolute top-2 right-2 bottom-2 cursor-pointer px-2 text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        )}
      </div>

      {nothing && (
        <p className="p-3 text-[11px] text-[var(--text-dim)]">
          Nothing here is called <span className="font-mono text-[var(--text)]">{filter.trim()}</span>.
        </p>
      )}

      {(!filtering || local.length > 0) && (
          <Section
            id="branches"
            title="Branches"
            count={local.length}
            forceOpen={filtering && local.length > 0}
            actions={
              repoId && <SectionAction label="+ New" hint="Create a branch at HEAD" onClick={() => setCreating(true)} />
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
                  className={`${inputClass} w-full font-mono text-[11px] max-md:min-h-10 max-md:text-sm`}
                />
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
            <Tree nodes={localTree} depth={0} closed={closed} toggle={folders.toggle} leaf={branchRow} />
          </Section>
        )}

        {(!filtering || remote.length > 0) && (
          <Section
            id="remotes"
            title="Remotes"
            count={remote.length}
            initial={false}
            forceOpen={filtering && remote.length > 0}
          >
            {remote.length === 0 && <Empty>No remote branches.</Empty>}
            <Tree
              nodes={remoteTree}
              depth={0}
              closed={closed}
              toggle={folders.toggle}
              leaf={(branch, name, depth) => {
                const full = `${branch.remote}/${branch.name}`;
                return (
                  <div
                    key={branch.fullRef}
                    style={{ paddingLeft: indent(depth) }}
                    className={`group ${rowClass} ${selectedRef === full ? 'bg-[var(--bg-hover)]' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => pick(full)}
                      title={full}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-sky-300/85">{name}</span>
                      {branch.localMissing && (
                        <Chip tone="bg-[var(--bg-hover)] text-[var(--text-dim)]" title="No local branch of this name">
                          remote only
                        </Chip>
                      )}
                    </button>
                    {branch.localMissing && repoId && (
                      <RowActions
                        name={full}
                        say={action.say}
                        actions={[
                          {
                            label: '→',
                            words: `Create a local ${branch.name}`,
                            hint: `Tracking ${full}`,
                            disabled: action.busy || !!status?.blocked.checkout,
                            reason: status?.blocked.checkout,
                            run: () => checkout(branch.name),
                          },
                        ]}
                      />
                    )}
                  </div>
                );
              }}
            />
          </Section>
        )}

        {(!filtering || tagList.length > 0) && (
          <Section
            id="tags"
            title="Tags"
            count={tagList.length}
            initial={false}
            forceOpen={filtering && tagList.length > 0}
            actions={
              repoId && <SectionAction label="+ New" hint="Create a tag at HEAD" onClick={() => setTagging(true)} />
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
                  className={`${inputClass} w-full font-mono text-[11px] max-md:min-h-10 max-md:text-sm`}
                />
                <input
                  type="text"
                  spellCheck={false}
                  value={tagMessage}
                  placeholder="Message (optional — makes it annotated)"
                  onChange={(e) => setTagMessage(e.target.value)}
                  className={`${inputClass} mt-1 w-full text-[11px] max-md:min-h-10 max-md:text-sm`}
                />
                <div className="mt-1 flex flex-wrap gap-1.5">
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
            {tagList.length === 0 && <Empty>No tags.</Empty>}
            <Tree
              nodes={tagTree}
              depth={0}
              closed={closed}
              toggle={folders.toggle}
              leaf={(tag, name, depth) => (
                <div
                  key={tag.name}
                  style={{ paddingLeft: indent(depth) }}
                  className={`group ${rowClass} ${selectedRef === tag.name ? 'bg-[var(--bg-hover)]' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => pick(tag.name)}
                    title={tag.subject ?? tag.name}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate text-amber-400/90">{name}</span>
                    {tag.annotated && (
                      <Chip tone="bg-[var(--bg-hover)] text-[var(--text-dim)]" title="Annotated tag">
                        a
                      </Chip>
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
              )}
            />
          </Section>
        )}

        {(!filtering || stashList.length > 0) && (
          <Section
            id="stashes"
            title="Stashes"
            count={stashList.length}
            initial={false}
            forceOpen={filtering && stashList.length > 0}
            actions={
              repoId && (
                <SectionAction
                  label="+ Stash all"
                  hint={status?.blocked.stash ?? 'Put everything aside and clean the tree'}
                  disabled={action.busy || !!status?.blocked.stash}
                  onClick={() => run(() => gitApi.stash(repoId, { includeUntracked: true }))}
                />
              )
            }
          >
            {stashList.length === 0 && <Empty>No stashes.</Empty>}
            {stashList.map((stash) => (
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
        )}

        {(!filtering || worktreeList.length > 0) && (
          <Section
            id="worktrees"
            title="Worktrees"
            count={worktreeList.length}
            initial={false}
            forceOpen={filtering && worktreeList.length > 0}
            actions={
              repoId && (
                <SectionAction
                  label="+ New"
                  hint="A second working tree of this repository"
                  onClick={() => setAddingWorktree(true)}
                />
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
                  className={`${inputClass} w-full font-mono text-[11px] max-md:min-h-10 max-md:text-sm`}
                />
                <p className="mt-0.5 text-[10px] text-[var(--text-dim)]">
                  A second working tree of this repository, checked out at{' '}
                  <span className="font-mono">{selectedRef ?? 'HEAD'}</span>. The folder must not exist yet.
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
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
            {worktreeList.length === 0 && <Empty>No worktrees.</Empty>}
            {worktreeList.map((wt) => (
              <div key={wt.path} className={`group ${rowClass}`} title={wt.path}>
                <span className="truncate-start min-w-0 flex-1 truncate font-mono text-[10px]">{wt.path}</span>
                {wt.branch && (
                  <Chip tone="bg-[var(--accent)]/15 text-[var(--accent)]">
                    {wt.branch.replace(/^refs\/heads\//, '')}
                  </Chip>
                )}
                {wt.isMain && <Chip tone="bg-[var(--bg-hover)] text-[var(--text-dim)]">main</Chip>}
                {wt.locked && <Chip tone="bg-amber-400/15 text-amber-400">locked</Chip>}
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
        )}

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
              <span className="font-mono">{droppingStash.message}</span> — stashed {relativeTime(droppingStash.at)}.
              Nothing in this app can bring it back, and it is not on any branch.
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
