import type { ModelPrices, SessionSummary, Turn, UsageTotals } from '@claude-history/shared';
import { resolvePrices } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
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
        </tbody>
      </table>
      <div className="mt-1 text-[10px] text-[var(--text-dim)] opacity-70">
        ≈ cost is API-equivalent value at the prices configured in Stats — not actual subscription spend.
      </div>
      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <ContextCurve index={contextIndex} />
      </div>
    </div>
  );
}
