import type {
  GitDiffLineKind,
  GitDiscardEntry,
  GitFileEntry,
  GitMutationResponse,
  GitStatus,
} from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { gitApi } from '../../api/git.ts';
import { formatBytes, formatDateTime, relativeTime } from '../../lib/format.ts';
import { useBackDismiss, useIsMobile } from '../../lib/mobile.ts';
import { useDragSize } from '../../lib/useDragSize.ts';
import { actionClass } from '../controlClass.ts';
import { FoldHeader } from '../FoldHeader.tsx';
import { Sheet } from '../Sheet.tsx';
import { CommitBox } from './CommitBox.tsx';
import { ConflictSides } from './ConflictSides.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { DiffView, pairedWith } from './DiffView.tsx';
import { useGitAction } from './useGitAction.ts';

/**
 * The three verbs on a file row — stage, unstage, discard.
 *
 * A glyph in `px-1` is an 11×17 target, and two of these run `git checkout --`
 * on a file. 44px below 48rem, which is the floor for anything that decides
 * something.
 */
const FILE_ACT =
  'cursor-pointer px-1 text-[var(--text-dim)] hover:text-[var(--text)] max-md:inline-flex max-md:size-11 max-md:items-center max-md:justify-center max-md:px-0 max-md:text-base';

/** What a discard put in the bin, while the bar offering to undo it is up. */
interface Undo {
  id: string;
  /** Starts the bar's sentence, verb included: "Deleted 3 untracked files". */
  what: string;
}

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
 * What was discarded here lately, and the way back.
 *
 * The bar that appears right after a discard is the undo people actually use;
 * this is for the one noticed an hour later. Folded by default and absent
 * entirely while the bin is empty — it is a way out, not a feature to look at.
 */
