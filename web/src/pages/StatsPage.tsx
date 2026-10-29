import type { SessionSummary } from '@claude-history/shared';
import type { DriverUsage, PriceTable, RecacheCause, RecacheRecord, UsageByModel } from '@claude-history/shared';
import { addToModel, emptyDriverUsage, resolvePrices } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { ProjectTag } from '../components/list/ProjectTag.tsx';
import { DailyChart, type ChartSeries } from '../components/stats/DailyChart.tsx';
import { PricingEditor } from '../components/stats/PricingEditor.tsx';
import { CauseList, EXPLAIN, hasTokens, OVERLAP_NOTE, type Reason, ReasonList } from '../components/viewer/CostDrivers.tsx';
import { computeMessageCost, formatTokens, formatUsd, priceByModel, priceRecacheRecords } from '../lib/cost.ts';
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

/**
 * Money summed over models, some of which may have no price. Counting those as
 * $0 is how a model missing from the table read "$0.000" in the model mix, a
 * project made only of such models "$0.000" in its row, and the total came out
 * short with nothing to say so — all three while the token figures beside them
 * counted that usage in full.
 */
interface Spend {
  /** What the priced part comes to. */
  cost: number;
  /** Something in it had a price; without that the sum is unknown, not zero. */
  priced: boolean;
  /** Models whose usage is in the figures beside it but not in `cost`. */
  unpriced: Set<string>;
}

const newSpend = (): Spend => ({ cost: 0, priced: false, unpriced: new Set() });

function addSpend(spend: Spend, model: string, cost: number | null): void {
  if (cost === null) {
    spend.unpriced.add(model);
    return;
  }
  spend.cost += cost;
  spend.priced = true;
}

/** "—" when nothing in it had a price; the priced part and a `+` when only some did (`formatUsd`). */
function SpendText({ spend }: { spend: Spend }) {
  const partial = spend.unpriced.size > 0;
  // Nothing priced and nothing left out is a real zero: no usage at all.
  const text = formatUsd(spend.priced ? spend.cost : partial ? null : 0, spend.priced && partial);
  if (!partial) return <>{text}</>;
  const missing = [...spend.unpriced].map(shortModel).join(', ');
  return <span title={spend.priced ? `Plus the usage of ${missing}, which has no price` : `No price for ${missing}`}>{text}</span>;
}

