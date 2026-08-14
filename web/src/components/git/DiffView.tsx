import type { GitDiffLineKind, GitFileDiff, GitHunk } from '@claude-history/shared';
import { useMemo, useState } from 'react';
import { pairedRuns, wordDiff, type WordSpan } from '../../lib/gitWordDiff.ts';
import { FoldHeader } from '../viewer/FoldHeader.tsx';

/**
 * A unified diff, rendered by hand.
 *
 * highlight.js has a `diff` grammar and it was rejected: it colours a whole
 * line by its first character and gives nothing else — no line-number gutters,
 * no hunk boundary to hang a "stage this" button on later, no collapsed
 * context — and its own token colours would fight the red/emerald scheme the
 * viewer's file-changes panel already established. This is a hundred lines and
 * gives all of it.
 *
 * `whitespace-pre`, never `pre-wrap`: a fixed row height is what keeps the two
 * gutters aligned down a whole file, and it leaves the door open to
 * virtualising a twenty-thousand-line diff later. The body scrolls sideways,
 * which is what every real diff viewer does.
 */
const TONE: Record<GitDiffLineKind, string> = {
  ctx: 'text-[var(--text)]/70',
  add: 'bg-emerald-500/5 text-emerald-200/90',
  del: 'bg-red-500/5 text-red-200/90',
  conflict: 'bg-amber-500/10 text-amber-300',
  meta: 'text-[var(--text-dim)] italic',
};

const SIGN: Record<GitDiffLineKind, string> = {
  ctx: ' ',
  add: '+',
  del: '−',
  conflict: '!',
  meta: '\\',
};

const STATUS_LABEL: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type changed',
  U: 'unmerged',
};

/** The mark inside a changed line. Spans, not the Highlight API: this DOM is ours and it is stable. */
const MARK: Partial<Record<GitDiffLineKind, string>> = {
  add: 'rounded-[2px] bg-emerald-500/25',
  del: 'rounded-[2px] bg-red-500/25',
};

export interface HunkActions {
  /** Whether these hunks are in the index (so the verb is "unstage") or in the tree. */
  staged: boolean;
  onApply: (hunkIndex: number) => void;
  onDiscard?: (hunkIndex: number) => void;
  busy?: boolean;
  /**
   * Line picking. A key is `hunkIndex:lineIndex` so a selection cannot leak
   * from one hunk into another — the server takes lines for ONE hunk at a time,
   * and a patch mixing two of them would describe a file that never existed.
   */
  picked?: Set<string>;
  onPick?: (hunkIndex: number, lineIndex: number, extend: boolean) => void;
}

export const lineKey = (hunkIndex: number, lineIndex: number): string => `${hunkIndex}:${lineIndex}`;

function Hunk({
  hunk,
  index,
  actions,
  onExpand,
}: {
  hunk: GitHunk;
  index: number;
  actions?: HunkActions;
  onExpand?: () => void;
}) {
  // Which lines pair up as one edit, and therefore what to mark inside them.
  const marks = useMemo(() => {
    const pairs = pairedRuns(hunk.lines.map((l) => l.kind));
    const out = new Map<number, WordSpan[]>();
    for (const [delIndex, addIndex] of pairs) {
      const result = wordDiff(hunk.lines[delIndex].text, hunk.lines[addIndex].text);
      if (!result) continue;
      out.set(delIndex, result.del);
      out.set(addIndex, result.add);
    }
    return out;
  }, [hunk]);

  return (
    <>
      {hunk.gapBefore > 0 &&
        (onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            title="Show more of the surrounding lines"
            className="w-full cursor-pointer py-0.5 text-center text-[10px] text-[var(--text-dim)] select-none hover:bg-[var(--bg-hover)]/50 hover:text-[var(--text)]"
          >
            ⋮ {hunk.gapBefore} unchanged line{hunk.gapBefore === 1 ? '' : 's'}
          </button>
        ) : (
          <div className="px-2 py-0.5 text-center text-[10px] text-[var(--text-dim)] select-none">
            ⋮ {hunk.gapBefore} unchanged line{hunk.gapBefore === 1 ? '' : 's'}
          </div>
        ))}
      <div className="flex items-center gap-2 bg-[var(--bg-raised)] px-2 py-0.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-sky-300/70">{hunk.header}</span>
        {actions && (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={actions.busy}
              onClick={() => actions.onApply(index)}
              title={actions.staged ? 'Take just this hunk out of the index' : 'Put just this hunk in the index'}
              className="cursor-pointer px-1 text-[10px] text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-40"
            >
              {actions.staged ? '− unstage' : '+ stage'}
            </button>
            {actions.onDiscard && (
              <button
                type="button"
                disabled={actions.busy}
                onClick={() => actions.onDiscard?.(index)}
                title="Throw just this hunk away"
                className="cursor-pointer px-1 text-[10px] text-[var(--text-dim)] hover:text-red-300 disabled:opacity-40"
              >
                ↺ discard
              </button>
            )}
          </span>
        )}
      </div>
      {hunk.lines.map((line, i) => {
        const spans = marks.get(i);
        const changed = line.kind === 'add' || line.kind === 'del';
        const pickable = !!actions?.onPick && changed;
        const isPicked = actions?.picked?.has(lineKey(index, i)) === true;
        return (
          <div
            key={i}
            data-line={changed ? lineKey(index, i) : undefined}
            data-picked={isPicked ? '1' : undefined}
            onClick={pickable ? (e) => actions?.onPick?.(index, i, e.shiftKey) : undefined}
            title={pickable ? 'Click to pick this line; shift-click to reach from the last one' : undefined}
            className={`flex font-mono text-[11px] leading-[18px] ${TONE[line.kind]} ${
              pickable ? 'cursor-pointer' : ''
            } ${isPicked ? 'outline outline-1 -outline-offset-1 outline-[var(--accent)]' : ''}`}
          >
            {/* A checkbox column only where there is something to pick, so the
                gutters stay put and an unchanged line reads as unpickable. */}
            {actions?.onPick && (
              <span className="w-4 shrink-0 text-center opacity-70 select-none">
                {changed ? (isPicked ? '☑' : '☐') : ''}
              </span>
            )}
            {/* The gutters are select-none so copying a hunk does not drag line
                numbers along with the code. */}
            <span className="w-12 shrink-0 pr-2 text-right tabular-nums opacity-50 select-none">{line.oldNo ?? ''}</span>
            <span className="w-12 shrink-0 pr-2 text-right tabular-nums opacity-50 select-none">{line.newNo ?? ''}</span>
            <span className="w-4 shrink-0 text-center opacity-60 select-none">{SIGN[line.kind]}</span>
            <span className="min-w-0 flex-1 pr-4 whitespace-pre select-text">
              {spans
                ? spans.map((span, k) =>
                    span.hit ? (
                      <span key={k} className={MARK[line.kind]}>
                        {span.text}
                      </span>
                    ) : (
                      <span key={k}>{span.text}</span>
                    ),
                  )
                : line.text}
            </span>
          </div>
        );
      })}
    </>
  );
}

