import type { ContentBlock } from '@claude-history/shared';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { formatBytes } from '../../lib/format.ts';

type ToolContentBlock = Extract<ContentBlock, { kind: 'tool' }>;

function OffloadedResult({ path, sizeBytes }: { path: string; sizeBytes: number | null }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (text !== null) {
    return <pre className="mt-1 max-h-96 overflow-auto rounded bg-black/40 p-2 text-xs whitespace-pre-wrap">{text}</pre>;
  }
  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        api
          .toolResult(path)
          .then((r) => setText(r.text))
          .catch((e) => setError(String(e)))
          .finally(() => setLoading(false));
      }}
      className="mt-1 cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
    >
      {error ? `Failed: ${error}` : loading ? 'Loading…' : `Load full output${sizeBytes ? ` (${formatBytes(sizeBytes)})` : ''}`}
    </button>
  );
}

export function ToolBlock({
  block,
  onOpenAgent,
}: {
  block: ToolContentBlock;
  onOpenAgent?: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const result = block.result;
  const statusColor = result ? (result.isError ? 'bg-red-400' : 'bg-emerald-400') : 'bg-zinc-500';

  return (
    <div className="my-1.5 rounded border border-[var(--border)] bg-[var(--bg-raised)]/60">
      <div className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <span className="text-[var(--text-dim)]">{open ? '▾' : '▸'}</span>
          <span className={`size-1.5 shrink-0 rounded-full ${statusColor}`} title={result ? (result.isError ? 'Error' : 'OK') : 'No result recorded'} />
          <span className="shrink-0 font-semibold text-sky-300">{block.toolName}</span>
          <span className="truncate font-mono text-[var(--text-dim)]">{block.inputSummary}</span>
        </button>
        {block.agentId && onOpenAgent && (
          <button
            type="button"
            onClick={() => onOpenAgent(block.agentId!)}
            className="shrink-0 cursor-pointer rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-400 hover:bg-sky-500/25"
            title="Open subagent transcript"
          >
            ⑂ subagent
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-[var(--border)] px-2 py-1.5">
          {block.input !== null && block.input !== undefined && (
            <>
              <div className="mb-1 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">Input</div>
              <pre className="max-h-64 overflow-auto rounded bg-black/40 p-2 text-xs whitespace-pre-wrap">
                {JSON.stringify(block.input, null, 2)}
              </pre>
            </>
          )}
          {result && (
            <>
              <div className="mt-2 mb-1 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
                Result{result.isError ? ' (error)' : ''}
                {result.truncated && (
                  <span className="ml-2 normal-case text-amber-400">
                    truncated — {result.totalChars.toLocaleString()} chars total
                  </span>
                )}
              </div>
              <pre
                className={`max-h-96 overflow-auto rounded bg-black/40 p-2 text-xs whitespace-pre-wrap ${result.isError ? 'text-red-300' : ''}`}
              >
                {result.text}
              </pre>
              {result.offloadedFile && <OffloadedResult path={result.offloadedFile} sizeBytes={null} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
