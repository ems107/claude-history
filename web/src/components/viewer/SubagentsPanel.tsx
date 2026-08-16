import type { PriceTable, SubagentDetail, SubagentMeta } from '@claude-history/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { api } from '../../api/client.ts';
import { type CostEntry, costEntries, formatTokens, formatUsd, sumCost, sumUsage } from '../../lib/cost.ts';
import { durationBetween, formatDateTime, formatDateTimeFull } from '../../lib/format.ts';
import { promptOf, rowStatus, type SubagentRow } from '../../lib/subagents.ts';
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

/**
 * Where a nested agent really belongs. An agent can spawn agents of its own
 * (`spawnDepth` 2 and up): their transcripts sit in the session's directory
 * like any other, so they are listed and their cost counts, but the call that
 * created them and the report they filed are inside their PARENT's transcript
 * and nowhere near this conversation. Saying "no report" and greying the
 * buttons was true of the session and useless to the reader.
 */
interface Nesting {
  parent: SubagentMeta;
  /** The call, in the parent's transcript. */
  toolUseId: string;
  /** When that call was made — the row's "sent", which the session cannot supply. */
  sentAt: string | null;
  /** The brief it was given, from the call in the parent's transcript. */
  prompt: string | null;
  /** The item of the parent's transcript that carries its report, when it filed one. */
  reportUuid: string | null;
  reportAt: string | null;
  reportStatus: string | null;
  /** And the report itself, so a nested row folds open exactly like a top-level one. */
  result: string | null;
}

/**
 * The list as a tree: every agent an agent spawned goes directly under it,
 * indented, in the order it was sent out. The alternative is a flat list where
 * four agents sit at the top level saying "sent out by …" and the reader has to
 * reassemble who belongs to whom by reading eleven lines of prose.
 *
 * Rows whose parent is not in this list (there should be none — a parent is by
 * definition one of the session's agents) are appended at the end rather than
 * dropped: a row nobody can see is a worse answer than a row out of place.
 */
function asTree(rows: SubagentRow[], nesting: Map<string, Nesting>): { row: SubagentRow; depth: number }[] {
  const children = new Map<string, SubagentRow[]>();
  for (const row of rows) {
    const under = nesting.get(row.meta.agentId);
    if (!under) continue;
    const list = children.get(under.parent.agentId) ?? [];
    list.push(row);
    children.set(under.parent.agentId, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => (nesting.get(a.meta.agentId)?.sentAt ?? '').localeCompare(nesting.get(b.meta.agentId)?.sentAt ?? ''));
  }

  const out: { row: SubagentRow; depth: number }[] = [];
  const placed = new Set<string>();
  const place = (row: SubagentRow, depth: number): void => {
    if (placed.has(row.meta.agentId)) return; // a cycle cannot happen, but nothing here depends on that
    placed.add(row.meta.agentId);
    out.push({ row, depth });
    for (const child of children.get(row.meta.agentId) ?? []) place(child, depth + 1);
  };
  for (const row of rows) {
    if (!nesting.has(row.meta.agentId)) place(row, 0);
  }
  for (const row of rows) place(row, 0);
  return out;
}