function FileDiff({
  file,
  openByDefault,
  actions,
  onExpand,
}: {
  file: GitFileDiff;
  openByDefault: boolean;
  actions?: HunkActions;
  onExpand?: () => void;
}) {
  const [open, setOpen] = useState(openByDefault);
  return (
    <div className="mb-2 overflow-hidden rounded border border-[var(--border)]">
      <div className="flex items-center gap-2 bg-[var(--bg-raised)]/60 px-2 py-1">
        <FoldHeader
          open={open}
          onToggle={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-[11px]"
        >
          <span className="w-2 shrink-0 text-[var(--text-dim)]">{open ? '▾' : '▸'}</span>
          <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
            {file.origPath && <span className="text-[var(--text-dim)]">{file.origPath} → </span>}
            {file.path}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{STATUS_LABEL[file.status] ?? file.status}</span>
          {!file.binary && (
            <span className="shrink-0 tabular-nums text-[10px]">
              <span className="text-emerald-400">+{file.additions}</span>{' '}
              <span className="text-red-400">−{file.deletions}</span>
            </span>
          )}
        </FoldHeader>
      </div>

      {open && (
        <div className="overflow-x-auto">
          {file.binary ? (
            <p className="px-2 py-2 text-[11px] text-[var(--text-dim)]">Binary file — no text to compare.</p>
          ) : file.tooLarge ? (
            // A trimmed answer must never read like an empty one.
            <p className="px-2 py-2 text-[11px] text-amber-400">
              This diff is too large to show here. Open the file in VS Code, or narrow the commit range.
            </p>
          ) : file.hunks.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-[var(--text-dim)]">
              No textual changes — a mode change or a rename with identical content.
            </p>
          ) : (
            file.hunks.map((hunk, i) => (
              <Hunk key={i} hunk={hunk} index={i} actions={actions} onExpand={onExpand} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function DiffView({
  files,
  truncated,
  selectedPath,
  actions,
  onExpand,
}: {
  files: GitFileDiff[];
  truncated: boolean;
  selectedPath: string | null;
  /** Per-hunk buttons. Only the working tree has them — a commit is history. */
  actions?: HunkActions;
  /** Show more surrounding lines. Absent when there is nothing more to show. */
  onExpand?: () => void;
}) {
  if (files.length === 0) {
    return <p className="text-[11px] text-[var(--text-dim)]">Nothing changed here.</p>;
  }
  return (
    <>
      {truncated && (
        <p className="mb-2 text-[11px] text-amber-400">
          More files changed than are shown here. The list below is the beginning of it.
        </p>
      )}
      {files.map((file) => (
        <FileDiff
          key={file.path}
          file={file}
          openByDefault={files.length <= 6 || file.path === selectedPath}
          actions={actions}
          onExpand={onExpand}
        />
      ))}
    </>
  );
}
