import type { SessionDetail } from '@claude-history/shared';
import { useEffect, useRef, useState } from 'react';
import { downloadMarkdown, type ExportOptions } from '../../lib/exportMarkdown.ts';

export function ExportButton({ detail }: { detail: SessionDetail }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ExportOptions>({ includeTools: true, includeThinking: false, includeSystem: false });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const check = (key: keyof ExportOptions, label: string) => (
    <label className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-xs select-none hover:bg-[var(--bg-hover)]">
      <input
        type="checkbox"
        checked={opts[key]}
        onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
        className="accent-[var(--accent)]"
      />
      {label}
    </label>
  );

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
        title="Export this conversation as a Markdown file"
      >
        Export .md
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 rounded border border-[var(--border)] bg-[var(--bg-raised)] p-2 shadow-xl">
          {check('includeTools', 'Include tool calls')}
          {check('includeThinking', 'Include thinking')}
          {check('includeSystem', 'Include system messages')}
          <button
            type="button"
            onClick={() => {
              downloadMarkdown(detail, opts);
              setOpen(false);
            }}
            className="mt-2 w-full cursor-pointer rounded border border-[var(--accent-dim)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10"
          >
            ⬇ Download
          </button>
        </div>
      )}
    </div>
  );
}
