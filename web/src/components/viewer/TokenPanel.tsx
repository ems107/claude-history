import type { SessionSummary, Turn, UsageTotals } from '@claude-history/shared';
import { resolvePrices } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { buildContextIndex, recacheCauseText } from '../../lib/context.ts';
import { computeCost, computeMessageCost, formatUsd, summariseRecache } from '../../lib/cost.ts';
import { shortModel } from '../../lib/format.ts';
import { ContextCurve } from './ContextCurve.tsx';
import { Fold } from './Fold.tsx';

function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
}

/**
 * The four figures of one usage total, two by two.
 *
 * This is what the six-column table became. The table read beautifully across
 * the whole window and could not be made to fit the 400 px column the panels
 * live in now: `cache read` and `cache write` alone wanted 140 px of heading,
 * and every label was repeated once per row for the sake of a comparison
 * between rows that mean different things anyway — a model, a subset of one of
 * its cells, a separate conversation, and a total that excludes one of them.
 * Stacked, each figure carries its own name and the ledger reads downwards.
 */
function Figures({ usage }: { usage: UsageTotals }) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
      <span>
        <span className="opacity-60">in</span> {fmt(usage.input)}
      </span>
      <span>
        <span className="opacity-60">out</span> {fmt(usage.output)}
      </span>
      <span>
        <span className="opacity-60">cache read</span> {fmt(usage.cacheRead)}
      </span>
      <span>
        <span className="opacity-60">cache write</span> {fmt(usage.cacheCreate)}
      </span>
    </div>
  );
}

/**
 * One line of the ledger: what it is on the left, what it cost on the right.
 *
 * `tone` is the whole grammar of this panel, and it carries what the table said
 * with indentation, dots and border weights: `plain` is a model, `total` adds
 * up the ones above it, `add` is money spent OUTSIDE this transcript and says
 * so with a `+`, and `outside` is money this session did not spend at all.
 */
function Card({
  label,
  cost,
  usage,
  tone = 'plain',
  title,
  children,
}: {
  label: ReactNode;
  cost: string;
  usage?: UsageTotals;
  tone?: 'plain' | 'total' | 'add' | 'outside';
  title?: string;
  children?: ReactNode;
}) {
  const shell =
    tone === 'add'
      ? 'border-sky-500/30 text-sky-400/90'
      : tone === 'outside'
        ? 'border-dashed border-amber-500/40 text-amber-300/80'
        : tone === 'total'
          ? 'border-[var(--text-dim)]/40 text-[var(--text)]'
          : 'border-[var(--border)]';
  return (
    <div className={`mb-1.5 rounded border px-2 py-1.5 ${shell}`}>
      <div className="flex items-baseline gap-2">
        <span
          className={`min-w-0 flex-1 font-mono ${tone === 'plain' ? 'text-[var(--text)]' : ''} ${
            tone === 'total' ? 'font-semibold' : ''
          }`}
          title={title}
        >
          {tone === 'add' && <span className="opacity-70">+ </span>}
          {label}
        </span>
        <span className={`shrink-0 tabular-nums ${tone === 'plain' || tone === 'total' ? 'font-semibold' : ''}`}>
          {cost}
        </span>
      </div>
      {usage && <Figures usage={usage} />}
      {children}
    </div>
  );
}

