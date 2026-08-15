import type { PriceTable, SubagentDetail } from '@claude-history/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { api } from '../../api/client.ts';
import { type CostEntry, costEntries, formatTokens, formatUsd, sumCost, sumUsage } from '../../lib/cost.ts';
import { durationBetween, formatDateTime, formatDateTimeFull } from '../../lib/format.ts';
import { rowStatus, type SubagentRow } from '../../lib/subagents.ts';
import { CostPill } from './CostPill.tsx';
import { FoldHeader } from './FoldHeader.tsx';
import { Markdown } from './Markdown.tsx';
import { useSubagents } from './SubagentContext.ts';

const NO_PRICES: PriceTable = {};

/** What a subagent's own transcript says about itself, once it has been read. */
interface AgentFigures {
  entries: CostEntry[];
  messages: number;
  toolCalls: number;
  duration: string | null;
}

function figuresOf(detail: SubagentDetail | undefined, prices: PriceTable): AgentFigures | null {
  if (!detail) return null;
  const items = detail.turns.flatMap((t) => t.items);
  const first = items[0]?.timestamp ?? null;
  const last = items[items.length - 1]?.endTimestamp ?? null;
  return {
    // The same function the drawer prices its header with, so a row and the
    // drawer it opens can never disagree — and the one that knows a subagent
    // writes 5-minute caches, which cost 1.25x input and not the session's 2x.
    entries: costEntries(items, prices),
    messages: items.length,
    toolCalls: items.reduce((n, i) => n + i.blocks.filter((b) => b.kind === 'tool').length, 0),
    duration: durationBetween(first, last),
  };
}

function StatusChip({ row }: { row: SubagentRow }) {
  const status = rowStatus(row);
  if (status === 'failed') {
    return <span className="shrink-0 text-[10px] font-semibold tracking-wider text-red-400 uppercase">failed</span>;
  }
  if (status === 'completed') {
    return (
      <span className="shrink-0 text-[10px] font-semibold tracking-wider text-emerald-400/80 uppercase">completed</span>
    );
  }
  return (
    <span
      className="shrink-0 text-[10px] tracking-wider text-[var(--text-dim)] uppercase"
      title="This transcript holds no report from it — it was still running when the session ended, or the notification fell outside what is left of the file"
    >
      no report
    </span>
  );
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FoldHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        className="rounded px-1 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        {open ? '▾' : '▸'} {label}
      </FoldHeader>
      {open && (
        <div className="mt-1 mb-1 ml-4 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">{children}</div>
      )}
    </>
  );
}

