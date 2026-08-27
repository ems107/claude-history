import type { PriceTable } from '@claude-history/shared';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type CompactionEvent,
  type ContextIndex,
  type ContextPoint,
  formatContextDelta,
  formatContextTokens,
  formatGap,
  recacheCauseText,
} from '../../lib/context.ts';
import { formatUsd, summariseRecache, sumRecacheCost } from '../../lib/cost.ts';
import { formatDateTime, formatDateTimeShort, shortModel } from '../../lib/format.ts';
import { hasSelection } from '../../lib/selection.ts';
import { useSubagents } from './SubagentContext.ts';

const AMBER = 'rgb(251 191 36)';
const SLATE = 'rgb(148 163 184)';
/** Chart margins, in px — room for the y labels on the left and marker labels on top. */
const M = { left: 56, right: 16, top: 18, bottom: 26 };
const TOOLTIP_W = 240;

/** Y gridlines at 1/2/5 × 10^k, 3-6 of them whatever the peak is. */
function tokenTicks(max: number): number[] {
  if (max <= 0) return [];
  const k = 10 ** Math.floor(Math.log10(max / 4));
  const step = [1, 2, 5, 10].map((m) => m * k).find((s) => max / s <= 6) ?? 10 * k;
  const ticks: number[] = [];
  for (let t = step; t <= max; t += step) ticks.push(t);
  return ticks;
}

/** ~6 point indices spread over the session, deduped, for the time axis. */
function timeTickIndices(count: number): number[] {
  const wanted = Math.min(6, count);
  const set = new Set<number>();
  for (let i = 0; i < wanted; i++) set.add(Math.round((i * (count - 1)) / Math.max(1, wanted - 1)));
  return [...set];
}

/**
 * The context curve, at full size: the chart the 44-px sparkline in the token
 * panel opens when clicked. Same data, same rules — measured requests only,
 * tokens only (the window size is not in the transcript, so no percentage of
 * anything), `postTokens` never fed into the curve — with the room to carry
 * what the sparkline cannot: axes, timestamps, per-request hover detail, and
 * markers that navigate the transcript to the event they mark.
 *
 * A body portal, like every overlay here (the thread can carry a CSS `zoom`,
 * so `inset-0` inside it means the zoomed coordinate space), and Escape is
 * stopped at the document so the page's own unwind — which ends in
 * `navigate(-1)` — never sees it.
 */
