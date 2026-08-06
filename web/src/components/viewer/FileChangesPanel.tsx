import type { FileChange } from '@claude-history/shared';
import { useState } from 'react';
import { formatDateTime } from '../../lib/format.ts';

function EditBlock({ edit }: { edit: FileChange['edits'][number] }) {
  return (
    <div className="mb-2 rounded border border-[var(--border)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-dim)]">
        <span className="rounded bg-sky-500/15 px-1.5 py-px font-semibold text-sky-400 uppercase">{edit.tool}</span>
        {edit.timestamp && <span>{formatDateTime(edit.timestamp)}</span>}
        {edit.truncated && <span className="text-amber-400">truncated</span>}
      </div>
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
    </div>
  );
}

export function FileChangesPanel({ fileChanges }: { fileChanges: FileChange[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-raised)]/50 px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        Files touched in this transcript — {fileChanges.length}
        <span className="ml-2 font-normal normal-case opacity-70">
          (from Edit/Write tool calls; subagent edits live in their own transcripts)
        </span>
      </div>
      {fileChanges.map((fc) => {
        const isOpen = open.has(fc.path);
        const first = fc.edits[0]?.timestamp;
        const last = fc.edits[fc.edits.length - 1]?.timestamp;
        return (
          <div key={fc.path} className="mb-1">
            <button
              type="button"
              onClick={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(fc.path)) next.delete(fc.path);
                  else next.add(fc.path);
                  return next;
                })
              }
              className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-[var(--bg-hover)]"
            >
              <span className="text-[var(--text-dim)]">{isOpen ? '▾' : '▸'}</span>
              <span className="min-w-0 flex-1 truncate font-mono" title={fc.path}>
                {fc.path}
              </span>
              <span className="shrink-0 text-[var(--text-dim)]">
                {fc.edits.length} edit{fc.edits.length !== 1 ? 's' : ''}
                {first && ` · ${formatDateTime(first)}${last && last !== first ? ` → ${formatDateTime(last)}` : ''}`}
              </span>
            </button>
            {isOpen && (
              <div className="mt-1 ml-5">
                {fc.edits.map((edit, i) => (
                  <EditBlock key={i} edit={edit} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
