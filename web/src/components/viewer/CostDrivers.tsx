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

interface Reason {
  key: string;
  label: ReactNode;
  /** Null when none of it has a price: "—", never a missing row. */
  cost: number | null;
  partial: boolean;
  note: ReactNode;
  /** What it counts and how — every row has one, since half of them are estimates. */
  explain: ReactNode;
  children?: ReactNode;
}

/** Whether a reason holds anything at all, priced or not. */
const hasTokens = (byModel: Record<string, MessageUsage>): boolean =>
  Object.values(byModel).some((u) => u.input + u.output + u.cacheRead + u.cacheCreate > 0);

function share(cost: number | null, total: number | null): string {
  if (cost === null || total === null || total <= 0) return '';
  const pct = (cost / total) * 100;
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

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
    const causes = [...byCause.entries()]
      .map(([cause, points]) => ({ cause, points, cost: sumRecacheCost(points, prices) }))
      .sort((a, b) => (b.cost?.billed ?? 0) - (a.cost?.billed ?? 0));
    reasons.push({
      key: 'recache',
      label: '↺ re-cached context',
      cost: recache.cost.billed,
      partial: recache.cost.partial,
      note: (
        <>
          {causes.map((c, i) => (
            <span key={c.cause ?? 'none'}>
              {i > 0 && ' · '}
              {recacheCauseLabel(c.cause)} ×{c.points.length}{' '}
              <span className="tabular-nums">{formatUsd(c.cost?.billed ?? null, c.cost?.partial)}</span>
            </span>
          ))}
          {recache.cost.extra !== null && (
            <span className="block opacity-80">
              {formatUsd(recache.cost.extra, recache.cost.partial)} more than reading it from the cache would have cost
            </span>
          )}
        </>
      ),
      explain: (
        <>
          Context that was already cached when a request went out and had to be written again — at the write rate,
          2× input, instead of the read rate, a tenth of it or less. The figure is what those writes cost; the line
          under it, what they cost beyond a read. Each request says why in its pill.
        </>
      ),
    });
  }

  const long = priceByModel(drivers.longContext, prices);
  if (hasTokens(drivers.longContext)) {
    reasons.push({
      key: 'long',
      label: 'long context',
      cost: long.cost,
      partial: long.partial,
      note: `${drivers.counts.longContext} request${drivers.counts.longContext === 1 ? '' : 's'} sent over ${formatContextTokens(LONG_CONTEXT_TOKENS)} tokens`,
      explain: (
        <>
          The whole cost of every request that sent more than {formatContextTokens(LONG_CONTEXT_TOKENS)} tokens of
          context, the threshold Claude Code's <code>/usage</code> uses. Every request re-reads the whole context, so a
          long one costs on every turn; compacting, or starting afresh, is what brings it down.
        </>
      ),
    });
  }

  const alwaysOn = priceByModel(drivers.alwaysOn, prices);
  if (hasTokens(drivers.alwaysOn)) {
    reasons.push({
      key: 'always-on',
      label: '≈ always-on context',
      cost: alwaysOn.cost,
      partial: alwaysOn.partial,
      note: `≈${formatContextTokens(Math.round(drivers.alwaysOnTokens))} tokens that every request sent again`,
      explain: (
        <>
          An estimate. The system prompt, the tool definitions, CLAUDE.md, memory and skills go with every request: this
          is taken as the smallest context any request of the session sent, less the first prompt, and the figure is
          that part's share of each request's input (its output is not counted). Claude Code's <code>/usage</code>{' '}
          counts it the same way. Fewer tools and MCP servers, and a shorter CLAUDE.md, are what bring it down.
        </>
      ),
    });
  }

  const large = priceByModel(drivers.largeResults, prices);
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
      cost: large.cost,
      partial: large.partial,
      note: `${count} result${count === 1 ? '' : 's'} over ≈10k tokens, read again by every request after them`,
      explain: (
        <>
          An estimate. A tool result over about 10k tokens (counted at 2.5 characters a token) stays in the context
          until a compaction drops it, and every later request pays to read it again; the figure is the share of each
          request's input those results were. Claude Code's <code>/usage</code> counts it the same way. Reading part of
          a file instead of all of it, or asking for less output, is what brings it down.
        </>
      ),
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
                  ≈{formatContextTokens(Math.round(r.tokens))} · {r.requests} req · {formatUsd(r.priced.cost, r.priced.partial)}
                </span>
              </li>
            );
          })}
          {count > NAMED_RESULTS && <li className="text-[11px] opacity-70">and {count - NAMED_RESULTS} more</li>}
        </ul>
      ),
    });
  }

  const max = priceByModel(drivers.maxEffort, prices);
  if (hasTokens(drivers.maxEffort)) {
    reasons.push({
      key: 'max',
      label: 'max effort',
      cost: max.cost,
      partial: max.partial,
      note: `${drivers.counts.maxEffort} request${drivers.counts.maxEffort === 1 ? '' : 's'} at effort max`,
      explain: (
        <>
          The whole cost of every request run at effort <code>max</code>, which thinks the longest and writes the most —
          the level Claude Code's <code>/usage</code> warns about.
        </>
      ),
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
      explain: (
        <>
          What the agents this session sent out spent, in their own transcripts — the part of the total the session did
          not spend itself. An agent re-reads its own brief and context on every request it makes.
        </>
      ),
    });
  }

  const workflow = priceByModel(e.workflowUsageByModel ?? {}, prices);
  if (hasTokens(e.workflowUsageByModel ?? {})) {
    reasons.push({
      key: 'workflow',
      label: '⑂ workflow agents',
      cost: workflow.cost,
      partial: workflow.partial,
      note: 'the agents of a Workflow run — part of the subagents above',
      explain: (
        <>
          What the agents of the Workflow tool spent. They are subagents too, so this is a part of the line above; it
          is named apart because a workflow can start many at once, the way Claude Code's <code>/usage</code> names it.
        </>
      ),
    });
  }

  const efforts = Object.entries(drivers.byEffort)
    .filter(([, byModel]) => hasTokens(byModel))
    .map(([effort, byModel]) => ({ effort, ...priceByModel(byModel, prices) }))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));

  if (reasons.length === 0 && efforts.length === 0) return null;
  // An unpriced reason sinks to the end: there is no amount to rank it by.
  reasons.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1));

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-2" data-cost-drivers>
      <div className="text-[11px] tracking-wider text-[var(--text-dim)] uppercase">What made it expensive</div>
      <p className="mt-1 mb-2 text-[11px]">
        Each line is a part of the session total. They overlap — one request can be long, at max effort and carrying a
        large result all at once — so they do not add up to it.
      </p>
      {reasons.map((r) => (
        <div key={r.key} className="mb-1.5 rounded border border-[var(--border)] px-2 py-1.5">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 font-mono text-[var(--text)]">{r.label}</span>
            <span className="shrink-0 font-semibold text-[var(--text)] tabular-nums">{formatUsd(r.cost, r.partial)}</span>
            <span className="w-9 shrink-0 text-right tabular-nums opacity-70">{share(r.cost, cost.total)}</span>
          </div>
          <div className="mt-0.5 text-[11px]">{r.note}</div>
          {r.children}
          <Fold label="how this is counted">
            <span className="text-[11px] text-[var(--text-dim)]">{r.explain}</span>
          </Fold>
        </div>
      ))}
      {efforts.length > 0 && (
        <div className="mt-1 text-[11px]">
          <span className="opacity-70">by effort, this conversation: </span>
          {efforts.map((x, i) => (
            <span key={x.effort} className="tabular-nums">
              {i > 0 && ' · '}
              {x.effort} {formatUsd(x.cost, x.partial)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
