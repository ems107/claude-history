import type {
  MessageUsage,
  PriceTable,
  RecacheCause,
  SessionCostDrivers,
  SessionSummary,
  Turn,
} from '@claude-history/shared';
import { LONG_CONTEXT_TOKENS } from '@claude-history/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { type ContextIndex, formatContextTokens, recacheCauseLabel } from '../../lib/context.ts';
import { formatUsd, priceByModel, type SessionCostParts, sumRecacheCost, summariseRecache } from '../../lib/cost.ts';
import { Fold } from '../Fold.tsx';

/** How many of the large tool results are named one by one. */
const NAMED_RESULTS = 5;

/** One reason, as both the token panel and the Stats page draw it. */
export interface Reason {
  key: string;
  label: ReactNode;
  /** Null when none of it has a price: "—", never a missing row. */
  cost: number | null;
  partial: boolean;
  note: ReactNode;
  /** What it counts and how — every row has one, since two of them are estimates. */
  explain: ReactNode;
  children?: ReactNode;
}

/** Whether a reason holds anything at all, priced or not. */
export const hasTokens = (byModel: Record<string, MessageUsage>): boolean =>
  Object.values(byModel).some((u) => u.input + u.output + u.cacheRead + u.cacheCreate > 0);

function share(cost: number | null, total: number | null): string {
  if (cost === null || total === null || total <= 0) return '';
  const pct = (cost / total) * 100;
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

/** How each reason is counted — the same words wherever it is drawn. */
export const EXPLAIN = {
  recache: (
    <>
      Context that was already cached when a request went out and had to be written again — at the write rate, 2×
      input, instead of the read rate, a tenth of it or less. The figure is what those writes cost; the line under it,
      what they cost beyond a read. Each request says why in its pill.
    </>
  ),
  long: (
    <>
      The whole cost of every request that sent more than {formatContextTokens(LONG_CONTEXT_TOKENS)} tokens of context,
      the threshold Claude Code's <code>/usage</code> uses. Every request re-reads the whole context, so a long one
      costs on every turn; compacting, or starting afresh, is what brings it down.
    </>
  ),
  alwaysOn: (
    <>
      An estimate. The system prompt, the tool definitions, CLAUDE.md, memory and skills go with every request: this is
      taken as the smallest context any request of the session sent, less the first prompt, and the figure is that
      part's share of each request's input (its output is not counted). Claude Code's <code>/usage</code> counts it the
      same way. Fewer tools and MCP servers, and a shorter CLAUDE.md, are what bring it down.
    </>
  ),
  large: (
    <>
      An estimate. A tool result over about 10k tokens (counted at 2.5 characters a token) stays in the context until a
      compaction drops it, and every later request pays to read it again; the figure is the share of each request's
      input those results were. Claude Code's <code>/usage</code> counts it the same way. Reading part of a file
      instead of all of it, or asking for less output, is what brings it down.
    </>
  ),
  max: (
    <>
      The whole cost of every request run at effort <code>max</code>, which thinks the longest and writes the most — the
      level Claude Code's <code>/usage</code> warns about.
    </>
  ),
  agents: (
    <>
      What the agents a session sent out spent, in their own transcripts — the part of the total the session did not
      spend itself. An agent re-reads its own brief and context on every request it makes.
    </>
  ),
  workflow: (
    <>
      What the agents of the Workflow tool spent. They are subagents too, so this is a part of the line above; it is
      named apart because a workflow can start many at once, the way Claude Code's <code>/usage</code> names it.
    </>
  ),
};

/** Re-caches grouped by cause, most expensive first: "the 1-hour cache expired ×8 $45.93 · …". */
export function CauseList({
  causes,
}: {
  causes: Array<{ cause: RecacheCause | null; count: number; cost: number | null; partial: boolean }>;
}) {
  return (
    <>
      {[...causes]
        .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
        .map((c, i) => (
          <span key={c.cause ?? 'none'}>
            {i > 0 && ' · '}
            {recacheCauseLabel(c.cause)} ×{c.count} <span className="tabular-nums">{formatUsd(c.cost, c.partial)}</span>
          </span>
        ))}
    </>
  );
}

/**
 * The rows, most expensive first, each with its share of `total`, and the cost
 * by effort under them — which, unlike the rows, IS a partition, and says so by
 * being a line rather than a row.
 */
export function ReasonList({
  reasons,
  total,
  efforts,
  effortLabel,
  className = '',
}: {
  reasons: Reason[];
  total: number | null;
  efforts: Array<{ effort: string; cost: number | null; partial: boolean }>;
  effortLabel: string;
  className?: string;
}) {
  // An unpriced reason sinks to the end: there is no amount to rank it by.
  const sorted = [...reasons].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1));
  return (
    <>
      <div className={className}>
        {sorted.map((r) => (
          <div key={r.key} className="mb-1.5 rounded border border-[var(--border)] px-2 py-1.5">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 font-mono text-[var(--text)]">{r.label}</span>
              <span className="shrink-0 font-semibold text-[var(--text)] tabular-nums">
                {formatUsd(r.cost, r.partial)}
              </span>
              <span className="w-9 shrink-0 text-right tabular-nums opacity-70">{share(r.cost, total)}</span>
            </div>
            <div className="mt-0.5 text-[11px]">{r.note}</div>
            {r.children}
            <Fold label="how this is counted">
              <span className="text-[11px] text-[var(--text-dim)]">{r.explain}</span>
            </Fold>
          </div>
        ))}
      </div>
      {efforts.length > 0 && (
        <div className="mt-1 text-[11px]">
          <span className="opacity-70">{effortLabel}: </span>
          {[...efforts]
            .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
            .map((x, i) => (
              <span key={x.effort} className="tabular-nums">
                {i > 0 && ' · '}
                {x.effort === 'none' ? 'not recorded' : x.effort} {formatUsd(x.cost, x.partial)}
              </span>
            ))}
        </div>
      )}
    </>
  );
}

