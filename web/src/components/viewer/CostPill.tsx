import type { PriceTable } from '@claude-history/shared';
import { cacheWrite5mRate, resolvePrices } from '@claude-history/shared';
import { useRef, useState } from 'react';
import { type CostEntry, formatUsd, sumCost, sumUsage } from '../../lib/cost.ts';
import { shortModel } from '../../lib/format.ts';

/** Matches `w-84` on the card: the anchor is computed in px, so it has to. */
const CARD_WIDTH = 336;
/** Below this much room underneath the pill, the card grows upward instead. */
const CARD_SPACE = 260;

type Anchor = { left: number; top: number } | { left: number; bottom: number };

function tokens(n: number): string {
  return n.toLocaleString();
}

function answerTime(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const min = Math.floor(ms / 60_000);
  return `${min} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Spans, not divs: the card lives inside a span that can sit inside a button. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex justify-between gap-3">
      <span className="text-[var(--text-dim)]">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

/**
 * The price of one answer — or of a run of them — next to the model and the
 * time, with the whole breakdown behind a hover card.
 *
 * It appears in three places on purpose: on an assistant header, on a run of
 * tool calls (whose messages print no header of their own and hold over half
 * the spend), and on the turn. Every assistant message is counted exactly once
 * across the three, so the pills add up to the session total in the token
 * panel.
 */
export function CostPill({
  entries,
  prices,
  cumulative,
  sessionTotal,
  label,
  variant = 'inline',
}: {
  entries: CostEntry[];
  prices: PriceTable;
  /** Session spend up to and including these messages. */
  cumulative?: number | null;
  sessionTotal?: number | null;
  /** Prefix shown on the pill, e.g. "turn". */
  label?: string;
  variant?: 'inline' | 'badge';
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  if (entries.length === 0) return null;

  const total = sumCost(entries);
  const usage = sumUsage(entries);
  const single = entries.length === 1 ? entries[0] : null;
  const models = [...new Set(entries.map((e) => e.model ?? 'unknown'))];
  const rates = models.length === 1 ? resolvePrices(entries[0].model, prices) : undefined;
  const context = single ? single.usage.input + single.usage.cacheRead + single.usage.cacheCreate : null;

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.right - CARD_WIDTH), Math.max(8, window.innerWidth - CARD_WIDTH - 8));
    // Anchoring to the viewport bottom when there is no room below means the
    // card grows upward from the pill and can never overflow, whatever its
    // height — no need to guess that height beforehand.
    const spaceBelow = window.innerHeight - r.bottom;
    setAnchor(
      spaceBelow < CARD_SPACE && r.top > spaceBelow
        ? { left, bottom: window.innerHeight - r.top + 6 }
        : { left, top: r.bottom + 6 },
    );
  };

  // One row per cache-write TTL, because they bill at different rates: a
  // session writes 1h caches, a subagent 5m ones. Tokens with no TTL recorded
  // get a plain row and the 1h rate, the way the cost does.
  const unattributed = Math.max(0, usage.cacheCreate - usage.cacheCreate1h - usage.cacheCreate5m);
  const writeRows: Array<{ label: string; tokens: number; rate: number | undefined }> = [];
  if (usage.cacheCreate1h > 0) {
    writeRows.push({ label: 'cache write (1h)', tokens: usage.cacheCreate1h, rate: rates?.cacheWrite });
  }
  if (usage.cacheCreate5m > 0) {
    writeRows.push({
      label: 'cache write (5m)',
      tokens: usage.cacheCreate5m,
      rate: rates ? cacheWrite5mRate(rates) : undefined,
    });
  }
  if (unattributed > 0 || writeRows.length === 0) {
    writeRows.push({ label: 'cache write', tokens: unattributed, rate: rates?.cacheWrite });
  }

  const rows: Array<{ label: string; tokens: number; rate: number | undefined }> = [
    { label: 'input', tokens: usage.input, rate: rates?.input },
    ...writeRows,
    { label: 'cache read', tokens: usage.cacheRead, rate: rates?.cacheRead },
    { label: 'output', tokens: usage.output, rate: rates?.output },
  ];

  return (
    <span
      ref={ref}
      onMouseEnter={open}
      onMouseLeave={() => setAnchor(null)}
      className={
        variant === 'badge'
          ? 'shrink-0 cursor-default rounded border border-[var(--border)] px-1.5 py-px font-mono text-[10px] font-normal text-[var(--text-dim)] normal-case tabular-nums hover:border-[var(--text-dim)] hover:text-[var(--text)]'
          : 'shrink-0 cursor-default font-mono text-[10px] font-normal text-[var(--text-dim)] normal-case tabular-nums hover:text-[var(--text)]'
      }
    >
      {label && <span className="mr-1 opacity-70">{label}</span>}
      {total === null ? '—' : `≈${formatUsd(total)}`}
      {anchor && (
        <span
          className="pointer-events-none fixed z-50 block w-84 rounded border border-[var(--border)] bg-[var(--bg-raised)] p-2.5 text-left text-[11px] text-[var(--text)] shadow-2xl"
          style={anchor}
        >
          <span className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-[var(--border)] pb-1">
            <span className="min-w-0 truncate">
              {single ? (
                <>
                  <span className="font-mono">{shortModel(single.model) ?? 'unknown model'}</span>
                  {single.effort && <span className="ml-1 text-[var(--text-dim)]">· {single.effort} effort</span>}
                </>
              ) : (
                <>
                  <span>{entries.length} messages</span>
                  <span className="ml-1 font-mono text-[var(--text-dim)]">
                    · {models.map((m) => shortModel(m) ?? m).join(', ')}
                  </span>
                </>
              )}
            </span>
            <span className="shrink-0 font-mono tabular-nums">{total === null ? '—' : formatUsd(total)}</span>
          </span>

          <span className="block">
            {rows.map((row) => {
              const cost = row.rate === undefined ? null : (row.tokens * row.rate) / 1_000_000;
              const share = cost !== null && total ? Math.round((cost / total) * 100) : null;
              return (
                <span key={row.label} className="flex justify-between gap-2">
                  <span className="text-[var(--text-dim)]">{row.label}</span>
                  <span className="flex shrink-0 gap-3 font-mono tabular-nums">
                    <span className="w-20 text-right">{tokens(row.tokens)}</span>
                    <span className="w-14 text-right">{cost === null ? '—' : formatUsd(cost)}</span>
                    <span className="w-8 text-right text-[var(--text-dim)]">{share === null ? '' : `${share}%`}</span>
                  </span>
                </span>
              );
            })}
          </span>

          <span className="mt-1.5 block border-t border-[var(--border)] pt-1">
            {context !== null && <Line label="context at this point" value={`${tokens(context)} tok`} />}
            {single?.elapsedMs ? <Line label="answer time" value={answerTime(single.elapsedMs)} /> : null}
            {cumulative !== null && cumulative !== undefined && (
              <Line
                label="cumulative"
                value={
                  sessionTotal
                    ? `${formatUsd(cumulative)} · ${Math.round((cumulative / sessionTotal) * 100)}% of session`
                    : formatUsd(cumulative)
                }
              />
            )}
          </span>

          {rates ? (
            <span className="mt-1.5 block text-[10px] text-[var(--text-dim)]">
              rates per MTok:{' '}
              {[
                `$${rates.input} in`,
                ...writeRows.map((w) => `$${w.rate} ${w.label.replace('cache ', '')}`),
                `$${rates.cacheRead} read`,
                `$${rates.output} out`,
              ].join(' · ')}
            </span>
          ) : (
            <span className="mt-1.5 block text-[10px] text-amber-400/90">
              No price configured for {models.map((m) => shortModel(m) ?? m).join(', ')} — add it in Stats.
            </span>
          )}
          <span className="mt-1 block text-[10px] text-[var(--text-dim)] opacity-70">
            API-equivalent value at the prices configured in Stats — not actual subscription spend.
          </span>
        </span>
      )}
    </span>
  );
}
