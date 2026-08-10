import { type ContextIndex, formatContextDelta, formatContextTokens } from '../../lib/context.ts';

const W = 600;
const H = 44;

/**
 * How the context grew over the session, request by request, with every shrink
 * marked. It is drawn from measured prompt sizes only — no window limit is
 * assumed, so the curve is scaled to its own peak and carries no percentage.
 *
 * A viewBox this wide with preserveAspectRatio="none" lets the line stretch to
 * whatever width the panel has: the shape is the message, not the pixel ratio.
 */
export function ContextCurve({ index }: { index: ContextIndex }) {
  const { points, max } = index;
  if (points.length < 2 || max === 0) return null;

  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (total: number) => H - (total / max) * (H - 3) - 1.5;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const peak = points.reduce((best, p) => (p.total > best.total ? p : best), points[0]);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-[10px] tracking-wider text-[var(--text-dim)] uppercase">
        <span>context window</span>
        <span className="normal-case">
          start <b className="font-mono text-[var(--text)]">{formatContextTokens(points[0].total)}</b> · peak{' '}
          <b className="font-mono text-[var(--text)]">{formatContextTokens(peak.total)}</b> · end{' '}
          <b className="font-mono text-[var(--text)]">{formatContextTokens(points[points.length - 1].total)}</b>
        </span>
        {index.shrinks.length > 0 && (
          <span className="normal-case text-amber-400/90">
            {index.shrinks.length} shrink{index.shrinks.length !== 1 ? 's' : ''} (
            {index.shrinks.filter((s) => s.shrink?.compacted).length} compaction
            {index.shrinks.filter((s) => s.shrink?.compacted).length !== 1 ? 's' : ''})
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-11 w-full rounded bg-[var(--bg)]/40"
        role="img"
        aria-label="Context window over the session"
      >
        <path d={area} fill="var(--accent)" opacity="0.12" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        {index.shrinks.map((p) => (
          <g key={p.uuid}>
            <line
              x1={x(p.index)}
              x2={x(p.index)}
              y1={0}
              y2={H}
              stroke={p.shrink?.compacted ? 'rgb(251 191 36)' : 'rgb(148 163 184)'}
              strokeWidth="1"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <title>
              {p.shrink?.compacted
                ? `${p.shrink.compacted.trigger === 'auto' ? 'Autocompaction' : 'Compaction'}: ${formatContextTokens(p.shrink.from)} → ${formatContextTokens(p.shrink.to)}`
                : `Shrank ${formatContextDelta(p.delta ?? 0)} with no compaction boundary recorded`}
            </title>
          </g>
        ))}
        <circle cx={x(peak.index)} cy={y(peak.total)} r="2" fill="var(--accent)" vectorEffect="non-scaling-stroke">
          <title>{`Peak: ${peak.total.toLocaleString()} tokens at request ${peak.index + 1}`}</title>
        </circle>
      </svg>
      <p className="mt-1 text-[10px] text-[var(--text-dim)] opacity-70">
        Prompt size per request as the API billed it — the figure /context reports. The window size is not recorded in
        transcripts, so this is scaled to its own peak, not to a limit.
      </p>
    </div>
  );
}
