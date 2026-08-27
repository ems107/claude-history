import type { ContentBlock } from '@claude-history/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { formatBytes, formatDateTime, formatMs, formatTimeOfDay, msBetween } from '../../lib/format.ts';
import { FileRefChip } from './FileRefLink.tsx';
import { FoldHeader } from './FoldHeader.tsx';
import { CardLine, HoverCard } from './HoverCard.tsx';
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
      data-chrome
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
  // The call's own wall time: its tool_use line's clock to its result line's.
  // Null while nothing has come back — a call with no result keeps its clock
  // and claims no span. For a launched Agent this is the dispatch, not the run:
  // the subagent's own lifetime lives in its panel.
  const tookMs = msBetween(block.timestamp, result?.timestamp ?? null);

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
          {/* `data-chrome` on the caret and on everything after the header: the
              box's message text is exactly what `findInSession` folds — name,
              intent, summary, input, result — and nothing else in it may be
              marked, counted or pasted by the formatted copy. */}
          <span data-chrome className="text-[var(--text-dim)]">
            {open ? '▾' : '▸'}
          </span>
          <span className={`size-1.5 shrink-0 rounded-full ${statusColor}`} title={result ? (result.isError ? 'Error' : 'OK') : 'No result recorded'} />
          {/* Time of day only on the face — the date is already said by the
              message headers around the run, and lives on the hover. Inside the
              FoldHeader, which its rule allows: a HoverCard takes no click, so
              the header keeps folding through it. `data-chrome` because this is
              text in the marking box that is not the message's own words: the
              find bar must not mark a clock.

              Two fixed columns, not one prose blob: the hour is always 8ch and
              the span right-aligns in a reserved column — kept even when empty,
              so a resultless call does not shift its name — which is what lines
              the tool names up down a run. A span longer than the column (a
              minutes-long call) pushes its own row wider, and sticking out is
              the right look for it. */}
          {block.timestamp && (
            <span data-chrome className="shrink-0">
              <HoverCard
                pill={
                  <span className="flex items-baseline gap-2">
                    <span className="opacity-70">{formatTimeOfDay(block.timestamp)}</span>
                    <span className="inline-block min-w-[6ch] text-right">{tookMs !== null ? formatMs(tookMs) : ''}</span>
                  </span>
                }
              >
                <CardLine label="called" value={formatDateTime(block.timestamp)} />
                {result?.timestamp && <CardLine label="result" value={formatDateTime(result.timestamp)} />}
                {tookMs !== null && <CardLine label="took" value={formatMs(tookMs)} />}
              </HoverCard>
            </span>
          )}
          <span className="shrink-0 font-semibold text-sky-300">{block.toolName}</span>
          {/* One truncating box, two voices: what the model said it was doing
              (`intent`) and what it literally ran. One ellipsis, at the end, and
              the prose gets the room — a Bash command is usually a path and a
              flag, and the sentence beside it is the only thing that says why.
              The order is the contract `findInSession` folds against; the
              separation is margin, never a character, so the two corpora cannot
              disagree about what is in this box. */}
          <span className="min-w-0 flex-1 truncate">
            {block.intent && <span className="text-[var(--text)]">{block.intent}</span>}
            <span className={`font-mono text-[var(--text-dim)] ${block.intent ? 'ml-2' : ''}`}>
              {block.inputSummary}
            </span>
          </span>
        </FoldHeader>
        {costBadge && (
          <span data-chrome className="flex shrink-0 items-center gap-2">
            {costBadge}
          </span>
        )}
        {block.agentId && onOpenAgent && (
          <button
            type="button"
            data-chrome
            onClick={() => onOpenAgent(block.agentId!)}
            className="shrink-0 cursor-pointer rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-400 hover:bg-sky-500/25"
            title="Open subagent transcript"
          >
            ⑂ {agentType ?? 'subagent'}
          </button>
        )}
        {/* Last in the row, after every badge. Gated on the tool NAME, not on
            the shape of the string: for these five the summary IS the
            `file_path` (parser.ts summarizeInput), so there is nothing to
            guess. A Bash command that happens to contain a path is not a file
            this opens. */}
        {FILE_TOOLS.has(block.toolName) && <FileRefChip path={block.inputSummary} />}
      </div>
      {open && (
        <div className="border-t border-[var(--border)] px-2 py-1.5">
          {block.input !== null && block.input !== undefined && (
            <>
              <div data-chrome className="mb-1 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
                Input
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-black/40 p-2 text-xs whitespace-pre-wrap">
                {JSON.stringify(block.input, null, 2)}
              </pre>
            </>
          )}
          {launched && (
            <div data-chrome className="mt-2 text-xs text-[var(--text-dim)]">
              Sent out — nothing came back here. Its report arrives further down as a notification, and its own
              transcript is behind the ⑂ button.
            </div>
          )}
          {result && !launched && (
            <>
              <div data-chrome className="mt-2 mb-1 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
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
