import type { ModelPrices, SessionSummary, Turn, UsageTotals } from '@claude-history/shared';
import { resolvePrices } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { buildContextIndex } from '../../lib/context.ts';
import { computeCost, formatUsd } from '../../lib/cost.ts';
import { shortModel } from '../../lib/format.ts';
import { ContextCurve } from './ContextCurve.tsx';

function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
}

function Row({ label, usage, prices }: { label: string; usage: UsageTotals; prices?: ModelPrices }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="py-1 pr-4 font-mono">{label}</td>
      <td className="px-2 text-right">{fmt(usage.input)}</td>
      <td className="px-2 text-right">{fmt(usage.output)}</td>
      <td className="px-2 text-right">{fmt(usage.cacheRead)}</td>
      <td className="px-2 text-right">{fmt(usage.cacheCreate)}</td>
      <td className="px-2 text-right" title="API-equivalent value at the configured prices (see Stats)">
        {formatUsd(computeCost(usage, prices))}
      </td>
    </tr>
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
  const duration =
    summary.createdAt && summary.lastActivityAt
      ? Math.round((Date.parse(summary.lastActivityAt) - Date.parse(summary.createdAt)) / 60_000)
      : null;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-raised)]/50 px-4 py-3 text-xs">
      <div className="mb-2 flex gap-4 text-[var(--text-dim)]">
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
      <table className="text-[var(--text-dim)]">
        <thead>
          <tr className="text-[10px] tracking-wider uppercase">
            <th className="pr-4 text-left">model</th>
            <th className="px-2 text-right">input</th>
            <th className="px-2 text-right">output</th>
            <th className="px-2 text-right">cache read</th>
            <th className="px-2 text-right">cache write</th>
            <th className="px-2 text-right">≈ cost</th>
          </tr>
        </thead>
        <tbody>
          {models.map(([model, usage]) => (
            <Row key={model} label={shortModel(model) ?? model} usage={usage} prices={resolvePrices(model, priceTable)} />
          ))}
          {models.length > 1 && (
            <tr className="border-t border-[var(--border)] font-semibold">
              <td className="py-1 pr-4 font-mono">total</td>
              <td className="px-2 text-right">{fmt(e.usage.input)}</td>
              <td className="px-2 text-right">{fmt(e.usage.output)}</td>
              <td className="px-2 text-right">{fmt(e.usage.cacheRead)}</td>
              <td className="px-2 text-right">{fmt(e.usage.cacheCreate)}</td>
              <td className="px-2 text-right">{formatUsd(totalCost)}</td>
            </tr>
          )}
          {carriedTokens > 0 && (
            <tr className="border-t border-dashed border-amber-500/40 text-amber-300/80">
              <td className="py-1 pr-4 font-mono" title="Copied in by /branch — billed in the parent session, not here">
                carried over
              </td>
              <td className="px-2 text-right">{fmt(carried.input)}</td>
              <td className="px-2 text-right">{fmt(carried.output)}</td>
              <td className="px-2 text-right">{fmt(carried.cacheRead)}</td>
              <td className="px-2 text-right">{fmt(carried.cacheCreate)}</td>
              <td className="px-2 text-right">{formatUsd(carriedCost)}</td>
            </tr>
          )}
        </tbody>
      </table>
      {carriedTokens > 0 && (
        <div className="mt-1 text-[10px] text-amber-300/70">
          The rows above are what this session spent. “Carried over” is the context <code>/branch</code> copied from
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
          : those messages are shown here and cost that much, but they were billed there, so they are left out of every
          total.
        </div>
      )}
      <div className="mt-1 text-[10px] text-[var(--text-dim)] opacity-70">
        ≈ cost is API-equivalent value at the prices configured in Stats — not actual subscription spend.
      </div>
      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <ContextCurve index={contextIndex} />
      </div>
    </div>
  );
}