function Card({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
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
  spend: Spend;
  lastMs: number;
}

/**
 * The period's reasons, as `CostDrivers` draws one session's: the same rows
 * and the same words, from the enricher's day buckets instead of a parse.
 */
function reasonsOf(
  agg: {
    drivers: DriverUsage;
    agents: UsageByModel;
    workflows: UsageByModel;
    recaches: RecacheRecord[];
  },
  prices: PriceTable,
): { reasons: Reason[]; efforts: Array<{ effort: string; cost: number | null; partial: boolean }> } {
  const reasons: Reason[] = [];
  const recache = priceRecacheRecords(agg.recaches, prices);
  if (recache) {
    const byCause = new Map<RecacheCause, RecacheRecord[]>();
    for (const r of agg.recaches) byCause.set(r.cause, [...(byCause.get(r.cause) ?? []), r]);
    const causes = [...byCause.entries()].map(([cause, records]) => {
      const priced = priceRecacheRecords(records, prices);
      return { cause, count: records.length, cost: priced?.billed ?? null, partial: priced?.partial ?? false };
    });
    reasons.push({
      key: 'recache',
      label: '↺ re-cached context',
      cost: recache.billed,
      partial: recache.partial,
      note: (
        <>
          <CauseList causes={causes} />
          {recache.extra !== null && (
            <span className="block opacity-80">
              {formatUsd(recache.extra, recache.partial)} more than reading it from the cache would have cost
            </span>
          )}
        </>
      ),
      explain: EXPLAIN.recache,
    });
  }
  const rows: Array<[string, ReactNode, UsageByModel, string, ReactNode]> = [
    ['long', 'long context', agg.drivers.longContext, 'requests that sent over 150k tokens', EXPLAIN.long],
    ['always-on', '≈ always-on context', agg.drivers.alwaysOn, 'what every request sent again: system prompt, tools, CLAUDE.md, memory', EXPLAIN.alwaysOn],
    ['large', '≈ large tool results', agg.drivers.largeResults, 'tool results over ≈10k tokens, while they stayed in the context', EXPLAIN.large],
    ['max', 'max effort', agg.drivers.maxEffort, 'requests at effort max', EXPLAIN.max],
    ['agents', '⑂ subagents', agg.agents, 'the agents the sessions sent out, in conversations of their own', EXPLAIN.agents],
    ['workflow', '⑂ workflow agents', agg.workflows, 'the agents of Workflow runs — part of the subagents above', EXPLAIN.workflow],
  ];
  for (const [key, label, byModel, note, explain] of rows) {
    if (hasTokens(byModel)) reasons.push({ key, label, ...priceByModel(byModel, prices), note, explain });
  }
  const efforts = Object.entries(agg.drivers.byEffort)
    .filter(([, byModel]) => hasTokens(byModel))
    .map(([effort, byModel]) => ({ effort, ...priceByModel(byModel, prices) }));
  return { reasons, efforts };
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
      if (!p) perProject.set(key, (p = { key, sessions: 0, prompts: 0, output: 0, spend: newSpend(), lastMs: 0 }));
      return p;
    };
    const perModel = new Map<string, { output: number; spend: Spend }>();
    const model = (name: string) => {
      let m = perModel.get(name);
      if (!m) perModel.set(name, (m = { output: 0, spend: newSpend() }));
      return m;
    };
    const totals = { sessions: 0, prompts: 0, output: 0, spend: newSpend() };
    // What drove the spend: tokens by reason, and every re-cache with its cause.
    // Priced at render rather than stored: the enrichment keeps tokens only, so
    // an edit to the price table moves these like it moves every other figure.
    const drivers = emptyDriverUsage();
    const agents: UsageByModel = {};
    const workflows: UsageByModel = {};
    const recaches: RecacheRecord[] = [];

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
        for (const [name, u] of Object.entries(du.byModel)) {
          // Null when the model has no price: kept apart from zero, see `Spend`.
          const cost = computeMessageCost(u, resolvePrices(name, prices));
          const m = model(name);
          totals.output += u.output;
          addSpend(totals.spend, name, cost);
          p.output += u.output;
          addSpend(p.spend, name, cost);
          c.output += u.output;
          // The chart can only stack what has a price; the line under the
          // cards names what it leaves out.
          c.cost += cost ?? 0;
          m.output += u.output;
          addSpend(m.spend, name, cost);
        }
        // The agents those sessions sent out, on the day THEY ran. Their tokens
        // are not in `byModel` — separate conversations, separate transcripts —
        // so without this the dashboard is short by whatever was delegated, and
        // the sessions that delegate most are the ones it understates most.
        for (const [name, u] of Object.entries(du.subagentByModel ?? {})) {
          addToModel(agents, name, u);
          const cost = computeMessageCost(u, resolvePrices(name, prices));
          const m = model(name);
          totals.output += u.output;
          addSpend(totals.spend, name, cost);
          p.output += u.output;
          addSpend(p.spend, name, cost);
          c.output += u.output;
          c.cost += cost ?? 0;
          m.output += u.output;
          addSpend(m.spend, name, cost);
        }
        for (const [name, u] of Object.entries(du.workflowByModel ?? {})) addToModel(workflows, name, u);
        recaches.push(...du.recaches);
        const d = du.drivers;
        for (const key of ['longContext', 'maxEffort', 'alwaysOn', 'largeResults'] as const) {
          for (const [name, u] of Object.entries(d[key])) addToModel(drivers[key], name, u);
        }
        for (const [effort, byModel] of Object.entries(d.byEffort)) {
          for (const [name, u] of Object.entries(byModel)) addToModel((drivers.byEffort[effort] ??= {}), name, u);
        }
      }
    }

    const chartDays = [...chart.keys()].sort();
    const days =
      chartDays.length > 0
        ? daysBetween(cutoff && cutoff > chartDays[0] ? cutoff : chartDays[0], chartDays[chartDays.length - 1])
        : [];

    return { chart, days, perProject, perModel, totals, drivers, agents, workflows, recaches };
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
  const { reasons, efforts } = reasonsOf(agg, pricesQ.data?.prices ?? {});
  const projectRows = [...agg.perProject.values()].sort((a, b) => b.spend.cost - a.spend.cost);
  const unpriced = [...agg.totals.spend.unpriced].sort();
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
            value={<SpendText spend={agg.totals.spend} />}
            hint="API-equivalent value at the configured prices, subagents included — not actual subscription spend"
          />
        </div>

        {/* Every cost on this page leaves these out, the chart included, while
            every token figure counts them — so it is said once, here, rather
            than left for a `+` on a tooltip to explain. */}
        {unpriced.length > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            No price for {unpriced.map(shortModel).join(', ')}: their usage is in the token figures but in no cost on
            this page. Set {unpriced.length === 1 ? 'it' : 'them'} in the price table below.
          </div>
        )}

        {/* What drove the spend: the reasons the token panel gives for one
            session, summed over the period. A full-width section rather than
            more cards — the grid above is `md:grid-cols-4` — and hidden when
            the period spent nothing. */}
        {reasons.length > 0 && (
          <div className="rounded border border-[var(--border)] px-4 py-3" data-cost-drivers>
            <div className="text-[11px] tracking-wider text-[var(--text-dim)] uppercase">What drove the spend</div>
            <p className="mt-1 mb-2 text-xs text-[var(--text-dim)]">
              Each line is a part of the cost above. {OVERLAP_NOTE}
            </p>
            <ReasonList
              reasons={reasons}
              total={agg.totals.spend.priced ? agg.totals.spend.cost : null}
              efforts={efforts}
              effortLabel="by effort, the sessions' own requests"
              className="grid gap-x-3 text-xs md:grid-cols-2"
            />
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
                    {formatTokens(m.output)} out · <SpendText spend={m.spend} />
                  </span>
                </div>
              </div>
            ))}
            {modelRows.length === 0 && <div className="text-xs text-[var(--text-dim)]">No usage in this period.</div>}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Projects</h2>
            {/* Five columns, four of them numbers: at 360px the table would
                either set the width of the page or squeeze a project name to
                three characters. It scrolls inside its own box instead, which
                is the one place in the app where sideways is the right answer —
                a table is a shape, and narrowing it destroys the comparison it
                exists to make. */}
            <div className="max-md:-mx-1 max-md:overflow-x-auto max-md:px-1">
            <table className="w-full text-xs max-md:min-w-[30rem]">
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
                      <td className="px-2 text-right">
                        <SpendText spend={p.spend} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
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
