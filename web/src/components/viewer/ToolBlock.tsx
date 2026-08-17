import type { ContentBlock } from '@claude-history/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { formatBytes } from '../../lib/format.ts';
import { FileRefChip } from './FileRefLink.tsx';
import { FoldHeader } from './FoldHeader.tsx';
import { useFoldable, useRevealed } from './RevealContext.ts';
import { useSubagents } from './SubagentContext.ts';

type ToolContentBlock = Extract<ContentBlock, { kind: 'tool' }>;

/** The tools whose collapsed summary is a file path and nothing else. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * What an Agent call gets back on the spot: 1,084 characters of harness
 * metadata, identical for every call, telling the model not to quote any of it.
 * The answer arrives later as a notification, so printing this verbatim was a
 * screenful of noise standing where the reader looks for a result.
 */
const LAUNCH_NOTE = 'Async agent launched successfully';

function OffloadedResult({
  path,
  sizeBytes,
  autoLoad = false,
}: {
  path: string;
  sizeBytes: number | null;
  /**
   * A search sent the reader here, and the words looked for can be in this file
   * and nowhere else: 34% of the corpus is tool output and the deep scan reads
   * these too. Arriving at a button that says "Load full output" would be
   * arriving at the wrong answer to "show me the hit".
   */
  autoLoad?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .toolResult(path)
      .then((r) => setText(r.text))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };
  const started = loading || text !== null || error !== null;
  useEffect(() => {
    if (autoLoad && !started) load();
    // Once per arrival: the load itself flips `started`, and re-running on it
    // would either loop or re-fetch a file that failed for a reason of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  if (text !== null) {
    return <pre className="mt-1 max-h-96 overflow-auto rounded bg-black/40 p-2 text-xs whitespace-pre-wrap">{text}</pre>;
  }
  return (
    <button
      type="button"
      disabled={loading}
      onClick={load}
      className="mt-1 cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
    >
      {error ? `Failed: ${error}` : loading ? 'Loading…' : `Load full output${sizeBytes ? ` (${formatBytes(sizeBytes)})` : ''}`}
    </button>
  );
}

export function ToolBlock({
  block,
  onOpenAgent,
  costBadge,
  targeted = false,
}: {
  block: ToolContentBlock;
  onOpenAgent?: (agentId: string) => void;
  /** Set on the first call of each assistant message — what that message was billed. */
  costBadge?: ReactNode;
  /** A deep link points at this call: open it, and show the whole of its output. */
  targeted?: boolean;
}) {
  // Two ways to be pointed at, one contract: the deep link's prop and the find
  // bar's context. `useFoldable` is where "open, then let go" lives now.
  const revealKey = block.toolUseId ? `tool:${block.toolUseId}` : null;
  const revealed = useRevealed(revealKey);
  const [open, setOpen] = useFoldable(revealKey, targeted);
  const result = block.result;
  const statusColor = result ? (result.isError ? 'bg-red-400' : 'bg-emerald-400') : 'bg-zinc-500';
  const subagents = useSubagents();
  // The agent's own type is a far better label than the word "subagent" when a
  // run holds five of them; it falls back to the generic one outside a session.
  const agentType = block.agentId ? subagents?.byId.get(block.agentId)?.agentType : null;
  const launched = !!block.agentId && !!result && !result.isError && result.text.startsWith(LAUNCH_NOTE);

  return (
    // The anchor a search result scrolls to and flashes. A data attribute rather
    // than an id: tool ids come out of the transcript and share the document with
    // message uuids, and nothing here needs to be a fragment target.
    <div
      data-tool-id={block.toolUseId || undefined}
      className="my-1.5 rounded border border-[var(--border)] bg-[var(--bg-raised)]/60"
    >
      <div className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs">
        <FoldHeader open={open} onToggle={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="text-[var(--text-dim)]">{open ? '▾' : '▸'}</span>
          <span className={`size-1.5 shrink-0 rounded-full ${statusColor}`} title={result ? (result.isError ? 'Error' : 'OK') : 'No result recorded'} />
          <span className="shrink-0 font-semibold text-sky-300">{block.toolName}</span>
          <span className="truncate font-mono text-[var(--text-dim)]">{block.inputSummary}</span>
        </FoldHeader>
        {/* Gated on the tool NAME, not on the shape of the string: for these
            five the summary IS the `file_path` (parser.ts summarizeInput), so
            there is nothing to guess. A Bash command that happens to contain a
            path is not a file this opens. */}
        {FILE_TOOLS.has(block.toolName) && <FileRefChip path={block.inputSummary} />}
        {costBadge}
        {block.agentId && onOpenAgent && (
          <button
            type="button"
            onClick={() => onOpenAgent(block.agentId!)}
            className="shrink-0 cursor-pointer rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-400 hover:bg-sky-500/25"
            title="Open subagent transcript"
          >
            ⑂ {agentType ?? 'subagent'}
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
          {launched && (
            <div className="mt-2 text-xs text-[var(--text-dim)]">
              Sent out — nothing came back here. Its report arrives further down as a notification, and its own
              transcript is behind the ⑂ button.
            </div>
          )}
          {result && !launched && (
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
              {result.offloadedFile && (
                // The find bar counts none of this file — it is not in the
                // payload — but a reader who lands here from either route is
                // asking to see the output, not a button that fetches it.
                <OffloadedResult path={result.offloadedFile} sizeBytes={null} autoLoad={targeted || revealed} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
