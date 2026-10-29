import type { FileChange, ToolDiff, Turn } from '@claude-history/shared';
import { useMemo, useState } from 'react';
import { relativeToProject } from '../../lib/fileRefs.ts';
import { formatDateTime } from '../../lib/format.ts';
import { diffsByCall, fileOfDiff, lineEndingChange, toGitFileDiff } from '../../lib/toolDiff.ts';
import { FileDiffBody } from '../git/DiffView.tsx';
import { FileRefChip } from './FileRefLink.tsx';
import { useFileRefs } from './FileRefContext.ts';
import { FoldHeader } from '../FoldHeader.tsx';

type Edit = FileChange['edits'][number];

/** Why a file a command changed has nothing to draw. */
const NO_DIFF: Record<NonNullable<Edit['noDiff']>, string> = {
  'not-kept':
    'Changed, with no diff kept: Claude Code keeps one for five files a command at most, and none for a binary file, a change too large or too slow to compare, or a checkout, merge or pull.',
  unavailable: 'Changed, but Claude Code could not compare it.',
  'too-large': 'Changed — its diff is too large to carry here.',
};

function EditBlock({
  edit,
  path,
  diff,
  onGoToCall,
}: {
  edit: Edit;
  path: string;
  diff: ToolDiff | undefined;
  onGoToCall: (toolUseId: string) => void;
}) {
  const bash = edit.tool === 'Bash';
  const file = diff ? fileOfDiff(diff, path) : null;
  const git = useMemo(
    () => (file && !file.tooLarge && file.hunks.length > 0 ? toGitFileDiff(file, path) : null),
    [file, path],
  );
  const endings = useMemo(() => (file ? lineEndingChange(file) : null), [file]);
  const toolUseId = edit.toolUseId;
  return (
    <div className="mb-2 overflow-hidden rounded border border-[var(--border)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-dim)]">
        <span
          className={`rounded px-1.5 py-px font-semibold uppercase ${
            bash ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-sky-500/15 text-sky-400'
          }`}
        >
          {edit.tool}
        </span>
        {edit.timestamp && <span>{formatDateTime(edit.timestamp)}</span>}
        {edit.created && <span>created</span>}
        {edit.deleted && <span>deleted</span>}
        {endings && <span>line endings → {endings}</span>}
        {edit.truncated && !git && <span className="text-amber-400">truncated</span>}
        {toolUseId && (
          <button
            type="button"
            onClick={() => onGoToCall(toolUseId)}
            title="Go to the call that made this change"
            className="ml-auto cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 hover:border-[var(--text-dim)] hover:text-[var(--text)]"
          >
            ↑ the call
          </button>
        )}
      </div>
      {edit.noDiff ? (
        <p className="px-2 py-1.5 text-[11px] text-[var(--text-dim)]">{NO_DIFF[edit.noDiff]}</p>
      ) : endings ? (
        <p className="px-2 py-1.5 text-[11px] text-[var(--text-dim)]">
          Only the line endings changed: every line reads the same.
        </p>
      ) : git ? (
        // The diff Claude Code recorded, with its line numbers and its context —
        // the strings below are only what the call asked for, and say neither.
        <div className="max-h-72 overflow-y-auto">
          <FileDiffBody file={git} />
        </div>
      ) : (
        <>
          {edit.oldString !== null && (
            <pre className="max-h-48 overflow-auto border-b border-[var(--border)] bg-red-500/5 p-2 text-xs whitespace-pre-wrap text-red-200/90">
              {edit.oldString}
            </pre>
          )}
          {edit.newString !== null && (
            <pre className="max-h-48 overflow-auto bg-emerald-500/5 p-2 text-xs whitespace-pre-wrap text-emerald-200/90">
              {edit.newString}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Every file the session changed, with every change in the order it happened.
 *
 * Two kinds of change meet here. An Edit or Write is named by its call and
 * drawn from the patch Claude Code recorded for it, falling back to the
 * strings the call asked for where there is none (a failed call, a created
 * file, a transcript older than the patch). A Bash command's entries are the
 * files that changed in the folder while it ran — merged in under the same
 * path, marked as a command's, and saying why when no diff was kept.
 */
export function FileChangesPanel({
  fileChanges,
  turns,
  onGoToCall,
}: {
  fileChanges: FileChange[];
  turns: Turn[];
  onGoToCall: (toolUseId: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const diffs = useMemo(() => diffsByCall(turns), [turns]);
  const project = useFileRefs()?.projectPath ?? '';

  return (
    <div className="px-4 py-3">
      {/* The name and the count are the inspector's title bar now. */}
      <div className="mb-2 text-[11px] text-[var(--text-dim)]/80">
        from Edit/Write calls and what Bash commands changed; subagent edits live in their own transcripts
      </div>
      {fileChanges.map((fc) => {
        const isOpen = open.has(fc.path);
        const first = fc.edits[0]?.timestamp;
        const last = fc.edits[fc.edits.length - 1]?.timestamp;
        return (
          <div key={fc.path} className="mb-1">
            <div className="flex items-center gap-1 text-xs">
              <FoldHeader
                open={isOpen}
                onToggle={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(fc.path)) next.delete(fc.path);
                    else next.add(fc.path);
                    return next;
                  })
                }
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-1 py-0.5 text-left text-xs hover:bg-[var(--bg-hover)]"
              >
                <span className="text-[var(--text-dim)]">{isOpen ? '▾' : '▸'}</span>
                <span className="min-w-0 flex-1 truncate font-mono" title={fc.path}>
                  {relativeToProject(fc.path, project)}
                </span>
                <span className="shrink-0 text-[var(--text-dim)]">
                  {fc.edits.length} change{fc.edits.length !== 1 ? 's' : ''}
                  {first && ` · ${formatDateTime(first)}${last && last !== first ? ` → ${formatDateTime(last)}` : ''}`}
                </span>
              </FoldHeader>
              {/* Beside the header, never inside it: nothing interactive may be
                  nested in a FoldHeader. `fc.path` is always absolute — an
                  Edit/Write's `file_path` or a Bash diff's resolved path. */}
              <FileRefChip path={fc.path} />
            </div>
            {isOpen && (
              <div className="mt-1 ml-5">
                {fc.edits.map((edit, i) => (
                  <EditBlock
                    key={i}
                    edit={edit}
                    path={fc.path}
                    diff={edit.toolUseId ? diffs.get(edit.toolUseId) : undefined}
                    onGoToCall={onGoToCall}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
