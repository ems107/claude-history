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
    <span className={`inline-block overflow-hidden rounded-full bg-[var(--border)] ${className}`}>
      <span
        className={`block h-full rounded-full ${barColor(pct)}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </span>
  );
}

function WindowRow({ w }: { w: UsageWindow }) {
  const left = timeUntil(w.resetsAt);
  return (
    <div className="text-xs">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate">{w.label}</span>
        {left && <span className="text-[11px] text-[var(--text-dim)]">resets in {left}</span>}
        <span className="font-mono font-semibold">{Math.round(w.utilization)}%</span>
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
        className="flex cursor-pointer items-center gap-2 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-dim)] hover:border-[var(--text-dim)]"
        title={data.error ?? 'Claude subscription usage — click for details'}
      >
        {data.error ? (
          <span className="text-amber-400">usage n/a</span>
        ) : (
          <>
            {[
              ['5h', five] as const,
              ['wk', week] as const,
            ].map(([label, w]) =>
              w ? (
                <span key={label} className="flex items-center gap-1">
                  <span className="opacity-70">{label}</span>
                  <Bar pct={w.utilization} className="h-1.5 w-10" />
                  <span className="font-mono">{Math.round(w.utilization)}%</span>
                  {/* Rounded down: "2 hr" while 2 h 45 min remain. */}
                  {timeUntil(w.resetsAt, true) && (
                    <span className="opacity-50">· {timeUntil(w.resetsAt, true)}</span>
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
          <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-3 shadow-xl">
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