function Bin({
  repoId,
  entries,
  action,
}: {
  repoId: string;
  entries: GitDiscardEntry[];
  action: ReturnType<typeof useGitAction>;
}) {
  const [open, setOpen] = useState(() => localStorage.getItem('git.fold.bin') === '1');
  if (entries.length === 0) return null;
  return (
    <div className="border-b border-[var(--border)]">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <FoldHeader
          open={open}
          onToggle={() => {
            localStorage.setItem('git.fold.bin', open ? '0' : '1');
            setOpen(!open);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] tracking-wider text-[var(--text-dim)] uppercase"
        >
          <span className="w-2">{open ? '▾' : '▸'}</span>
          <span>Discarded lately</span>
          <span className="tabular-nums">{entries.length}</span>
        </FoldHeader>
      </div>
      {open && (
        <div className="pb-1">
          {entries.map((entry) => (
            <div key={entry.id} className="group flex items-center gap-1.5 px-2 py-0.5 text-[11px]">
              <span className="min-w-0 flex-1 truncate" title={entry.files.map((f) => f.path).join('\n')}>
                <span className="text-[var(--text-dim)]" title={formatDateTime(entry.at)}>
                  {relativeTime(entry.at)}
                </span>{' '}
                {entry.what}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-dim)]">
                {formatBytes(entry.files.reduce((sum, f) => sum + f.bytes, 0))}
              </span>
              <button
                type="button"
                disabled={action.busy}
                onClick={() => void action.run(() => gitApi.restoreDiscard(repoId, entry.id))}
                title="Write those files back exactly as they were"
                className="shrink-0 cursor-pointer px-1 text-[10px] text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:text-[var(--text)] disabled:opacity-40 max-md:min-h-11 max-md:px-2 max-md:text-xs max-md:opacity-100"
              >
                put back
              </button>
            </div>
          ))}
          <p className="px-2 py-1 text-[10px] text-[var(--text-dim)]">
            Copies of the files as they were, kept for a week. Putting one back writes over what is there now — which
            is itself undoable, by putting back a newer one.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Where the selected file's diff is drawn: the right-hand column, or the whole
 * screen over the list.
 *
 * One component so the contents are written once. A phone that keeps both
 * columns has 360px to divide between a 220px file list and a diff whose
 * gutters alone are 128 — so below 48rem the list is the page and the diff
 * arrives over it, closed by Done or by Back.
 */
function DiffPane({
  mobile,
  path,
  onClose,
  children,
}: {
  mobile: boolean;
  path: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!mobile) return <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">{children}</div>;
  if (!path) return null;
  // The basename: the whole path is what the row you tapped already showed, and
  // a sheet's title bar has no room to repeat it.
  return (
    <Sheet title={path.split(/[\/]/).pop() ?? path} onClose={onClose} closeLabel="Close">
      <div className="pt-2">{children}</div>
    </Sheet>
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
  const mobile = useIsMobile();
  const files = useDragSize({ key: 'git.filesWidth', axis: 'x', min: 220, max: 640, initial: 340 });
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null);
  // `what` is a noun phrase — "the changes to app.ts", "3 untracked files" —
  // so the dialog and the undo bar can each put their own verb in front of it.
  const [confirming, setConfirming] = useState<{ paths: string[]; what: string; deleting: boolean } | null>(null);
  const [discardingHunk, setDiscardingHunk] = useState<{ path: string; hunkIndex: number } | null>(null);
  const [discardingLines, setDiscardingLines] = useState<boolean>(false);
  // What the last discard put in the bin. The bar it raises is the undo: it is
  // there at the moment of the mistake, which is the only moment it is asked
  // for. The list further down is for the rest of the week.
  const [undo, setUndo] = useState<Undo | null>(null);
  const action = useGitAction(repoId);
  /**
   * Letting go of the file, which on a phone is what closes the sheet over the
   * list — so Android's Back does it too. The picked lines go with it: an index
   * into one file's diff means nothing in another's.
   */
  const closeFile = () => {
    setSelected(null);
    setPicked(new Set());
    lastPick.current = null;
    setReaching(false);
  };
  useBackDismiss(mobile && !!selected, closeFile);

  const conflicted = status.entries.filter((e) => e.conflicted);
  const staged = status.entries.filter((e) => !e.conflicted && e.staged);
  const changed = status.entries.filter((e) => !e.conflicted && e.unstaged && e.unstaged !== 'untracked');
  const untracked = status.entries.filter((e) => !e.conflicted && e.unstaged === 'untracked');

  // How much unchanged context the diff carries. Expanding is one step at a
  // time rather than all-or-nothing: "show me a bit more" is the actual
  // question, and a whole file dumped into the pane answers a different one.
  const [context, setContext] = useState(3);
  // Picked lines, keyed `hunk:line`. Cleared whenever the file or the side
  // changes: an index into one diff means nothing in another.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lastPick = useRef<{ hunk: number; line: number } | null>(null);
  /**
   * Armed "reach from the last one", which is shift-click without a shift.
   *
   * A phone keyboard cannot send a modifier with a tap, so picking a run of
   * lines — the ordinary case when three consecutive lines are one edit — had
   * no answer there at all. Armed from the bar, spent by the next tap, and the
   * desktop never sees it because the modifier is the better control there.
   */
  const [reaching, setReaching] = useState(false);
  const selectedEntry = selected ? status.entries.find((e) => e.path === selected.path) : undefined;
  const selectedIsConflicted = selectedEntry?.conflicted === true;

  const diffQ = useQuery({
    queryKey: ['git', 'workingDiff', repoId, selected?.path ?? null, selected?.staged ?? false, context, status.readAt],
    queryFn: () =>
      gitApi.diff(repoId, { mode: selected?.staged ? 'staged' : 'worktree', path: selected?.path ?? null, context }),
    enabled: !!selected && !selectedIsConflicted,
  });

  // Everything in the bin for this repo. Cheap (one small JSON), and refetched
  // by the same `['git']` invalidation every mutation already does.
  const binQ = useQuery({
    queryKey: ['git', 'discards', repoId],
    queryFn: () => gitApi.discards(repoId),
  });

  const stage = (paths: string[]) => void action.run(() => gitApi.stage(repoId, paths));
  const unstage = (paths: string[]) => void action.run(() => gitApi.unstage(repoId, paths));
  const askDiscard = (paths: string[], what: string, deleting = false) =>
    setConfirming({ paths, what, deleting });

  /** Run a discard and, if a copy was kept, offer to put it back. */
  const discardAnd = (what: string, work: () => Promise<GitMutationResponse>) =>
    void action.run(work).then((result) => {
      setUndo(result?.undoId ? { id: result.undoId, what } : null);
    });

  /**
   * The picked lines, grouped by hunk — and, for a discard, with the other half
   * of every pair added. git pairs a run by position, so taking back an added
   * line without restoring the one it replaced would delete content nobody
   * picked; the dialog then lists exactly what this produced.
   */
  const groupPicked = (withPairs: boolean): { hunkIndex: number; lines: number[] }[] => {
    const hunks = diffQ.data?.files[0]?.hunks ?? [];
    const byHunk = new Map<number, Set<number>>();
    for (const key of picked) {
      const [h, l] = key.split(':').map(Number);
      const set = byHunk.get(h) ?? new Set<number>();
      set.add(l);
      if (withPairs) {
        const kinds: GitDiffLineKind[] = hunks[h]?.lines.map((line) => line.kind) ?? [];
        const partner = pairedWith(kinds, l);
        if (partner !== null) set.add(partner);
      }
      byHunk.set(h, set);
    }
    return [...byHunk.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hunkIndex, set]) => ({ hunkIndex, lines: [...set].sort((a, b) => a - b) }));
  };

  /** Those same lines as text, so the dialog can show what is about to move. */
  const pickedLines = (): { kind: GitDiffLineKind; text: string }[] => {
    const hunks = diffQ.data?.files[0]?.hunks ?? [];
    return groupPicked(true).flatMap(({ hunkIndex, lines }) =>
      lines.map((i) => hunks[hunkIndex]?.lines[i]).filter((line): line is NonNullable<typeof line> => !!line),
    );
  };

  const clearPicks = () => {
    setPicked(new Set());
    lastPick.current = null;
    setReaching(false);
  };

  const row = (entry: GitFileEntry, staged: boolean) => {
    const letter = letterOf(entry, staged);
    const active = selected?.path === entry.path && selected.staged === staged;
    return (
      <div
        key={`${staged ? 's' : 'w'}:${entry.path}`}
        className={`group flex items-center gap-1.5 px-2 py-0.5 text-[11px] max-md:min-h-11 max-md:text-xs ${
          active ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]/50'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setSelected({ path: entry.path, staged });
            // A line index belongs to one diff of one file; carrying it across
            // would point at something else entirely.
            setPicked(new Set());
            lastPick.current = null;
          }}
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
        {/* Always drawn below 48rem: `group-hover:` is compiled inside
            `@media (hover: hover)`, so on a phone this cluster did not appear
            at all — and with it went staging a single file. */}
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 max-md:opacity-100">
          {staged ? (
            <button
              type="button"
              onClick={() => unstage([entry.path])}
              title="Unstage"
              aria-label="Unstage"
              className={FILE_ACT}
            >
              −
            </button>
          ) : (
            <button
              type="button"
              onClick={() => stage([entry.path])}
              title={entry.conflicted ? 'Mark as resolved' : 'Stage'}
              aria-label={entry.conflicted ? 'Mark as resolved' : 'Stage'}
              className={FILE_ACT}
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
                  entry.unstaged === 'untracked' ? entry.path : `the changes to ${entry.path}`,
                  entry.unstaged === 'untracked',
                )
              }
              title={entry.unstaged === 'untracked' ? 'Delete this untracked file' : 'Discard these changes'}
              aria-label={entry.unstaged === 'untracked' ? 'Delete this untracked file' : 'Discard these changes'}
              className={`${FILE_ACT} hover:text-red-300`}
            >
              ↺
            </button>
          )}
        </span>
      </div>
    );
  };

  /** What the confirm dialog is about to move, computed once for the four places it says it. */
  const losing = discardingLines ? pickedLines() : [];

  const errorBar = action.error ? (
    <p className="mb-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">{action.error}</p>
  ) : null;

  const groupBtn = (label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={action.busy}
      className={`shrink-0 cursor-pointer px-1 text-[10px] max-md:min-h-11 max-md:px-2 max-md:text-xs ${
        danger ? 'text-[var(--text-dim)] hover:text-red-300' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
      } disabled:opacity-40`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The undo, where the mistake happens and while it is still on the
          user's mind. It spans both panes because a discard can come from
          either one. */}
      {undo && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
          <span>{undo.what}. A copy is kept — nothing is lost yet.</span>
          <button
            type="button"
            disabled={action.busy}
            className={`${actionClass} border-amber-500/50 text-amber-200`}
            onClick={() => {
              const id = undo.id;
              setUndo(null);
              void action.run(() => gitApi.restoreDiscard(repoId, id));
            }}
          >
            Undo
          </button>
          <button type="button" className={actionClass} onClick={() => setUndo(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Where a refusal is read. On a desktop it belongs at the top of the
          diff pane, which is where the thing refused was; on a phone that pane
          is a sheet that may not be open, so it goes above the list instead. */}
      {mobile && errorBar}

      <div className="flex min-h-0 flex-1">
      <div
        style={mobile ? undefined : { width: files.size }}
        className={`flex min-h-0 flex-col ${mobile ? 'min-w-0 flex-1' : 'shrink-0 border-r border-[var(--border)]'}`}
      >
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
                  () => askDiscard(changed.map((e) => e.path), `the changes to ${changed.length} files`),
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
                  () => askDiscard(untracked.map((e) => e.path), `${untracked.length} untracked files`, true),
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

          <Bin repoId={repoId} entries={binQ.data ?? []} action={action} />
        </div>

        <CommitBox repoId={repoId} status={status} onDone={() => setSelected(null)} />
      </div>

      {!mobile && (
        <div
          onMouseDown={files.onMouseDown}
          className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--accent-dim)]"
          title="Drag to resize"
        />
      )}

      {/* One pane at a time below 48rem: the list, and the file's diff over it.
          Two columns whose floors are 220 and 340 do not fit in 360, and the
          diff is the half that wants every pixel there is. */}
      <DiffPane mobile={mobile} path={selected?.path ?? null} onClose={closeFile}>
        {!mobile && errorBar}
        {!selected ? (
          <p className="text-[11px] text-[var(--text-dim)]">Pick a file to see what changed in it.</p>
        ) : selectedIsConflicted ? (
          <ConflictSides repoId={repoId} path={selected.path} />
        ) : diffQ.isLoading ? (
          <p className="text-[11px] text-[var(--text-dim)]">Reading the diff…</p>
        ) : diffQ.isError ? (
          <p className="text-[11px] text-red-400">Could not read the diff: {String(diffQ.error)}</p>
        ) : diffQ.data ? (
          <>
            {picked.size > 0 && (
              <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 rounded border border-[var(--accent-dim)] bg-[var(--bg-raised)] px-2 py-1.5 text-[11px]">
                <span className="tabular-nums">
                  {picked.size} line{picked.size === 1 ? '' : 's'} picked
                </span>
                {/* The phone's shift-click. Drawn only there, because on a
                    desktop the modifier is a better control than a mode. */}
                {mobile && (
                  <button
                    type="button"
                    aria-pressed={reaching}
                    className={`${actionClass} ${reaching ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`}
                    onClick={() => setReaching((on) => !on)}
                  >
                    {reaching ? 'Tap the last line…' : 'Reach from here'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={action.busy}
                  className={`${actionClass} border-[var(--accent-dim)] text-[var(--accent)]`}
                  onClick={() => {
                    // One hunk at a time: the server takes lines for a single
                    // hunk, and a patch mixing two would describe a file that
                    // never existed.
                    const runs = groupPicked(false);
                    void action
                      .run(async () => {
                        let last;
                        for (const { hunkIndex, lines } of runs) {
                          last = await gitApi.lines(repoId, {
                            path: selected.path,
                            hunkIndex,
                            lines,
                            staged: selected.staged,
                          });
                        }
                        return last;
                      })
                      .then(clearPicks);
                  }}
                >
                  {selected.staged ? 'Unstage them' : 'Stage them'}
                </button>
                {!selected.staged && (
                  <button
                    type="button"
                    disabled={action.busy}
                    className={`${actionClass} border-red-500/40 text-red-300`}
                    onClick={() => setDiscardingLines(true)}
                  >
                    Discard them
                  </button>
                )}
                <button type="button" className={actionClass} onClick={clearPicks}>
                  Clear
                </button>
                <span className="text-[var(--text-dim)]">
                  Staging lines only ever writes what the next commit will contain — never the file itself.
                  {!selected.staged && ' Discarding does write it, and a copy goes to the bin first.'}
                  {/* The one thing shift-click's tooltip used to say, said out
                      loud where there are no tooltips. */}
                  {mobile && ' Reach picks everything between this line and the next one you tap.'}
                </span>
              </div>
            )}
            <DiffView
              files={diffQ.data.files}
              truncated={diffQ.data.truncated}
              selectedPath={selected.path}
              onExpand={() => setContext((c) => Math.min(50, c + 12))}
              actions={{
                staged: selected.staged,
                busy: action.busy,
                picked,
                reaching,
                onPick: (hunkIndex, lineIndex, extend) => {
                  // Armed or not, it is spent by the tap it applies to.
                  setReaching(false);
                  /**
                   * Read HERE, not inside the updater below.
                   *
                   * `setPicked`'s function form runs during the next render,
                   * which is after this handler has finished — and the last
                   * line of this handler moves the ref to the line just
                   * clicked. Reading it in there therefore always answered
                   * "you came from where you already are", so `a` and `b` were
                   * the same index and a reach picked its own endpoint and
                   * nothing else. Measured: `{a: 8, b: 8}` for a shift-click
                   * from line 3 to line 8.
                   */
                  const from = lastPick.current;
                  setPicked((prev) => {
                    const next = new Set(prev);
                    // Shift extends only within the same hunk, because that is
                    // the only run the server can be handed as one patch.
                    if (extend && from && from.hunk === hunkIndex) {
                      const [a, b] = from.line < lineIndex ? [from.line, lineIndex] : [lineIndex, from.line];
                      const hunk = diffQ.data?.files[0]?.hunks[hunkIndex];
                      for (let i = a; i <= b; i++) {
                        const line = hunk?.lines[i];
                        if (line && (line.kind === 'add' || line.kind === 'del')) next.add(`${hunkIndex}:${i}`);
                      }
                    } else {
                      const key = `${hunkIndex}:${lineIndex}`;
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                    }
                    return next;
                  });
                  lastPick.current = { hunk: hunkIndex, line: lineIndex };
                },
                onApply: (hunkIndex) =>
                  void action.run(() =>
                    gitApi.hunk(repoId, { path: selected.path, hunkIndex, staged: selected.staged }),
                  ),
                onDiscard: selected.staged
                  ? undefined
                  : (hunkIndex) => setDiscardingHunk({ path: selected.path, hunkIndex }),
              }}
            />
          </>
        ) : null}
      </DiffPane>
      </div>

      {discardingHunk && (
        <ConfirmDialog
          title="Discard this hunk"
          body={
            <>
              Just this part of <span className="font-mono">{discardingHunk.path}</span> goes back to how it was. The
              rest of your changes to the file stay. It is in no commit, so git cannot bring it back — this app keeps a
              copy of the file for a week, and offers it as soon as this is done.
            </>
          }
          command={`git apply --reverse   (hunk ${discardingHunk.hunkIndex + 1} only)`}
          confirmLabel="Discard the hunk"
          busy={action.busy}
          onCancel={() => setDiscardingHunk(null)}
          onConfirm={() => {
            const { path: p, hunkIndex } = discardingHunk;
            setDiscardingHunk(null);
            discardAnd(`Discarded a hunk of ${p}`, () =>
              gitApi.hunk(repoId, { path: p, hunkIndex, discard: true, confirm: true }),
            );
          }}
        />
      )}

      {discardingLines && selected && (
        <ConfirmDialog
          title="Discard these lines"
          body={
            <>
              <p className="mb-2">
                These go back to how they are in the last commit — the rest of your changes to{' '}
                <span className="font-mono">{selected.path}</span> stay. A picked line brings its other half with it,
                because an edit is a pair: taking out the new line without putting the old one back would delete
                something you did not choose.
              </p>
              {/* The lines keep the sign and the colour they have in the diff
                  right behind this dialog — inverting them to mean "what
                  happens" would recolour the very lines being pointed at. The
                  words say what happens instead. */}
              <div className="max-h-52 overflow-auto rounded border border-[var(--border)] bg-[var(--bg)] p-1 font-mono text-[11px]">
                {losing.slice(0, 40).map((line, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="w-20 shrink-0 text-[10px] text-[var(--text-dim)]">
                      {line.kind === 'add' ? 'goes' : 'comes back'}
                    </span>
                    <span className={`min-w-0 whitespace-pre ${line.kind === 'add' ? 'text-emerald-200/90' : 'text-red-200/90'}`}>
                      {line.kind === 'add' ? '+' : '−'} {line.text}
                    </span>
                  </div>
                ))}
                {losing.length > 40 && <div className="text-[var(--text-dim)]">…and {losing.length - 40} more</div>}
              </div>
              <p className="mt-2 text-[var(--text-dim)]">
                Your edits go, the committed lines come back. They are in no commit, so git cannot undo it — this app
                keeps a copy of the file for a week, and offers it as soon as this is done.
              </p>
            </>
          }
          command={`git apply --reverse   (${losing.length} line(s) of ${selected.path})`}
          confirmLabel="Discard the lines"
          busy={action.busy}
          onCancel={() => setDiscardingLines(false)}
          onConfirm={() => {
            const runs = groupPicked(true);
            const count = runs.reduce((sum, run) => sum + run.lines.length, 0);
            const path = selected.path;
            setDiscardingLines(false);
            clearPicks();
            discardAnd(`Discarded ${count} line${count === 1 ? '' : 's'} of ${path}`, async () => {
              let last: GitMutationResponse | undefined;
              let first: string | null = null;
              for (const { hunkIndex, lines } of runs) {
                last = await gitApi.lines(repoId, { path, hunkIndex, lines, discard: true, confirm: true });
                // Lines picked in two hunks are two calls and two copies. The
                // one worth offering is the FIRST — the file before any of it.
                first = first ?? last.undoId ?? null;
              }
              // There is at least one run: the button only exists with lines picked.
              return { ...(last as GitMutationResponse), undoId: first };
            });
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming.deleting ? 'Delete these files' : 'Discard these changes'}
          body={
            <>
              You are about to {confirming.deleting ? 'delete' : 'discard'} {confirming.what}. None of it is in any
              commit, so git cannot bring it back — this app keeps a copy for a week, and offers it as soon as this is
              done.
            </>
          }
          command={
            confirming.deleting
              ? `git clean -f -d -- ${confirming.paths.length} file(s)`
              : `git restore --source=HEAD --staged --worktree -- ${confirming.paths.length} file(s)`
          }
          confirmLabel={confirming.deleting ? 'Delete' : 'Discard'}
          busy={action.busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const { paths, what, deleting } = confirming;
            setConfirming(null);
            discardAnd(`${deleting ? 'Deleted' : 'Discarded'} ${what}`, () => gitApi.discard(repoId, paths));
          }}
        />
      )}
    </div>
  );
}