/** The sentence every list of reasons opens with, since its rows do not add up. */
export const OVERLAP_NOTE =
  'They overlap — one request can be long, at max effort and carrying a large result all at once — so they do not add up to it.';

/**
 * What made the session expensive: the reasons `/usage` names, priced at this
 * app's rates and with the session's own figures — re-cached context, long
 * context, the always-on context, large tool results, max effort, the agents
 * and a workflow's. Tokens come from the parse (`SessionDetail.costDrivers`,
 * the same tracker the enricher runs for the Stats page) and the re-caches
 * from the context index the rest of the panel draws.
 *
 * **They overlap, and the panel says so before anything else**: its rule is
 * that a figure's place tells how it relates to the others, and these relate
 * to the total only one by one. So they sit below the ledger, each with its
 * share OF the total and none adding up to it.
 */
export function CostDrivers({
  summary,
  turns,
  drivers,
  contextIndex,
  cost,
  prices,
}: {
  summary: SessionSummary;
  turns: Turn[];
  drivers: SessionCostDrivers;
  contextIndex: ContextIndex;
  cost: SessionCostParts;
  prices: PriceTable;
}) {
  const e = summary.enrichment;
  if (!e) return null;
  const reasons: Reason[] = [];

  const recache = summariseRecache(contextIndex.recaches, prices);
  if (recache) {
    const byCause = new Map<RecacheCause | null, typeof contextIndex.recaches>();
    for (const p of contextIndex.recaches) byCause.set(p.recacheCause, [...(byCause.get(p.recacheCause) ?? []), p]);
    const causes = [...byCause.entries()].map(([cause, points]) => {
      const priced = sumRecacheCost(points, prices);
      return { cause, count: points.length, cost: priced?.billed ?? null, partial: priced?.partial ?? false };
    });
    reasons.push({
      key: 'recache',
      label: '↺ re-cached context',
      cost: recache.cost.billed,
      partial: recache.cost.partial,
      note: (
        <>
          <CauseList causes={causes} />
          {recache.cost.extra !== null && (
            <span className="block opacity-80">
              {formatUsd(recache.cost.extra, recache.cost.partial)} more than reading it from the cache would have cost
            </span>
          )}
        </>
      ),
      explain: EXPLAIN.recache,
    });
  }

  if (hasTokens(drivers.longContext)) {
    const n = drivers.counts.longContext;
    reasons.push({
      key: 'long',
      label: 'long context',
      ...priceByModel(drivers.longContext, prices),
      note: `${n} request${n === 1 ? '' : 's'} sent over ${formatContextTokens(LONG_CONTEXT_TOKENS)} tokens`,
      explain: EXPLAIN.long,
    });
  }

  if (hasTokens(drivers.alwaysOn)) {
    reasons.push({
      key: 'always-on',
      label: '≈ always-on context',
      ...priceByModel(drivers.alwaysOn, prices),
      note: `≈${formatContextTokens(Math.round(drivers.alwaysOnTokens))} tokens that every request sent again`,
      explain: EXPLAIN.alwaysOn,
    });
  }

  if (hasTokens(drivers.largeResults)) {
    const blocks = new Map<string, { toolName: string; inputSummary: string }>();
    const wanted = new Set(drivers.largeResultList.map((r) => r.toolUseId));
    for (const turn of turns) {
      for (const item of turn.items) {
        for (const b of item.blocks) if (b.kind === 'tool' && wanted.has(b.toolUseId)) blocks.set(b.toolUseId, b);
      }
    }
    const named = drivers.largeResultList
      .map((r) => ({ ...r, priced: priceByModel(r.byModel, prices) }))
      .sort((a, b) => (b.priced.cost ?? 0) - (a.priced.cost ?? 0));
    const count = named.length;
    reasons.push({
      key: 'large',
      label: '≈ large tool results',
      ...priceByModel(drivers.largeResults, prices),
      note: `${count} result${count === 1 ? '' : 's'} over ≈10k tokens, read again by every request after them`,
      explain: EXPLAIN.large,
      children: (
        <ul className="mt-1 space-y-0.5">
          {named.slice(0, NAMED_RESULTS).map((r) => {
            const block = blocks.get(r.toolUseId);
            return (
              <li key={r.toolUseId} className="flex items-baseline gap-2 text-[11px]">
                <Link
                  to={`?tool=${encodeURIComponent(r.toolUseId)}`}
                  className="min-w-0 flex-1 truncate font-mono hover:underline"
                  title={block ? `${block.toolName} ${block.inputSummary}` : r.toolUseId}
                >
                  {block ? (
                    <>
                      {block.toolName} <span className="opacity-70">{block.inputSummary}</span>
                    </>
                  ) : (
                    r.toolUseId
                  )}
                </Link>
                <span className="shrink-0 tabular-nums opacity-80">
                  ≈{formatContextTokens(Math.round(r.tokens))} · {r.requests} req ·{' '}
                  {formatUsd(r.priced.cost, r.priced.partial)}
                </span>
              </li>
            );
          })}
          {count > NAMED_RESULTS && <li className="text-[11px] opacity-70">and {count - NAMED_RESULTS} more</li>}
        </ul>
      ),
    });
  }

  if (hasTokens(drivers.maxEffort)) {
    const n = drivers.counts.maxEffort;
    reasons.push({
      key: 'max',
      label: 'max effort',
      ...priceByModel(drivers.maxEffort, prices),
      note: `${n} request${n === 1 ? '' : 's'} at effort max`,
      explain: EXPLAIN.max,
    });
  }

  if (hasTokens(e.subagentUsageByModel ?? {})) {
    reasons.push({
      key: 'agents',
      label: (
        <Link to="?agents=1" className="hover:underline">
          ⑂ subagents
        </Link>
      ),
      cost: cost.subagents,
      partial: cost.unpriced.subagents.length > 0,
      note: `${summary.subagentCount} agent${summary.subagentCount === 1 ? '' : 's'}, each in a conversation of its own`,
      explain: EXPLAIN.agents,
    });
  }

  if (hasTokens(e.workflowUsageByModel ?? {})) {
    reasons.push({
      key: 'workflow',
      label: '⑂ workflow agents',
      ...priceByModel(e.workflowUsageByModel, prices),
      note: 'the agents of a Workflow run — part of the subagents above',
      explain: EXPLAIN.workflow,
    });
  }

  const efforts = Object.entries(drivers.byEffort)
    .filter(([, byModel]) => hasTokens(byModel))
    .map(([effort, byModel]) => ({ effort, ...priceByModel(byModel, prices) }));
  if (reasons.length === 0 && efforts.length === 0) return null;

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-2" data-cost-drivers>
      <div className="text-[11px] tracking-wider text-[var(--text-dim)] uppercase">What made it expensive</div>
      <p className="mt-1 mb-2 text-[11px]">Each line is a part of the session total. {OVERLAP_NOTE}</p>
      <ReasonList reasons={reasons} total={cost.total} efforts={efforts} effortLabel="by effort, this conversation" />
    </div>
  );
}