export function TokenPanel({ summary, turns }: { summary: SessionSummary; turns: Turn[] }) {
  const pricesQ = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  const contextIndex = useMemo(() => buildContextIndex(turns), [turns]);
  const e = summary.enrichment;
  if (!e) {
    return <div className="p-3 text-xs text-[var(--text-dim)]">Token stats not indexed yet.</div>;
  }
  const priceTable = pricesQ.data?.prices ?? {};
  const models = Object.entries(e.usageByModel);
  const carried = e.carriedOverUsage;
  const carriedTokens = carried.input + carried.output + carried.cacheRead + carried.cacheCreate;
  // Priced at the session's own model: the enrichment does not split the carried
  // tokens per model, and a fork copies the parent's last exchanges, answered by
  // the model that was running then — the same one.
  const carriedCost = carriedTokens > 0 ? computeCost(carried, resolvePrices(summary.model, priceTable)) : null;
  const carriedMessages = turns.reduce(
    (n, t) => n + t.items.filter((i) => i.role === 'assistant' && i.carriedOver && i.usage).length,
    0,
  );
  const totalCost = models.reduce(
    (acc, [model, usage]) => acc + (computeCost(usage, resolvePrices(model, priceTable)) ?? 0),
    0,
  );
  // What the agents this session sent out spent, in their own conversations.
  // Their requests are not in this transcript, so this is an addition to the
  // figures above and not a part of them — the opposite of "of which re-cached".
  const sub = e.subagentUsage;
  const subTokens = sub ? sub.input + sub.output + sub.cacheRead + sub.cacheCreate : 0;
  const subCost = Object.entries(e.subagentUsageByModel ?? {}).reduce(
    (acc, [model, usage]) => acc + (computeMessageCost(usage, resolvePrices(model, priceTable)) ?? 0),
    0,
  );
  const recache = summariseRecache(contextIndex.recaches, priceTable);
  const duration =
    summary.createdAt && summary.lastActivityAt
      ? Math.round((Date.parse(summary.lastActivityAt) - Date.parse(summary.createdAt)) / 60_000)
      : null;

  /**
   * A SUBSET of the cache-write figure it sits under, already inside the total
   * — unlike `carried over`, which sits outside every total. In the table the
   * dots in the other columns were what kept it from reading as a row that
   * adds; here it is drawn INSIDE the card whose figure it is part of, which
   * says the same thing without needing four dots to say it.
   */
  const recacheNote = recache ? (
    <div className="mt-1 border-t border-dashed border-amber-500/30 pt-1 text-[11px] text-amber-300/80">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 font-mono" title="Context that was cached, expired, and had to be written again">
          ↳ of which re-cached
        </span>
        <span className="shrink-0 tabular-nums">
          {fmt(recache.cost.tokens)} · {formatUsd(recache.cost.billed)}
        </span>
      </div>
      <Fold label="why it was written twice" className="text-amber-300/70 hover:text-amber-200">
        <span className="text-[11px] text-amber-300/80">
          {fmt(recache.cost.tokens)} tokens of the cache write above had already been cached and had to be written
          again, over {contextIndex.recaches.length} request
          {contextIndex.recaches.length !== 1 ? 's' : ''}
          {recache.cost.extra !== null && <> — {formatUsd(recache.cost.extra)} more than reading them would have cost</>}
          . {recacheCauseText(recache.cause, recache.gapMs)}
        </span>
      </Fold>
    </div>
  ) : null;

  return (
    <div className="px-4 py-3 text-xs text-[var(--text-dim)]">
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
        <span>
          <b className="text-[var(--text)]">{e.userMessageCount}</b> prompts
        </span>
        <span>
          <b className="text-[var(--text)]">{e.assistantMessageCount}</b> assistant msgs
          {carriedMessages > 0 && (
            <span title="Copied in by /branch: they are part of this transcript, but the parent session paid for them">
              {' '}
              ({carriedMessages} carried over)
            </span>
          )}
        </span>
        <span>
          <b className="text-[var(--text)]">{e.turnCount}</b> turns
        </span>
        {duration !== null && (
          <span>
            <b className="text-[var(--text)]">{duration < 90 ? `${duration} min` : `${(duration / 60).toFixed(1)} h`}</b>{' '}
            span
          </span>
        )}
      </div>

      {models.map(([model, usage], i) => (
        <Card
          key={model}
          label={shortModel(model) ?? model}
          cost={formatUsd(computeCost(usage, resolvePrices(model, priceTable)))}
          usage={usage}
        >
          {models.length === 1 && i === 0 ? recacheNote : null}
        </Card>
      ))}

      {/* With one model its card IS the conversation, and repeating it under
          another name would only pad the ledger. */}
      {models.length > 1 && (
        <Card
          label={subTokens > 0 ? 'this conversation' : 'total'}
          title="The requests in this transcript — what the per-message pills in the conversation add up to"
          cost={formatUsd(totalCost)}
          usage={e.usage}
          tone="total"
        >
          {recacheNote}
        </Card>
      )}

      {subTokens > 0 && sub && (
        <>
          <Card
            label={
              <Link to={`?agents=1`} className="hover:underline">
                ⑂ {summary.subagentCount} subagent{summary.subagentCount === 1 ? '' : 's'}
              </Link>
            }
            title="Separate API conversations, in their own transcripts — nothing of this is in the file above"
            cost={formatUsd(subCost)}
            usage={sub}
            tone="add"
          >
            <Fold label="why they are added and not included" className="text-sky-400/70 hover:text-sky-300">
              <span className="text-[11px] text-sky-400/80">
                The subagents ran as their own API conversations, in their own transcripts: none of those tokens is in
                this file, and none of them is in the per-message pills — which is why they are added here rather than
                found among the figures above. Cache writes there are mostly 5-minute ones and are priced as such.
              </span>
            </Fold>
          </Card>
          <div className="mt-2 mb-1.5 border-t-2 border-[var(--border)] pt-1.5 text-[var(--text)]">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 font-mono font-semibold">session total</span>
              <span className="shrink-0 font-semibold tabular-nums">{formatUsd(totalCost + subCost)}</span>
            </div>
            <Figures
              usage={{
                input: e.usage.input + sub.input,
                output: e.usage.output + sub.output,
                cacheRead: e.usage.cacheRead + sub.cacheRead,
                cacheCreate: e.usage.cacheCreate + sub.cacheCreate,
              }}
            />
          </div>
        </>
      )}

      {carriedTokens > 0 && (
        <Card
          label="carried over"
          title="Copied in by /branch — billed in the parent session, not here"
          cost={formatUsd(carriedCost)}
          usage={carried}
          tone="outside"
        >
          <Fold label="why it is in no total" className="text-amber-300/70 hover:text-amber-200">
            <span className="text-[11px] text-amber-300/80">
              The figures above are what this session spent. “Carried over” is the context <code>/branch</code> copied
              from
              {e.forkedFrom ? (
                <>
                  {' '}
                  <Link to={`/session/${e.forkedFrom}`} className="font-mono underline hover:text-amber-200">
                    {e.forkedFrom.slice(0, 8)}
                  </Link>
                </>
              ) : (
                ' the parent session'
              )}
              : those messages are shown here and cost that much, but they were billed there, so they are left out of
              every total.
            </span>
          </Fold>
        </Card>
      )}

      {e.compactionCount > 0 && (
        <Fold label={`why the ${e.compactionCount} compaction${e.compactionCount === 1 ? '' : 's'} cost nothing here`}>
          <span className="text-[11px] text-[var(--text-dim)]">
            Not in any of these figures: the {e.compactionCount} compaction{e.compactionCount === 1 ? '' : 's'} of this
            session. Claude Code writes no <code>usage</code> at all for the call that produces the summary, so what it
            cost is not recorded anywhere and cannot be recovered.
          </span>
        </Fold>
      )}

      <div className="mt-1 text-[10px] opacity-70">
        ≈ cost is API-equivalent value at the prices configured in Stats — not actual subscription spend.
      </div>

      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <ContextCurve index={contextIndex} prices={priceTable} />
      </div>
    </div>
  );
}
