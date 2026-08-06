import type { SessionSummary, UsageTotals } from '@claude-history/shared';
import { shortModel } from '../../lib/format.ts';

function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
}

function Row({ label, usage }: { label: string; usage: UsageTotals }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="py-1 pr-4 font-mono">{label}</td>
      <td className="px-2 text-right">{fmt(usage.input)}</td>
      <td className="px-2 text-right">{fmt(usage.output)}</td>
      <td className="px-2 text-right">{fmt(usage.cacheRead)}</td>
      <td className="px-2 text-right">{fmt(usage.cacheCreate)}</td>
    </tr>
  );
}

export function TokenPanel({ summary }: { summary: SessionSummary }) {
  const e = summary.enrichment;
  if (!e) {
    return <div className="p-3 text-xs text-[var(--text-dim)]">Token stats not indexed yet.</div>;
  }
  const models = Object.entries(e.usageByModel);
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
          </tr>
        </thead>
        <tbody>
          {models.map(([model, usage]) => (
            <Row key={model} label={shortModel(model) ?? model} usage={usage} />
          ))}
          {models.length > 1 && <Row label="total" usage={e.usage} />}
        </tbody>
      </table>
    </div>
  );
}
