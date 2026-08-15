import type { SessionSummary } from '@claude-history/shared';
import { resolvePrices } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { ProjectTag } from '../components/list/ProjectTag.tsx';
import { DailyChart, type ChartSeries } from '../components/stats/DailyChart.tsx';
import { PricingEditor } from '../components/stats/PricingEditor.tsx';
import { computeCost, computeMessageCost, formatTokens, formatUsd } from '../lib/cost.ts';
import { formatDateTime, shortModel } from '../lib/format.ts';

type Metric = 'cost' | 'output' | 'prompts' | 'sessions';
const METRICS: Array<[Metric, string]> = [
  ['cost', 'Cost (API-equivalent)'],
  ['output', 'Output tokens'],
  ['prompts', 'Prompts'],
  ['sessions', 'Sessions started'],
];
const RANGES: Array<[number, string]> = [
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
  [0, 'All time'],
];

const FALLBACK_COLOR = 'hsl(0 0% 55%)';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600_000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--bg-raised)]/50 px-4 py-3" title={hint}>
      <div className="text-[11px] tracking-wider text-[var(--text-dim)] uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

interface ProjectAgg {
  key: string;
  sessions: number;
  prompts: number;
  output: number;
  cost: number;
  lastMs: number;
}

export function StatsPage() {
  const sessionsQ = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const pricesQ = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  const navigate = useNavigate();
  const [range, setRange] = useState(30);
  const [metric, setMetric] = useState<Metric>('cost');

  const agg = useMemo(() => {
    const sessions: SessionSummary[] = sessionsQ.data ?? [];
    const prices = pricesQ.data?.prices ?? {};
    const cutoff = range > 0 ? isoDaysAgo(range) : '';

    // chart: value per (day, projectKey) for every metric
    const chart = new Map<string, Map<string, { cost: number; output: number; prompts: number; sessions: number }>>();
    const cell = (day: string, key: string) => {
      let dayMap = chart.get(day);
      if (!dayMap) chart.set(day, (dayMap = new Map()));
      let c = dayMap.get(key);
      if (!c) dayMap.set(key, (c = { cost: 0, output: 0, prompts: 0, sessions: 0 }));
      return c;
    };

    const perProject = new Map<string, ProjectAgg>();
    const proj = (key: string) => {
      let p = perProject.get(key);
      if (!p) perProject.set(key, (p = { key, sessions: 0, prompts: 0, output: 0, cost: 0, lastMs: 0 }));
      return p;
    };
    const perModel = new Map<string, { output: number; cost: number }>();
    let totals = { sessions: 0, prompts: 0, output: 0, cost: 0, ownCost: 0 };
    // Context that was cached, expired and had to be written again. Priced here
    // rather than stored: the enrichment keeps tokens only, so an edit to the
    // price table moves this figure like it moves every other.
    let recache = { tokens: 0, events: 0, billed: 0, ifRead: 0 };

    for (const s of sessions) {
      const createdDay = (s.createdAt ?? '').slice(0, 10);
      if (createdDay && (!cutoff || createdDay >= cutoff)) {
        totals.sessions++;
        proj(s.projectKey).sessions++;
        cell(createdDay, s.projectKey).sessions++;
      }
      if (!s.enrichment) continue;
      for (const [day, du] of Object.entries(s.enrichment.daily)) {
        if (cutoff && day < cutoff) continue;
        const p = proj(s.projectKey);
        const c = cell(day, s.projectKey);
        totals.prompts += du.prompts;
        p.prompts += du.prompts;
        c.prompts += du.prompts;
        p.lastMs = Math.max(p.lastMs, s.mtimeMs);
        for (const [model, u] of Object.entries(du.byModel)) {
          const cost = computeCost(u, resolvePrices(model, prices)) ?? 0;
          totals.output += u.output;
          totals.cost += cost;
          // Kept apart for one figure only: the share of spend that went on
          // re-cached context. Re-caches are measured in session transcripts and
          // nowhere else, so counting the agents' spend in that denominator
          // would make the percentage fall as more work is delegated, saying
          // something about caching that never happened.
          totals.ownCost += cost;
          p.output += u.output;
          p.cost += cost;
          c.output += u.output;
          c.cost += cost;
          const m = perModel.get(model) ?? { output: 0, cost: 0 };
          m.output += u.output;
          m.cost += cost;
          perModel.set(model, m);
        }
        // The agents those sessions sent out, on the day THEY ran. Their tokens
        // are not in `byModel` — separate conversations, separate transcripts —
        // so without this the dashboard is short by whatever was delegated, and
        // the sessions that delegate most are the ones it understates most.
        for (const [model, u] of Object.entries(du.subagentByModel ?? {})) {
          const cost = computeMessageCost(u, resolvePrices(model, prices)) ?? 0;
          totals.output += u.output;
          totals.cost += cost;
          p.output += u.output;
          p.cost += cost;
          c.output += u.output;
          c.cost += cost;
          const m = perModel.get(model) ?? { output: 0, cost: 0 };
          m.output += u.output;
          m.cost += cost;
          perModel.set(model, m);
        }
        recache.events += du.recacheEvents;
        for (const [model, tokens] of Object.entries(du.recachedByModel)) {
          const rates = resolvePrices(model, prices);
          recache.tokens += tokens;
          // No rates for this model: count the tokens, price nothing. The
          // enrichment does not keep the 1h/5m split, and every session
          // transcript in this corpus writes 1h caches.
          if (rates) {
            recache.billed += (tokens * rates.cacheWrite) / 1_000_000;
            recache.ifRead += (tokens * rates.cacheRead) / 1_000_000;
          }
        }
      }
    }

    const chartDays = [...chart.keys()].sort();
    const days =
      chartDays.length > 0
        ? daysBetween(cutoff && cutoff > chartDays[0] ? cutoff : chartDays[0], chartDays[chartDays.length - 1])
        : [];

    return { chart, days, perProject, perModel, totals, recache };
  }, [sessionsQ.data, pricesQ.data, range]);

  const series: ChartSeries[] = useMemo(() => {
    const colorBy = new Map((projectsQ.data ?? []).map((p) => [p.key, p]));
    return [...agg.perProject.keys()].sort().map((key) => ({
      key,
      name: colorBy.get(key)?.name ?? key,
      color: colorBy.get(key)?.color ?? FALLBACK_COLOR,
    }));
  }, [agg.perProject, projectsQ.data]);

  if (sessionsQ.isLoading || pricesQ.isLoading) {
    return <div className="p-8 text-[var(--text-dim)]">Crunching stats…</div>;
  }

  const fmt = metric === 'cost' ? formatUsd : metric === 'output' ? formatTokens : (n: number) => String(Math.round(n));
  const projectRows = [...agg.perProject.values()].sort((a, b) => b.cost - a.cost);
  const modelRows = [...agg.perModel.entries()].sort((a, b) => b[1].output - a[1].output);
  const maxModelOutput = Math.max(1, ...modelRows.map(([, m]) => m.output));
  const projectInfo = new Map((projectsQ.data ?? []).map((p) => [p.key, p]));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold">Statistics</h1>
          <select
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
            className="ml-auto cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs text-[var(--text-dim)]"
          >
            {RANGES.map(([days, label]) => (
              <option key={days} value={days}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Sessions" value={String(agg.totals.sessions)} hint="Sessions created in the period" />
          <Card label="Prompts" value={String(agg.totals.prompts)} hint="Messages you typed" />
          <Card label="Output tokens" value={formatTokens(agg.totals.output)} hint="Assistant output tokens" />
          <Card
            label="≈ Cost"
            value={formatUsd(agg.totals.cost)}
            hint="API-equivalent value at the configured prices, subagents included — not actual subscription spend"
          />
        </div>

        {/* A full-width strip rather than a fifth card: the grid above is
            `md:grid-cols-4` and a fifth would leave one orphan on its own row.
            Hidden when nothing was re-cached, which is most short periods. */}
        {agg.recache.tokens > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <div className="text-[11px] tracking-wider text-amber-400/80 uppercase">↺ Re-cached context</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="text-2xl font-semibold text-amber-300">{formatUsd(agg.recache.billed)}</span>
              <span className="text-xs text-[var(--text-dim)]">
                {agg.totals.ownCost > 0 && (
                  <>{((agg.recache.billed / agg.totals.ownCost) * 100).toFixed(1)}% of session spend · </>
                )}
                {formatTokens(agg.recache.tokens)} tokens over {agg.recache.events} request
                {agg.recache.events !== 1 ? 's' : ''} · {formatUsd(agg.recache.billed - agg.recache.ifRead)} more than
                reading them from cache would have cost
              </span>
            </div>
            <div className="mt-1 text-[10px] text-[var(--text-dim)]">
              Context that was already cached when a request went out and had to be written again — usually because the
              1-hour cache expired while the session sat idle. Counted inside the cost above, not on top of it.
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Daily activity by project</h2>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              className="ml-auto cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs text-[var(--text-dim)]"
            >
              {METRICS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-dim)]">
            {series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
          {agg.days.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-dim)]">No activity in this period.</div>
          ) : (
            <DailyChart
              days={agg.days}
              series={series}
              getValue={(day, key) => agg.chart.get(day)?.get(key)?.[metric] ?? 0}
              format={fmt}
            />
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="mb-2 text-sm font-semibold">Model mix</h2>
            {modelRows.map(([model, m]) => (
              <div key={model} className="mb-1.5">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="w-24 shrink-0 font-mono">{shortModel(model)}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-sm bg-[var(--bg-raised)]">
                    <div
                      className="h-full rounded-sm bg-[var(--accent)]"
                      style={{ width: `${(m.output / maxModelOutput) * 100}%` }}
                    />
                  </div>
                  <span className="w-32 shrink-0 text-right text-[var(--text-dim)]">
                    {formatTokens(m.output)} out · {formatUsd(m.cost)}
                  </span>
                </div>
              </div>
            ))}
            {modelRows.length === 0 && <div className="text-xs text-[var(--text-dim)]">No usage in this period.</div>}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Projects</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] tracking-wider text-[var(--text-dim)] uppercase">
                  <th className="py-1">Project</th>
                  <th className="px-2 text-right">Sessions</th>
                  <th className="px-2 text-right">Prompts</th>
                  <th className="px-2 text-right">Out tokens</th>
                  <th className="px-2 text-right">≈ Cost</th>
                </tr>
              </thead>
              <tbody>
                {projectRows.map((p) => {
                  const info = projectInfo.get(p.key);
                  return (
                    <tr key={p.key} className="border-t border-[var(--border)]">
                      <td className="py-1 pr-2">
                        <ProjectTag
                          name={info?.name ?? p.key}
                          path={info?.path ?? p.key}
                          color={info?.color ?? FALLBACK_COLOR}
                          onClick={() => navigate(`/?projects=${encodeURIComponent(p.key)}`)}
                        />
                      </td>
                      <td className="px-2 text-right">{p.sessions}</td>
                      <td className="px-2 text-right">{p.prompts}</td>
                      <td className="px-2 text-right">{formatTokens(p.output)}</td>
                      <td className="px-2 text-right">{formatUsd(p.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border-t border-[var(--border)] pt-4">
          <PricingEditor
            prices={pricesQ.data?.prices ?? {}}
            isDefault={pricesQ.data?.isDefault ?? true}
            modelsInUse={modelRows.map(([m]) => m)}
          />
        </div>

        <div className="pb-4 text-[11px] text-[var(--text-dim)]">
          Enriched data updates in the background; dates are UTC days. Last activity per project:{' '}
          {projectRows[0] ? `${projectInfo.get(projectRows[0].key)?.name ?? ''} ${formatDateTime(projectRows[0].lastMs)}` : '—'}
        </div>
      </div>
    </div>
  );
}
