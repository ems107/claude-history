import type { ToolDiff, ToolDiffFile } from '@claude-history/shared';
import { useMemo, useState } from 'react';
import { relativeToProject } from '../../lib/fileRefs.ts';
import { lineEndingChange, toGitFileDiff, type DiffTally } from '../../lib/toolDiff.ts';
import { useIsMobile } from '../../lib/mobile.ts';
import { FoldHeader } from '../FoldHeader.tsx';
import { FileDiffBody } from '../git/DiffView.tsx';
import { useFileRefs } from './FileRefContext.ts';
import { FileRefChip } from './FileRefLink.tsx';

const STATUS: Record<string, string> = { A: 'created', D: 'deleted', M: 'modified' };

/**
 * The call's face says what it changed before it is opened: `± 2 files +12 −3`
 * for a command, `+3 −1` for a file tool, `+40 new file` for a Write that
 * created one. A phone drops the word, not the numbers.
 */
export function DiffBadge({ tally, source, created }: { tally: DiffTally; source: ToolDiff['source']; created: boolean }) {
  const mobile = useIsMobile();
  const files = source === 'bash' ? (mobile ? `±${tally.files}` : `± ${tally.files} file${tally.files === 1 ? '' : 's'}`) : null;
  return (
    <span
      data-chrome
      className="flex shrink-0 items-center gap-1.5 rounded border border-[var(--border)] px-1.5 text-[11px] text-[var(--text-dim)] tabular-nums"
    >
      {files && <span>{files}</span>}
      {tally.counted && <span className="text-emerald-400">+{tally.additions}</span>}
      {tally.counted &&
        (created ? !mobile && <span>new file</span> : <span className="text-red-400">−{tally.deletions}</span>)}
    </span>
  );
}

function DiffFile({ file, project }: { file: ToolDiffFile; project: string }) {
  const [open, setOpen] = useState(true);
  const shown = relativeToProject(file.path, project);
  const git = useMemo(() => toGitFileDiff(file, shown), [file, shown]);
  const endings = useMemo(() => lineEndingChange(file), [file]);
  return (
    <div className="mt-1.5 overflow-hidden rounded border border-[var(--border)]">
      <div className="flex items-center gap-2 bg-[var(--bg-raised)]/60 px-2 py-1">
        <FoldHeader open={open} onToggle={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-[11px]">
          <span className="w-2 shrink-0 text-[var(--text-dim)]">{open ? '▾' : '▸'}</span>
          <span className="min-w-0 flex-1 truncate font-mono">{shown}</span>
          <span className="shrink-0 text-[10px] text-[var(--text-dim)]">
            {endings ? `line endings → ${endings}` : file.tooLarge ? 'too large to show' : STATUS[git.status]}
          </span>
          {!file.tooLarge && (
            <span className="shrink-0 text-[10px] tabular-nums">
              <span className="text-emerald-400">+{git.additions}</span> <span className="text-red-400">−{git.deletions}</span>
            </span>
          )}
        </FoldHeader>
        {/* Beside the header, never inside it: nothing interactive may be nested in a FoldHeader. */}
        <FileRefChip path={file.path} />
      </div>
      {open &&
        (file.tooLarge ? (
          <p className="px-2 py-1.5 text-[11px] text-amber-400">
            This diff is too large to show here — open the file to see it as it is now.
          </p>
        ) : endings ? (
          <p className="px-2 py-1.5 text-[11px] text-[var(--text-dim)]">
            Only the line endings changed, to {endings}: every line reads the same, so the diff of the whole file is not
            drawn.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <FileDiffBody file={git} />
          </div>
        ))}
    </div>
  );
}

/** The files a command changed and kept no diff for: past Claude Code's caps, or not comparable. */
function MoreFiles({ diff, project }: { diff: ToolDiff; project: string }) {
  const [open, setOpen] = useState(diff.otherPaths.length <= 5);
  const count = Math.max(diff.moreFiles, diff.otherPaths.length);
  const listed = diff.otherPaths.length;
  return (
    <div className="mt-1.5 text-[11px] text-[var(--text-dim)]">
      {listed > 0 ? (
        <FoldHeader open={open} onToggle={() => setOpen(!open)} className="flex items-center gap-2 text-left">
          <span className="w-2 shrink-0">{open ? '▾' : '▸'}</span>
          <span>
            {count} {diff.files.length > 0 ? 'more ' : ''}file{count === 1 ? '' : 's'} changed with no diff kept
            {listed < count ? ` — ${listed} of them named` : ''}
          </span>
        </FoldHeader>
      ) : (
        <p>
          {count} {diff.files.length > 0 ? 'more ' : ''}file{count === 1 ? '' : 's'} changed with no diff kept.
        </p>
      )}
      {open && listed > 0 && (
        <ul className="mt-1 ml-4 space-y-0.5">
          {diff.otherPaths.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span className="min-w-0 truncate font-mono">{relativeToProject(p, project)}</span>
              <FileRefChip path={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What a call changed on disk, drawn under its result.
 *
 * **All of it is `data-chrome`.** This is not something the session said: the
 * model never saw it — Claude Code records it beside the result for its own
 * display — so the find bar does not count it and the formatted copy leaves it
 * out. What the call WAS (the command, the edit's strings) is in its input,
 * which is searched as before.
 *
 * A Bash diff is what changed in the folder while the command ran, which is not
 * quite what the command did: another program writing at the same moment lands
 * in it too, and the label says so where it is read rather than on a hover.
 */
export function ToolDiffView({ diff }: { diff: ToolDiff }) {
  const refs = useFileRefs();
  const project = refs?.projectPath ?? '';
  const bash = diff.source === 'bash';
  const more = diff.moreFiles > 0 || diff.otherPaths.length > 0;
  // Nothing to draw: a created file whose input held no content to make lines from.
  if (diff.files.length === 0 && !more && !diff.unavailable) return null;
  return (
    <div data-chrome className="mt-2">
      <div className="text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        {bash ? 'Changed while it ran' : 'Diff'}
        {bash && (
          <span className="ml-2 font-normal tracking-normal normal-case">
            what changed in the folder during the command — it can include other programs’ writes
          </span>
        )}
      </div>
      {diff.shared && (
        <p className="mt-1 text-[11px] text-amber-400">
          Another command was running at the same time, so some of these changes may be its.
        </p>
      )}
      {diff.files.map((f) => (
        <DiffFile key={f.path} file={f} project={project} />
      ))}
      {more && <MoreFiles diff={diff} project={project} />}
      {diff.unavailable && (
        <p className="mt-1.5 text-[11px] text-amber-400">
          Claude Code could not compare the folder for {diff.files.length > 0 || more ? 'some of these files' : 'this command'}.
        </p>
      )}
    </div>
  );
}
