import type { GitDiffLineKind, GitFileDiff, GitHunk } from '@claude-history/shared';
import { useState } from 'react';
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

function Hunk({ hunk }: { hunk: GitHunk }) {
  return (
    <>
      {hunk.gapBefore > 0 && (
        <div className="px-2 py-0.5 text-center text-[10px] text-[var(--text-dim)] select-none">
          ⋮ {hunk.gapBefore} unchanged line{hunk.gapBefore === 1 ? '' : 's'}
        </div>
      )}
      <div className="bg-[var(--bg-raised)] px-2 py-0.5 font-mono text-[11px] text-sky-300/70">{hunk.header}</div>
      {hunk.lines.map((line, i) => (
        <div key={i} className={`flex font-mono text-[11px] leading-[18px] ${TONE[line.kind]}`}>
          {/* The gutters are select-none so copying a hunk does not drag line
              numbers along with the code. */}
          <span className="w-12 shrink-0 pr-2 text-right tabular-nums opacity-50 select-none">{line.oldNo ?? ''}</span>
          <span className="w-12 shrink-0 pr-2 text-right tabular-nums opacity-50 select-none">{line.newNo ?? ''}</span>
          <span className="w-4 shrink-0 text-center opacity-60 select-none">{SIGN[line.kind]}</span>
          <span className="min-w-0 flex-1 pr-4 whitespace-pre select-text">{line.text}</span>
        </div>
      ))}
    </>
  );
}

function FileDiff({ file, openByDefault }: { file: GitFileDiff; openByDefault: boolean }) {
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
            file.hunks.map((hunk, i) => <Hunk key={i} hunk={hunk} />)
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
}: {
  files: GitFileDiff[];
  truncated: boolean;
  selectedPath: string | null;
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
        <FileDiff key={file.path} file={file} openByDefault={files.length <= 6 || file.path === selectedPath} />
      ))}
    </>
  );
}
