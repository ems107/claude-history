import type { UsageWindow } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { formatDateTime, relativeTime, timeUntil } from '../lib/format.ts';

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-red-400';
  if (pct >= 70) return 'bg-amber-400';
  return 'bg-emerald-400';
}

function Bar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <span className={`inline-block overflow-hidden rounded-sm bg-[var(--border)] ${className}`}>
      <span
        className={`block h-full rounded-sm ${barColor(pct)}`}
        // A few percent still has to look like a bar, not a dot.
        style={{ width: `${Math.min(100, Math.max(3, pct))}%` }}
      />
    </span>
  );
}

/** Circular arrow: "resets in". */
function ResetIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-2.5 w-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" />
      <path d="M13.5 1.5V4h-2.5" />
    </svg>
  );
}

function WindowRow({ w }: { w: UsageWindow }) {
  const left = timeUntil(w.resetsAt);
  return (
    <div className="text-xs">
      <div className="flex items-baseline gap-2">
        {/* The label never truncates; the countdown yields space instead. */}
        <span className="shrink-0 whitespace-nowrap">{w.label}</span>
        {left && <span className="min-w-0 flex-1 truncate text-right text-[11px] text-[var(--text-dim)]">resets in {left}</span>}
        <span className="ml-auto shrink-0 font-mono font-semibold">{Math.round(w.utilization)}%</span>
      </div>
      <Bar pct={w.utilization} className="mt-1 h-1.5 w-full" />
      {w.resetsAt && <div className="mt-0.5 text-[11px] text-[var(--text-dim)]/70">{formatDateTime(w.resetsAt)}</div>}
    </div>
  );
}

/**
 * Claude subscription usage in the header: the 5-hour window and the weekly
 * one, same numbers as Claude Code's /usage. Read-only — the server reads the
 * stored OAuth token and never refreshes it.
 */
export function UsageWidget() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const refreshMs = Math.max(15, settings.data?.settings.usageIntervalSeconds ?? 60) * 1000;
  const { data } = useQuery({
    queryKey: ['usage'],
    queryFn: api.usage,
    refetchInterval: refreshMs,
    refetchIntervalInBackground: false, // don't poll while the tab is hidden
  });

  // Re-render on a slow tick so the countdowns stay honest between refetches.
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  if (!data || (!data.available && !data.error)) return null; // disabled in settings

  const five = data.windows.find((w) => w.key === 'five_hour');
  const week = data.windows.find((w) => w.key === 'seven_day');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // No outer frame: the per-window chips are the only boxes, so each
        // countdown visibly belongs to the figure it sits with.
        className="group flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-dim)]"
        title={data.error ?? 'Claude subscription usage — click for details'}
      >
        {data.error ? (
          <span className="rounded-md border border-[var(--border)] px-2 py-1 text-amber-400">usage n/a</span>
        ) : (
          <>
            {/* One pill per window, so the countdown clearly belongs to the
                figure on its left and not to the next window's label. */}
            {[
              ['5h', five] as const,
              ['wk', week] as const,
            ].map(([label, w]) =>
              w ? (
                <span
                  key={label}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-white/[0.03] px-2 py-1 group-hover:border-[var(--text-dim)]"
                  title={`${w.label} — ${Math.round(w.utilization)}% used${
                    timeUntil(w.resetsAt) ? `, resets in ${timeUntil(w.resetsAt)}` : ''
                  }`}
                >
                  <span className="opacity-60">{label}</span>
                  <Bar pct={w.utilization} className="h-1.5 w-8" />
                  <span className="font-mono font-semibold text-[var(--text)]">{Math.round(w.utilization)}%</span>
                  {/* Rounded down: "2 hr" while 2 h 45 min remain. */}
                  {timeUntil(w.resetsAt, true) && (
                    <span className="flex items-center gap-0.5 opacity-50">
                      <ResetIcon />
                      {timeUntil(w.resetsAt, true)}
                    </span>
                  )}
                </span>
              ) : null,
            )}
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-84 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-3 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xs font-semibold">Claude usage</h3>
              {data.subscriptionType && (
                <span className="rounded bg-zinc-500/15 px-1.5 py-px text-[10px] uppercase">{data.subscriptionType}</span>
              )}
              <button
                type="button"
                onClick={() => void api.usageRefresh().then((u) => queryClient.setQueryData(['usage'], u))}
                className="ml-auto cursor-pointer rounded border border-[var(--border)] px-1.5 py-px text-[11px] text-[var(--text-dim)] hover:border-[var(--text-dim)]"
              >
                Refresh
              </button>
            </div>
            {data.error ? (
              <p className="text-xs text-amber-400">{data.error}</p>
            ) : (
              <div className="space-y-2.5">
                {data.windows.map((w) => (
                  <WindowRow key={w.key} w={w} />
                ))}
              </div>
            )}
            <p className="mt-3 text-[10px] leading-snug text-[var(--text-dim)]">
              Same figures as Claude Code’s /usage. Read from your stored session, never modified; refreshed every{' '}
              {Math.round(refreshMs / 1000)}s{data.fetchedAt ? ` · last ${relativeTime(data.fetchedAt)}` : ''}.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