function AgentRow({
  row,
  figures,
  prices,
  loading,
  active,
}: {
  row: SubagentRow;
  figures: AgentFigures | null;
  prices: PriceTable;
  loading: boolean;
  active: boolean;
}) {
  const subagents = useSubagents();
  const { meta, call, reports } = row;
  const reported = reports[reports.length - 1] ?? null;

  return (
    <div
      className={`mb-1 rounded border px-2 py-1.5 ${
        active ? 'border-sky-500/40 bg-sky-500/5' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-sky-400 uppercase">
          ⑂ {meta.agentType}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium" title={meta.description}>
          {meta.description || meta.agentId}
        </span>
        <StatusChip row={row} />
        {figures && <CostPill entries={figures.entries} prices={prices} variant="badge" />}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-dim)]">
        {call?.timestamp && (
          <span title={`Sent out at ${formatDateTimeFull(call.timestamp)}`}>
            sent {formatDateTime(call.timestamp)}
          </span>
        )}
        {reported?.timestamp && (
          <span title={`Reported back at ${formatDateTimeFull(reported.timestamp)}`}>
            → back {formatDateTime(reported.timestamp)}
            {call?.timestamp && durationBetween(call.timestamp, reported.timestamp)
              ? ` · ${durationBetween(call.timestamp, reported.timestamp)}`
              : ''}
          </span>
        )}
        {figures && (
          <span title="Inside its own transcript, which is a conversation of its own">
            {figures.messages} messages · {figures.toolCalls} tool calls
            {figures.duration ? ` · ${figures.duration}` : ''}
          </span>
        )}
        {loading && <span>reading its transcript…</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => subagents?.openAgent(meta.agentId)}
          className="cursor-pointer rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-400 hover:bg-sky-500/25"
          title="Open its own transcript"
        >
          ⑂ transcript
        </button>
        <button
          type="button"
          disabled={!call}
          onClick={call ? () => subagents?.goToCall(call.toolUseId) : undefined}
          className={
            call
              ? 'cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 hover:border-[var(--text-dim)] hover:text-[var(--text)]'
              : 'cursor-default rounded border border-[var(--border)] px-1.5 py-0.5 opacity-40'
          }
          title={call ? 'Go to the call that sent it out' : 'Its call is not in this transcript — a fork copies none of them'}
        >
          ↑ the call
        </button>
        <button
          type="button"
          disabled={!reported}
          onClick={reported ? () => subagents?.goToMessage(reported.uuid) : undefined}
          className={
            reported
              ? 'cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 hover:border-[var(--text-dim)] hover:text-[var(--text)]'
              : 'cursor-default rounded border border-[var(--border)] px-1.5 py-0.5 opacity-40'
          }
          title={reported ? 'Go to where it reported back' : 'It never reported back into this conversation'}
        >
          ↓ the report
        </button>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        {call?.prompt && (
          <Fold label={`brief · ${formatTokens(call.prompt.length)} chars`}>
            <pre className="max-h-96 overflow-auto text-[11px] whitespace-pre-wrap text-[var(--text-dim)]">
              {call.prompt}
            </pre>
          </Fold>
        )}
        {reports.map((report, i) =>
          report.result ? (
            <Fold
              key={report.uuid}
              label={`report${reports.length > 1 ? ` ${i + 1}` : ''} · ${formatTokens(report.result.length)} chars`}
            >
              <Markdown text={report.result} />
            </Fold>
          ) : null,
        )}
      </div>
    </div>
  );
}

/**
 * Every agent this session sent out, in launch order: what it was asked, what
 * it reported back, what it cost, and the three ways into it.
 *
 * The figures come from each agent's own transcript, fetched under the SAME
 * query key the drawer uses — so nothing is read twice and opening one
 * afterwards is instant. Measured on this machine: 350-500 KB and ~20 ms each.
 *
 * That cost is NOT part of the session total anywhere else in the app: a
 * subagent is its own API conversation, enriched nowhere, and one session here
 * spends 43% again on top of its parent. This panel is the only place it shows.
 */
export function SubagentsPanel({
  sessionId,
  rows,
  openAgentId,
}: {
  sessionId: string;
  rows: SubagentRow[];
  /** The one whose transcript is open in the drawer, marked so the two agree. */
  openAgentId: string | null;
}) {
  const pricesQ = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  const prices = pricesQ.data?.prices ?? NO_PRICES;
  const details = useQueries({
    queries: rows.map((row) => ({
      queryKey: ['subagent', sessionId, row.meta.agentId],
      queryFn: () => api.subagent(sessionId, row.meta.agentId),
      staleTime: 5 * 60_000,
    })),
  });

  const figures = details.map((q) => figuresOf(q.data, prices));
  const allEntries = figures.flatMap((f) => f?.entries ?? []);
  const total = sumCost(allEntries);
  const usage = sumUsage(allEntries);
  const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheCreate;

  return (
    <div className="max-h-[45vh] overflow-y-auto border-b border-[var(--border)] bg-[var(--bg-raised)]/50 px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        Subagents — {rows.length}
        {tokens > 0 && (
          <span className="ml-2 font-normal normal-case">
            {formatTokens(tokens)} tokens · {formatUsd(total)}
          </span>
        )}
        <span className="ml-2 font-normal normal-case opacity-70">
          (each one its own conversation — this spend is NOT part of the session total)
        </span>
      </div>
      {rows.map((row, i) => (
        <AgentRow
          key={row.meta.agentId}
          row={row}
          figures={figures[i]}
          prices={prices}
          loading={details[i]?.isLoading ?? false}
          active={row.meta.agentId === openAgentId}
        />
      ))}
    </div>
  );
}
