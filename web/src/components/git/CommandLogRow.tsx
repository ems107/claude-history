import type { GitCommandLogEntry } from '@claude-history/shared';
import { useState } from 'react';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatDateTime } from '../../lib/format.ts';
import { commandLine, pasteableCommand } from '../../lib/gitCommand.ts';
import { FoldHeader } from '../viewer/FoldHeader.tsx';

/** Time only — the panel is a running log, not a diary. */
function clockTime(iso: string): string {
  const at = iso.indexOf('T');
  return at < 0 ? iso : iso.slice(at + 1, at + 13);
}

export function CommandLogRow({ entry }: { entry: GitCommandLogEntry }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const failed = entry.exitCode !== 0 && entry.exitCode !== null;
  const running = entry.exitCode === null;

  return (
    <div className={`border-b border-[var(--border)]/40 ${failed ? 'border-l-2 border-l-red-500/50' : ''}`}>
      <div className="group flex items-start gap-2 px-2 py-0.5 font-mono text-[11px] hover:bg-[var(--bg-hover)]/40">
        <FoldHeader
          open={open}
          onToggle={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-start gap-2"
          title={formatDateTime(entry.at)}
        >
          <span className="w-2 shrink-0 text-[var(--text-dim)]">{open ? '▾' : '▸'}</span>
          <span className="shrink-0 text-[var(--text-dim)] opacity-70">{clockTime(entry.at)}</span>
          {entry.repoName && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{entry.repoName}</span>}
          <span
            className={`min-w-0 flex-1 ${open ? 'break-all whitespace-pre-wrap' : 'truncate'} ${
              running ? 'text-amber-400' : failed ? 'text-red-400' : entry.mutation ? 'text-[var(--text)]' : 'text-[var(--text)]/75'
            }`}
          >
            {open ? `git ${entry.argv.join(' ')}` : commandLine(entry.argv)}
          </span>
          <span className="shrink-0 tabular-nums text-[var(--text-dim)]">
            {running ? 'running' : `exit ${entry.exitCode}`} · {entry.durationMs} ms
          </span>
        </FoldHeader>
        {/* A sibling, never nested: nothing interactive may live inside a FoldHeader. */}
        <button
          type="button"
          title="Copy this command with its folder, ready to paste"
          onClick={() => {
            void copyPlain(pasteableCommand(entry.argv, entry.cwd)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1_200);
            });
          }}
          className="shrink-0 cursor-pointer px-1 text-[10px] text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:text-[var(--text)]"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      {open && (
        <div className="space-y-1 px-2 pb-1.5 pl-[6.5rem] text-[11px] select-text">
          <p className="text-[var(--text-dim)]">
            in <span className="font-mono break-all">{entry.cwd}</span>
            {!entry.mutation && <span className="ml-2 opacity-70">(a read)</span>}
            {entry.timedOut && <span className="ml-2 text-red-400">timed out and was stopped</span>}
            {entry.aborted && <span className="ml-2 text-amber-400">cancelled</span>}
          </p>
          {entry.stdinPreview && (
            <pre className="max-h-32 overflow-auto rounded bg-black/40 p-2 whitespace-pre-wrap">
              stdin: {entry.stdinPreview}
            </pre>
          )}
          {entry.stdout && (
            <pre className="max-h-64 overflow-auto rounded bg-black/40 p-2 whitespace-pre-wrap">{entry.stdout}</pre>
          )}
          {entry.stderr && (
            <pre className="max-h-64 overflow-auto rounded bg-black/40 p-2 whitespace-pre-wrap text-red-300/80">
              {entry.stderr}
            </pre>
          )}
          {!entry.stdout && !entry.stderr && <p className="text-[var(--text-dim)] italic">It printed nothing.</p>}
          {entry.truncated && <p className="text-amber-400">Output longer than what is kept here.</p>}
        </div>
      )}
    </div>
  );
}
