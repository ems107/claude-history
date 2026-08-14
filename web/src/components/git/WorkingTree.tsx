import type { GitFileEntry, GitStatus } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { gitApi } from '../../api/git.ts';
import { useDragSize } from '../../lib/useDragSize.ts';
import { btn } from '../../lib/ui.ts';
import { FoldHeader } from '../viewer/FoldHeader.tsx';
import { CommitBox } from './CommitBox.tsx';
import { ConflictSides } from './ConflictSides.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { DiffView } from './DiffView.tsx';
import { useGitAction } from './useGitAction.ts';

/** The status letter, in the colour it means. */
const LETTER_TONE: Record<string, string> = {
  M: 'text-amber-400',
  A: 'text-emerald-400',
  D: 'text-red-400',
  R: 'text-sky-400',
  C: 'text-sky-400',
  T: 'text-purple-400',
  '?': 'text-[var(--text-dim)]',
  U: 'font-semibold text-amber-400',
};

function letterOf(entry: GitFileEntry, staged: boolean): string {
  if (entry.conflicted) return 'U';
  if (entry.unstaged === 'untracked') return '?';
  const state = staged ? entry.staged : entry.unstaged;
  switch (state) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'typechange':
      return 'T';
    default:
      return 'M';
  }
}

/** Directory dimmed, basename at full strength — the name is what you are looking for. */
function FilePath({ path }: { path: string }) {
  const cut = path.lastIndexOf('/');
  if (cut < 0) return <span>{path}</span>;
  return (
    <>
      <span className="text-[var(--text-dim)]">{path.slice(0, cut + 1)}</span>
      <span>{path.slice(cut + 1)}</span>
    </>
  );
}

function Group({
  title,
  entries,
  tone,
  actions,
  children,
}: {
  title: string;
  entries: GitFileEntry[];
  tone?: string;
  actions?: ReactNode;
  children: (entry: GitFileEntry) => ReactNode;
}) {
  const key = `git.fold.wt.${title}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== '0');
  if (entries.length === 0) return null;
  return (
    <div className="border-b border-[var(--border)]">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <FoldHeader
          open={open}
          onToggle={() => {
            localStorage.setItem(key, open ? '0' : '1');
            setOpen(!open);
          }}
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-[11px] tracking-wider uppercase ${
            tone ?? 'text-[var(--text-dim)]'
          }`}
        >
          <span className="w-2">{open ? '▾' : '▸'}</span>
          <span>{title}</span>
          <span className="tabular-nums">{entries.length}</span>
        </FoldHeader>
        {/* Siblings, never inside the fold header. */}
        {actions}
      </div>
      {open && <div className="pb-1">{entries.map((entry) => children(entry))}</div>}
    </div>
  );
}

/**
 * The staging area.
 *
 * A tab rather than a fourth permanent pane: a staging area that is always on
 * screen leaves the graph 180 px tall on a laptop, which is the wrong trade for
 * something you use in bursts. The order of the groups is the order of the
 * question being asked — what is broken, what is ready, what is not, what is
 * new.
 */