export function ContextOverlay({
  index,
  prices,
  onClose,
}: {
  index: ContextIndex;
  prices: PriceTable;
  onClose: () => void;
}) {
  const subagents = useSubagents();
  const { points, max } = index;
  const recache = summariseRecache(index.recaches, prices);
  const peak = points.reduce((best, p) => (p.total > best.total ? p : best), points[0] ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Close first: the ring lands on the transcript this overlay is covering. */
  const jump = subagents
    ? (uuid: string) => {
        onClose();
        subagents.goToMessage(uuid);
      }
    : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Context window, full screen"
    >
      <div
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--border)] px-4 py-2.5 text-[11px] text-[var(--text-dim)]">
          <span className="text-[10px] tracking-wider uppercase">context window</span>
          {points.length > 0 && peak && (
            <span>
              start <b className="font-mono text-[var(--text)]">{formatContextTokens(points[0].total)}</b> · peak{' '}
              <b className="font-mono text-[var(--text)]">{formatContextTokens(peak.total)}</b> · end{' '}
              <b className="font-mono text-[var(--text)]">{formatContextTokens(points[points.length - 1].total)}</b> ·{' '}
              <b className="font-mono text-[var(--text)]">{points.length}</b> requests
            </span>
          )}
          {index.compactions.length > 0 && (
            <span className="text-amber-400/90">
              {index.compactions.length} compaction{index.compactions.length !== 1 ? 's' : ''}
            </span>
          )}
          {index.shrinks.some((s) => !s.shrink?.compacted) && (
            <span>{index.shrinks.filter((s) => !s.shrink?.compacted).length} shrinks with no boundary</span>
          )}
          {recache && (
            <span className="text-amber-400/90">
              {index.recaches.length} re-cache{index.recaches.length !== 1 ? 's' : ''}
              {recache.cost.billed !== null && ` (≈${formatUsd(recache.cost.billed)})`}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded px-1.5 py-0.5 hover:bg-[var(--border)]/50 hover:text-[var(--text)]"
            title="Close (Esc)"
          >
            ✕ close
          </button>
        </div>

        {points.length >= 2 && max > 0 && <Chart index={index} jump={jump} />}

        <EventList index={index} prices={prices} jump={jump} />

        <p className="border-t border-[var(--border)] px-4 py-1.5 text-[10px] text-[var(--text-dim)] opacity-70">
          Prompt size per request as the API billed it — the figure /context reports. The window size is not recorded
          in transcripts, so this is scaled to its own peak, not to a limit.
        </p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Pixel-space SVG sized by a ResizeObserver — not the sparkline's stretched
 * viewBox, which would deform axis text and marker labels along with the line.
 * Pixel space also keeps the hover math a plain inverse of `x()`.
 */
function Chart({ index, jump }: { index: ContextIndex; jump: ((uuid: string) => void) | null }) {
  const { points, max } = index;
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const check = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  const innerW = Math.max(0, w - M.left - M.right);
  const innerH = Math.max(0, h - M.top - M.bottom);
  const x = (i: number) => M.left + (i / (points.length - 1)) * innerW;
  const y = (total: number) => M.top + innerH * (1 - total / max);
  const clampX = (px: number, half: number) => Math.min(Math.max(px, M.left + half), M.left + innerW - half);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const area = `${line} L${(M.left + innerW).toFixed(1)},${(M.top + innerH).toFixed(1)} L${M.left},${(M.top + innerH).toFixed(1)} Z`;
  const peak = points.reduce((best, p) => (p.total > best.total ? p : best), points[0]);
  const hovered = hover !== null ? points[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (innerW <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - rect.left - M.left) / innerW) * (points.length - 1);
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(at))));
  };

  /** A marker per compaction (amber, at its next request or the right edge) and per boundary-less shrink (slate). */
  const markers: Array<{ key: string; px: number; amber: boolean; label: string; title: string; uuid: string }> = [];
  for (const event of index.compactions) {
    const p = event.point;
    markers.push({
      key: event.uuid,
      px: p ? x(p.index) : M.left + innerW,
      amber: true,
      label: p?.shrink ? `⇣ ${formatContextDelta(p.shrink.to - p.shrink.from)}` : '⇣ compacted',
      title: `${event.boundary.trigger === 'auto' ? 'Autocompaction' : 'Compaction'}${
        p?.shrink
          ? `: ${formatContextTokens(p.shrink.from)} → ${formatContextTokens(p.shrink.to)}`
          : p
            ? ' — no measured drop followed'
            : ' — no request since'
      }. Click to open it in the conversation.`,
      uuid: event.uuid,
    });
  }
  for (const p of index.shrinks) {
    if (p.shrink?.compacted) continue;
    markers.push({
      key: `shrink-${p.uuid}`,
      px: x(p.index),
      amber: false,
      label: `⇣ ${formatContextDelta(p.delta ?? 0)}`,
      title: `Shrank ${formatContextDelta(p.delta ?? 0)} with no compaction boundary recorded. Click to open the request in the conversation.`,
      uuid: p.uuid,
    });
  }

  return (
    <div ref={wrap} className="relative h-[42vh] min-h-56 shrink-0">
      {size && innerW > 0 && innerH > 0 && (
        <>
          <svg width={w} height={h} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block">
            {tokenTicks(max).map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
                <text
                  x={M.left - 6}
                  y={y(t) + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--text-dim)"
                  className="tabular-nums"
                >
                  {formatContextTokens(t)}
                </text>
              </g>
            ))}
            {timeTickIndices(points.length).map((i) => (
              <text
                key={`t-${i}`}
                x={clampX(x(i), 30)}
                y={M.top + innerH + 16}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-dim)"
                className="tabular-nums"
              >
                {formatDateTimeShort(points[i].timestamp)}
              </text>
            ))}
            <line
              x1={M.left}
              x2={M.left + innerW}
              y1={M.top + innerH}
              y2={M.top + innerH}
              stroke="var(--text-dim)"
              strokeOpacity="0.4"
              strokeWidth="1"
            />

            <path d={area} fill="var(--accent)" opacity="0.12" />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" />

            {markers.map((m) => (
              <g key={m.key}>
                <line
                  x1={m.px}
                  x2={m.px}
                  y1={M.top}
                  y2={M.top + innerH}
                  stroke={m.amber ? AMBER : SLATE}
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={clampX(m.px, 28)}
                  y={M.top - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fill={m.amber ? AMBER : SLATE}
                >
                  {m.label}
                </text>
                {/* The invisible hit zone is what makes a 1-px line clickable. */}
                <rect
                  x={m.px - 8}
                  width={16}
                  y={M.top - 14}
                  height={innerH + 14}
                  fill="transparent"
                  className={jump ? 'cursor-pointer' : undefined}
                  onClick={jump ? () => jump(m.uuid) : undefined}
                >
                  <title>{m.title}</title>
                </rect>
              </g>
            ))}

            {index.recaches.map((p) => (
              <g key={`recache-${p.uuid}`}>
                <line
                  x1={x(p.index)}
                  x2={x(p.index)}
                  y1={M.top + innerH}
                  y2={M.top + innerH - 10}
                  stroke={AMBER}
                  strokeWidth="2"
                />
                <rect
                  x={x(p.index) - 6}
                  width={12}
                  y={M.top + innerH - 14}
                  height={14}
                  fill="transparent"
                  className={jump ? 'cursor-pointer' : undefined}
                  onClick={jump ? () => jump(p.uuid) : undefined}
                >
                  <title>
                    {`Re-cached ${p.recached.toLocaleString()} tokens. ${recacheCauseText(p.recacheCause, p.gapMs) ?? ''} Click to open the request.`}
                  </title>
                </rect>
              </g>
            ))}

            <circle cx={x(peak.index)} cy={y(peak.total)} r="2.5" fill="var(--accent)" />

            {hovered && (
              <g className="pointer-events-none">
                <line
                  x1={x(hovered.index)}
                  x2={x(hovered.index)}
                  y1={M.top}
                  y2={M.top + innerH}
                  stroke="var(--text-dim)"
                  strokeOpacity="0.5"
                  strokeWidth="1"
                />
                <circle cx={x(hovered.index)} cy={y(hovered.total)} r="3" fill="var(--accent)" />
              </g>
            )}
          </svg>

          {hovered && (
            <div
              className="pointer-events-none absolute z-10 rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-[11px] text-[var(--text-dim)] shadow-xl"
              style={{
                width: TOOLTIP_W,
                top: M.top + 6,
                left: Math.max(
                  4,
                  Math.min(
                    w - TOOLTIP_W - 4,
                    x(hovered.index) > w * 0.6 ? x(hovered.index) - TOOLTIP_W - 12 : x(hovered.index) + 12,
                  ),
                ),
              }}
            >
              <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[var(--text)]">
                <span>
                  request {hovered.index + 1} of {points.length}
                </span>
                <b className="font-mono tabular-nums">{formatContextTokens(hovered.total)}</b>
              </div>
              <div className="tabular-nums">{formatDateTime(hovered.timestamp)}</div>
              {hovered.model && <div>{shortModel(hovered.model) ?? hovered.model}</div>}
              <div className="mt-1 tabular-nums">
                re-read {formatContextTokens(hovered.read)} · new {formatContextTokens(hovered.write)} · uncached{' '}
                {formatContextTokens(hovered.input)}
              </div>
              {hovered.delta !== null && (
                <div className="tabular-nums">
                  {formatContextDelta(hovered.delta)} since the previous request
                  {hovered.gapMs !== null && hovered.gapMs >= 1000 && <>, {formatGap(hovered.gapMs)} later</>}
                </div>
              )}
              {hovered.recached > 0 && (
                <div className="mt-1 text-amber-400/90">
                  re-cached {hovered.recached.toLocaleString()} tok. {recacheCauseText(hovered.recacheCause, hovered.gapMs)}
                </div>
              )}
              {hovered.shrink && (
                <div className="mt-1 text-amber-400/90">
                  {hovered.shrink.compacted
                    ? `${hovered.shrink.compacted.trigger === 'auto' ? 'autocompaction' : 'compaction'} here — ${formatContextTokens(hovered.shrink.from)} → ${formatContextTokens(hovered.shrink.to)}`
                    : `shrank here — ${formatContextTokens(hovered.shrink.from)} → ${formatContextTokens(hovered.shrink.to)}, no boundary recorded`}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type EventRow =
  | { kind: 'compaction'; order: number; event: CompactionEvent }
  | { kind: 'shrink'; order: number; point: ContextPoint }
  | { kind: 'recache'; order: number; point: ContextPoint };

/**
 * Every event of the session, in order, each row navigating to where it
 * happened. Rows are divs with `role="button"`, not `<button>`s: they carry the
 * figures worth copying — timestamps, `334k → 14.2k` — and no browser lets a
 * button's text be selected, so a click first asks `hasSelection()`, the
 * FoldHeader rule.
 */
function EventList({
  index,
  prices,
  jump,
}: {
  index: ContextIndex;
  prices: PriceTable;
  jump: ((uuid: string) => void) | null;
}) {
  const rows: EventRow[] = [
    // A compaction sits between two requests: order it before the one it lands on.
    ...index.compactions.map<EventRow>((event) => ({ kind: 'compaction', order: event.afterIndex - 0.5, event })),
    ...index.shrinks
      .filter((p) => !p.shrink?.compacted)
      .map<EventRow>((point) => ({ kind: 'shrink', order: point.index, point })),
    ...index.recaches.map<EventRow>((point) => ({ kind: 'recache', order: point.index, point })),
  ].sort((a, b) => a.order - b.order);

  const last = index.compactions[index.compactions.length - 1];

  const rowProps = (uuid: string) =>
    jump
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: () => {
            if (hasSelection()) return;
            jump(uuid);
          },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            jump(uuid);
          },
        }
      : {};

  if (rows.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-[var(--text-dim)]">
        No compactions, shrinks or re-caches in this session.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3 text-xs text-[var(--text-dim)]">
      {rows.map((row) => {
        if (row.kind === 'compaction') {
          const { event } = row;
          const b = event.boundary;
          const s = event.point?.shrink;
          return (
            <div
              key={event.uuid}
              {...rowProps(event.uuid)}
              className={`rounded border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 select-text ${jump ? 'cursor-pointer hover:bg-amber-500/10' : ''}`}
              title={jump ? 'Open this compaction in the conversation' : undefined}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300 uppercase">
                  compaction{b.trigger ? ` · ${b.trigger}` : ''}
                </span>
                <span className="tabular-nums">{formatDateTime(event.timestamp)}</span>
                {b.preTokens !== null && b.postTokens !== null && (
                  <span
                    className="font-mono"
                    title="The boundary's own figures: postTokens is the summary alone, not the context afterwards"
                  >
                    boundary {formatContextTokens(b.preTokens)} → {formatContextTokens(b.postTokens)}
                  </span>
                )}
                {s ? (
                  <span className="font-mono" title="Measured between the requests either side — summary plus system prompt, tools, memory and the new prompt">
                    measured {formatContextTokens(s.from)} → {formatContextTokens(s.to)}
                  </span>
                ) : event.point ? (
                  <span>no measured drop followed</span>
                ) : event === last ? (
                  <span>no request since — drop not measurable yet</span>
                ) : (
                  <span>superseded before any request</span>
                )}
                {jump && <span className="ml-auto text-[var(--text-dim)]/70">→</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] opacity-80">
                {b.durationMs !== null && <span>took {Math.round(b.durationMs / 1000)} s</span>}
                {b.preservedMessages !== null && <span>{b.preservedMessages} messages kept</span>}
                {b.droppedTokens !== null && (
                  <span>{formatContextTokens(b.droppedTokens)} dropped in the session so far</span>
                )}
                <span title="The call that wrote the summary leaves no usage in the transcript">cost not recorded</span>
              </div>
            </div>
          );
        }
        if (row.kind === 'shrink') {
          const { point } = row;
          return (
            <div
              key={`shrink-${point.uuid}`}
              {...rowProps(point.uuid)}
              className={`rounded border border-[var(--border)] px-2.5 py-1.5 select-text ${jump ? 'cursor-pointer hover:bg-[var(--border)]/30' : ''}`}
              title={jump ? 'Open this request in the conversation' : undefined}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-slate-300 uppercase">
                  shrink
                </span>
                <span className="tabular-nums">{formatDateTime(point.timestamp)}</span>
                <span className="font-mono">
                  {formatContextDelta(point.delta ?? 0)} ({formatContextTokens(point.shrink?.from ?? 0)} →{' '}
                  {formatContextTokens(point.shrink?.to ?? 0)})
                </span>
                <span>no compaction boundary recorded</span>
                {jump && <span className="ml-auto text-[var(--text-dim)]/70">→</span>}
              </div>
            </div>
          );
        }
        const { point } = row;
        const cost = sumRecacheCost([point], prices);
        return (
          <div
            key={`recache-${point.uuid}`}
            {...rowProps(point.uuid)}
            className={`rounded border border-amber-500/25 px-2.5 py-1.5 select-text ${jump ? 'cursor-pointer hover:bg-amber-500/10' : ''}`}
            title={jump ? 'Open this request in the conversation' : undefined}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300 uppercase">
                re-cache
              </span>
              <span className="tabular-nums">{formatDateTime(point.timestamp)}</span>
              <span className="font-mono tabular-nums">
                {point.recached.toLocaleString()} tok
                {cost !== null && cost.billed !== null && ` · ≈${formatUsd(cost.billed)}`}
              </span>
              <span className="min-w-0">{recacheCauseText(point.recacheCause, point.gapMs)}</span>
              {jump && <span className="ml-auto text-[var(--text-dim)]/70">→</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