function StatusChip({ row, nesting }: { row: SubagentRow; nesting: Nesting | null }) {
  const status = nesting ? (nesting.reportStatus ?? 'unknown') : rowStatus(row);
  const where = nesting ? ` — it reported to ⑂ ${nesting.parent.agentType}, the agent that spawned it` : '';
  if (status === 'failed') {
    return (
      <span className="shrink-0 text-[10px] font-semibold tracking-wider text-red-400 uppercase" title={`It failed${where}`}>
        failed
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span
        className="shrink-0 text-[10px] font-semibold tracking-wider text-emerald-400/80 uppercase"
        title={`It finished${where}`}
      >
        completed
      </span>
    );
  }
  return (
    <span
      className="shrink-0 text-[10px] tracking-wider text-[var(--text-dim)] uppercase"
      title={
        nesting
          ? `No report from it in ⑂ ${nesting.parent.agentType}, the agent that spawned it`
          : 'This transcript holds no report from it — it was still running when the session ended, or the notification fell outside what is left of the file'
      }
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

/**
 * One of the two jumps. Disabled it still says where the thing is — a dead
 * button that explains nothing is the bug this whole panel exists to undo.
 */
function JumpButton({ label, jump }: { label: string; jump: { run: (() => void) | null; why: string } }) {
  return (
    <button
      type="button"
      disabled={!jump.run}
      onClick={jump.run ?? undefined}
      className={
        jump.run
          ? 'cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 hover:border-[var(--text-dim)] hover:text-[var(--text)]'
          : 'cursor-default rounded border border-[var(--border)] px-1.5 py-0.5 opacity-40'
      }
      title={jump.why}
    >
      {label}
    </button>
  );
}

function AgentRow({
  row,
  depth,
  figures,
  prices,
  loading,
  active,
  nesting,
}: {
  row: SubagentRow;
  /** How deep under the session this agent sits: 0 for one it sent out itself. */
  depth: number;
  figures: AgentFigures | null;
  prices: PriceTable;
  loading: boolean;
  active: boolean;
  /** Set when another agent spawned this one, which is where both its ends are. */
  nesting: Nesting | null;
}) {
  const subagents = useSubagents();
  const { meta, call, reports } = row;
  const reported = reports[reports.length - 1] ?? null;
  // A nested agent was sent out and reported back inside its parent's
  // transcript, so both of its times come from there.
  const sentTime = call?.timestamp ?? nesting?.sentAt ?? null;
  const backTime = reported?.timestamp ?? nesting?.reportAt ?? null;
  const brief = call?.prompt ?? nesting?.prompt ?? null;
  const results = reports.length
    ? reports.flatMap((r) => (r.result ? [{ key: r.uuid, text: r.result }] : []))
    : nesting?.reportUuid && nesting.result
      ? [{ key: nesting.reportUuid, text: nesting.result }]
      : [];
  // Each of the two jumps goes to the session's conversation or into the parent
  // agent's drawer, depending on where the thing being pointed at actually is.
  const goToCall = call
    ? { run: () => subagents?.goToCall(call.toolUseId), why: 'Go to the call that sent it out' }
    : nesting
      ? {
          run: () => subagents?.openAgent(nesting.parent.agentId, { tool: nesting.toolUseId }),
          why: `Go to the call, inside ⑂ ${nesting.parent.agentType} — the agent that spawned it`,
        }
      : { run: null, why: 'Its call is not in this transcript, and no agent of this session holds it either' };
  const goToReport = reported
    ? { run: () => subagents?.goToMessage(reported.uuid), why: 'Go to where it reported back' }
    : nesting?.reportUuid
      ? {
          run: () => subagents?.openAgent(nesting.parent.agentId, { msg: nesting.reportUuid ?? undefined }),
          why: `Go to its report, inside ⑂ ${nesting.parent.agentType} — the agent that spawned it`,
        }
      : { run: null, why: 'It never reported back into this conversation' };

  return (
    <div
      // Indented under whoever sent it out, with a rail on the left so the
      // parentage reads at a glance instead of from the line below. An inline
      // margin because the depth is data — Tailwind cannot make a class from it.
      style={depth > 0 ? { marginLeft: `${depth * 1.5}rem` } : undefined}
      className={`mb-1 rounded border px-2 py-1.5 ${
        active ? 'border-sky-500/40 bg-sky-500/5' : 'border-[var(--border)]'
      } ${depth > 0 ? 'border-l-2 border-l-sky-500/30' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-sky-400 uppercase">
          ⑂ {meta.agentType}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium" title={meta.description}>
          {meta.description || meta.agentId}
        </span>
        {/* The id itself, because it is what the URL carries, what a
            notification calls this agent, and what the search now finds. */}
        <span
          className="shrink-0 font-mono text-[10px] text-[var(--text-dim)] opacity-60 select-text"
          title={`Subagent id: ${meta.agentId} — paste it into the search to come back here`}
        >
          {meta.agentId}
        </span>
        <StatusChip row={row} nesting={nesting} />
        {figures && <CostPill entries={figures.entries} prices={prices} variant="badge" />}
      </div>
      {nesting && (
        <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">
          ↳ sent out by{' '}
          <button
            type="button"
            onClick={() => subagents?.openAgent(nesting.parent.agentId)}
            className="cursor-pointer text-sky-400 hover:underline"
            title="Open the agent that spawned it"
          >
            ⑂ {nesting.parent.agentType} · {nesting.parent.description}
          </button>
          , so its call and its report are in that transcript
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-dim)]">
        {sentTime && (
          <span title={`Sent out at ${formatDateTimeFull(sentTime)}`}>sent {formatDateTime(sentTime)}</span>
        )}
        {backTime && (
          <span title={`Reported back at ${formatDateTimeFull(backTime)}`}>
            → back {formatDateTime(backTime)}
            {durationBetween(sentTime, backTime) ? ` · ${durationBetween(sentTime, backTime)}` : ''}
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
        <JumpButton label="↑ the call" jump={goToCall} />
        <JumpButton label="↓ the report" jump={goToReport} />
      </div>
      {/* The brief and the report read the same whether they came from this
          conversation or from the transcript of the agent that spawned it. */}
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        {brief && (
          <Fold label={`brief · ${formatTokens(brief.length)} chars`}>
            <pre className="max-h-96 overflow-auto text-[11px] whitespace-pre-wrap text-[var(--text-dim)]">{brief}</pre>
          </Fold>
        )}
        {results.map(({ key, text }, i) => (
          <Fold key={key} label={`report${results.length > 1 ? ` ${i + 1}` : ''} · ${formatTokens(text.length)} chars`}>
            <Markdown text={text} />
          </Fold>
        ))}
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
 * The cost here is the same money the session total counts — it is added to the
 * session's own spend in the token panel, in the list and in the stats — but
 * this is the only place it is broken down per agent, and where the ones worth
 * looking at (the $4.31 among ten cheap ones) become visible.
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
  /**
   * Which agent spawned which. An agent's own transcript is where its Agent
   * calls and the reports they send back are recorded, so the transcripts we
   * already have in hand answer it: whoever's transcript holds the call IS the
   * parent. Cheap enough to do on render — a few hundred blocks over transcripts
   * that are already parsed and cached.
   */
  const nesting = new Map<string, Nesting>();
  {
    const callerOf = new Map<string, SubagentMeta>();
    const sentAt = new Map<string, string | null>();
    const briefOf = new Map<string, string | null>();
    const reportOf = new Map<string, { uuid: string; at: string | null; status: string | null; result: string | null }>();
    details.forEach((q, i) => {
      if (!q.data) return;
      const owner = rows[i].meta;
      for (const turn of q.data.turns) {
        for (const item of turn.items) {
          for (const block of item.blocks) {
            if (block.kind === 'tool' && block.toolUseId) {
              callerOf.set(block.toolUseId, owner);
              sentAt.set(block.toolUseId, item.timestamp);
              briefOf.set(block.toolUseId, promptOf(block.input));
            }
            if (block.kind === 'notice' && block.taskId) {
              reportOf.set(block.taskId, {
                uuid: item.uuid,
                at: item.timestamp,
                status: block.status,
                result: block.result,
              });
            }
          }
        }
      }
    });
    for (const row of rows) {
      // Its call is in the conversation: an agent of the session, not of an agent.
      if (row.call || !row.meta.toolUseId) continue;
      const parent = callerOf.get(row.meta.toolUseId);
      if (!parent) continue;
      const report = reportOf.get(row.meta.agentId);
      nesting.set(row.meta.agentId, {
        parent,
        toolUseId: row.meta.toolUseId,
        sentAt: sentAt.get(row.meta.toolUseId) ?? null,
        prompt: briefOf.get(row.meta.toolUseId) ?? null,
        reportUuid: report?.uuid ?? null,
        reportAt: report?.at ?? null,
        reportStatus: report?.status ?? null,
        result: report?.result ?? null,
      });
    }
  }
  const ordered = asTree(rows, nesting);
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
          (each one its own conversation — counted in the session total, and in none of its messages)
        </span>
      </div>
      {ordered.map(({ row, depth }) => {
        const i = rows.indexOf(row);
        return (
          <AgentRow
            key={row.meta.agentId}
            row={row}
            depth={depth}
            figures={figures[i]}
            prices={prices}
            loading={details[i]?.isLoading ?? false}
            active={row.meta.agentId === openAgentId}
            nesting={nesting.get(row.meta.agentId) ?? null}
          />
        );
      })}
    </div>
  );
}