export function WorkingTree({ repoId, status }: { repoId: string; status: GitStatus }) {
  const files = useDragSize({ key: 'git.filesWidth', axis: 'x', min: 220, max: 640, initial: 340 });
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null);
  const [confirming, setConfirming] = useState<{ paths: string[]; label: string } | null>(null);
  const [discardingHunk, setDiscardingHunk] = useState<{ path: string; hunkIndex: number } | null>(null);
  const action = useGitAction(repoId);

  const conflicted = status.entries.filter((e) => e.conflicted);
  const staged = status.entries.filter((e) => !e.conflicted && e.staged);
  const changed = status.entries.filter((e) => !e.conflicted && e.unstaged && e.unstaged !== 'untracked');
  const untracked = status.entries.filter((e) => !e.conflicted && e.unstaged === 'untracked');

  // How much unchanged context the diff carries. Expanding is one step at a
  // time rather than all-or-nothing: "show me a bit more" is the actual
  // question, and a whole file dumped into the pane answers a different one.
  const [context, setContext] = useState(3);
  const selectedEntry = selected ? status.entries.find((e) => e.path === selected.path) : undefined;
  const selectedIsConflicted = selectedEntry?.conflicted === true;

  const diffQ = useQuery({
    queryKey: ['git', 'workingDiff', repoId, selected?.path ?? null, selected?.staged ?? false, context, status.readAt],
    queryFn: () =>
      gitApi.diff(repoId, { mode: selected?.staged ? 'staged' : 'worktree', path: selected?.path ?? null, context }),
    enabled: !!selected && !selectedIsConflicted,
  });

  const stage = (paths: string[]) => void action.run(() => gitApi.stage(repoId, paths));
  const unstage = (paths: string[]) => void action.run(() => gitApi.unstage(repoId, paths));
  const askDiscard = (paths: string[], label: string) => setConfirming({ paths, label });

  const row = (entry: GitFileEntry, staged: boolean) => {
    const letter = letterOf(entry, staged);
    const active = selected?.path === entry.path && selected.staged === staged;
    return (
      <div
        key={`${staged ? 's' : 'w'}:${entry.path}`}
        className={`group flex items-center gap-1.5 px-2 py-0.5 text-[11px] ${
          active ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]/50'
        }`}
      >
        <button
          type="button"
          onClick={() => setSelected({ path: entry.path, staged })}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
          title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
        >
          <span className={`w-3 shrink-0 text-center font-mono ${LETTER_TONE[letter] ?? ''}`}>{letter}</span>
          <span className="min-w-0 flex-1 truncate font-mono">
            <FilePath path={entry.path} />
          </span>
          {entry.conflicted && entry.conflictKind && (
            <span className="shrink-0 text-[10px] text-amber-400">{entry.conflictKind}</span>
          )}
          {entry.submodule && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">submodule</span>}
        </button>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
          {staged ? (
            <button
              type="button"
              onClick={() => unstage([entry.path])}
              title="Unstage"
              className="cursor-pointer px-1 text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              −
            </button>
          ) : (
            <button
              type="button"
              onClick={() => stage([entry.path])}
              title={entry.conflicted ? 'Mark as resolved' : 'Stage'}
              className="cursor-pointer px-1 text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              +
            </button>
          )}
          {!staged && !entry.conflicted && (
            <button
              type="button"
              onClick={() =>
                askDiscard(
                  [entry.path],
                  entry.unstaged === 'untracked' ? `delete ${entry.path}` : `discard the changes to ${entry.path}`,
                )
              }
              title={entry.unstaged === 'untracked' ? 'Delete this untracked file' : 'Discard these changes'}
              className="cursor-pointer px-1 text-[var(--text-dim)] hover:text-red-300"
            >
              ↺
            </button>
          )}
        </span>
      </div>
    );
  };

  const groupBtn = (label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={action.busy}
      className={`shrink-0 cursor-pointer px-1 text-[10px] ${
        danger ? 'text-[var(--text-dim)] hover:text-red-300' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
      } disabled:opacity-40`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div style={{ width: files.size }} className="flex min-h-0 shrink-0 flex-col border-r border-[var(--border)]">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {status.entries.length === 0 && (
            <p className="p-3 text-[11px] text-[var(--text-dim)]">Nothing has changed. The tree is clean.</p>
          )}

          <Group
            title="Conflicted"
            entries={conflicted}
            tone="text-amber-400"
            actions={groupBtn('stage all', () => stage(conflicted.map((e) => e.path)))}
          >
            {(entry) => row(entry, false)}
          </Group>

          <Group
            title="Staged"
            entries={staged}
            actions={groupBtn('unstage all', () => unstage(staged.map((e) => e.path)))}
          >
            {(entry) => row(entry, true)}
          </Group>

          <Group
            title="Changed"
            entries={changed}
            actions={
              <>
                {groupBtn('stage all', () => stage(changed.map((e) => e.path)))}
                {groupBtn(
                  'discard all',
                  () => askDiscard(changed.map((e) => e.path), `discard the changes to ${changed.length} files`),
                  true,
                )}
              </>
            }
          >
            {(entry) => row(entry, false)}
          </Group>

          <Group
            title="Untracked"
            entries={untracked}
            actions={
              <>
                {groupBtn('stage all', () => stage(untracked.map((e) => e.path)))}
                {groupBtn(
                  'delete all',
                  () => askDiscard(untracked.map((e) => e.path), `delete ${untracked.length} untracked files`),
                  true,
                )}
              </>
            }
          >
            {(entry) => row(entry, false)}
          </Group>

          {status.truncated && (
            <p className="px-2 py-1 text-[11px] text-amber-400">
              There are more changes than are listed here.
            </p>
          )}

          {conflicted.length > 0 && (
            <p className="px-2 py-2 text-[11px] text-[var(--text-dim)]">
              Conflicts are resolved outside this app. Open the repository, fix the markers, then stage the file here.
            </p>
          )}
        </div>

        <CommitBox repoId={repoId} status={status} onDone={() => setSelected(null)} />
      </div>

      <div
        onMouseDown={files.onMouseDown}
        className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--accent-dim)]"
        title="Drag to resize"
      />

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
        {action.error && (
          <p className="mb-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">
            {action.error}
          </p>
        )}
        {!selected ? (
          <p className="text-[11px] text-[var(--text-dim)]">Pick a file to see what changed in it.</p>
        ) : selectedIsConflicted ? (
          <ConflictSides repoId={repoId} path={selected.path} />
        ) : diffQ.isLoading ? (
          <p className="text-[11px] text-[var(--text-dim)]">Reading the diff…</p>
        ) : diffQ.isError ? (
          <p className="text-[11px] text-red-400">Could not read the diff: {String(diffQ.error)}</p>
        ) : diffQ.data ? (
          <DiffView
            files={diffQ.data.files}
            truncated={diffQ.data.truncated}
            selectedPath={selected.path}
            onExpand={() => setContext((c) => Math.min(50, c + 12))}
            actions={{
              staged: selected.staged,
              busy: action.busy,
              onApply: (hunkIndex) =>
                void action.run(() =>
                  gitApi.hunk(repoId, { path: selected.path, hunkIndex, staged: selected.staged }),
                ),
              onDiscard: selected.staged
                ? undefined
                : (hunkIndex) => setDiscardingHunk({ path: selected.path, hunkIndex }),
            }}
          />
        ) : null}
      </div>

      {discardingHunk && (
        <ConfirmDialog
          title="Discard this hunk"
          body={
            <>
              Just this part of <span className="font-mono">{discardingHunk.path}</span> goes back to how it was. The
              rest of your changes to the file stay, and there is no undo for the part that goes.
            </>
          }
          command={`git apply --reverse   (hunk ${discardingHunk.hunkIndex + 1} only)`}
          confirmLabel="Discard the hunk"
          busy={action.busy}
          onCancel={() => setDiscardingHunk(null)}
          onConfirm={() => {
            const { path: p, hunkIndex } = discardingHunk;
            setDiscardingHunk(null);
            void action.run(() => gitApi.hunk(repoId, { path: p, hunkIndex, discard: true, confirm: true }));
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title="This cannot be undone"
          body={
            <>
              You are about to {confirming.label}. Discarded changes are not in any commit and nothing here can bring
              them back — an untracked file is simply deleted.
            </>
          }
          command={`git restore --source=HEAD --staged --worktree -- ${confirming.paths.length} file(s)`}
          confirmLabel="Discard"
          busy={action.busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const paths = confirming.paths;
            setConfirming(null);
            void action.run(() => gitApi.discard(repoId, paths));
          }}
        />
      )}
    </div>
  );
}
