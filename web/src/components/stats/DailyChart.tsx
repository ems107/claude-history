import { useMemo, useRef, useState } from 'react';

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

/** Stacked-by-series daily bar chart (hand-rolled SVG, dataviz-spec marks). */
export function DailyChart({
  days,
  series,
  getValue,
  format,
}: {
  days: string[]; // yyyy-mm-dd, ascending, continuous
  series: ChartSeries[]; // fixed order — color follows the entity
  getValue: (day: string, seriesKey: string) => number;
  format: (n: number) => string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; lines: Array<[string, string, string]> } | null>(
    null,
  );

  const W = 860;
  const H = 240;
  const M = { l: 52, r: 8, t: 10, b: 22 };
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;

  const { totals, max } = useMemo(() => {
    const totals = days.map((d) => series.reduce((acc, s) => acc + getValue(d, s.key), 0));
    return { totals, max: Math.max(1e-9, ...totals) };
  }, [days, series, getValue]);

  const step = plotW / Math.max(1, days.length);
  const barW = Math.max(2, Math.min(28, step - 2));
  const yOf = (v: number) => M.t + plotH - (v / max) * plotH;

  // Recessive grid: 4 horizontal lines.
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => max * f);
  const labelEvery = Math.max(1, Math.ceil(days.length / 9));

  const showTip = (e: React.MouseEvent, day: string, dayIdx: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const lines = series
      .map((s): [string, string, string] => [s.color, s.name, format(getValue(day, s.key))])
      .filter((l) => l[2] !== format(0));
    setTip({
      x: Math.min(e.clientX - rect.left + 12, rect.width - 180),
      y: e.clientY - rect.top + 12,
      title: `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)} — ${format(totals[dayIdx])}`,
      lines,
    });
  };

  return (
    <div ref={wrapRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={M.l} x2={W - M.r} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.l - 6} y={yOf(t) + 3} textAnchor="end" fontSize={10} fill="var(--text-dim)">
              {format(t)}
            </text>
          </g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={M.t + plotH} y2={M.t + plotH} stroke="var(--text-dim)" strokeWidth={1} opacity={0.5} />
        {days.map((day, i) => {
          const x = M.l + i * step + (step - barW) / 2;
          let acc = 0;
          const segs = series
            .map((s) => ({ s, v: getValue(day, s.key) }))
            .filter(({ v }) => v > 0);
          return (
            <g key={day} onMouseMove={(e) => showTip(e, day, i)} onMouseLeave={() => setTip(null)}>
              {/* invisible hit target covering the full column */}
              <rect x={M.l + i * step} y={M.t} width={step} height={plotH} fill="transparent" />
              {segs.map(({ s, v }, j) => {
                const y1 = yOf(acc + v);
                const h = Math.max(0.5, yOf(acc) - y1 - (j < segs.length - 1 ? 2 : 0)); // 2px gap between segments
                acc += v;
                const isTop = j === segs.length - 1;
                const r = isTop ? Math.min(3, barW / 2, h) : 0;
                return (
                  <path
                    key={s.key}
                    d={`M ${x} ${y1 + h} L ${x} ${y1 + r} Q ${x} ${y1} ${x + r} ${y1} L ${x + barW - r} ${y1} Q ${x + barW} ${y1} ${x + barW} ${y1 + r} L ${x + barW} ${y1 + h} Z`}
                    fill={s.color}
                  />
                );
              })}
              {i % labelEvery === 0 && (
                <text x={M.l + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--text-dim)">
                  {`${day.slice(8, 10)}/${day.slice(5, 7)}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-20 w-44 rounded border border-[var(--border)] bg-[var(--bg-raised)] p-2 text-xs shadow-xl"
          style={{ left: tip.x, top: tip.y }}
        >
          <div className="mb-1 font-semibold">{tip.title}</div>
          {tip.lines.map(([color, name, value], i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="min-w-0 flex-1 truncate text-[var(--text-dim)]">{name}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
