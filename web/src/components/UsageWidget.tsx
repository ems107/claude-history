import type { UsageWindow } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { markUsageRead } from '../api/usageReason.ts';
import { formatDateTime, timeSince, timeUntil } from '../lib/format.ts';

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

/**
 * Circular arrow: "resets in". Sized in em so it tracks the (small) text it
 * annotates, `block` so it centres on the flex line instead of sitting on the
 * text baseline, and thin-stroked to match the weight of 10px type.
 */
function ResetIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="block h-[1.1em] w-[1.1em] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.7 8.7A5.7 5.7 0 1 1 12 4.2L14 6" />
      <path d="M14 2v4h-4" />
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
  const { data } = useQuery({ queryKey: ['usage'], queryFn: api.usage });

  /**
   * The idle fallback poll and the refetch on returning to the tab, driven here
   * instead of by `refetchInterval` / `refetchOnWindowFocus`. Same behaviour,
   * but each read can now say which of the two it was — TanStack's own options
   * fire from inside the library, where nothing can label them.
   *
   * The interval deliberately keeps running unfocused: the window often sits on
   * a second monitor while Claude works, and watching the bars move there is
   * half the point. A genuinely hidden tab gets throttled by the browser, which
   * is fine — nobody is looking — and becoming visible again reads at once.
   */
  useEffect(() => {
    const read = (trigger: 'widget-interval' | 'widget-focus') => {
      markUsageRead(trigger);
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    };
    const iv = setInterval(() => read('widget-interval'), refreshMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') read('widget-focus');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshMs, queryClient]);

  // Re-render on a tick so the countdowns stay honest between refetches. While
  // the popover is open it ticks every second, because the "last refreshed"
  // line down there counts seconds; closed, a slow tick is plenty for the
  // minute-grained countdowns in the header.
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), open ? 1_000 : 30_000);
    return () => clearInterval(iv);
  }, [open]);

  // A window flipping to 0% is the one change no activity announces, so the
  // idle poll would show a stale 90% for minutes after a reset. Read once,
  // just after the soonest one is due.
  const nextReset = data?.windows
    .map((w) => (w.resetsAt ? Date.parse(w.resetsAt) : Number.NaN))
    .filter((ms) => !Number.isNaN(ms) && ms > Date.now())
    .sort((a, b) => a - b)[0];
  useEffect(() => {
    if (nextReset === undefined) return;
    // setTimeout overflows past ~24.8 days and would fire immediately.
    const delay = Math.min(nextReset + 3_000 - Date.now(), 2_147_483_647);
    const t = setTimeout(() => {
      markUsageRead('widget-reset');
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    }, Math.max(0, delay));
    return () => clearTimeout(t);
  }, [nextReset, queryClient]);

  if (!data || (!data.available && !data.error)) return null; // disabled in settings

  const five = data.windows.find((w) => w.key === 'five_hour');
  const week = data.windows.find((w) => w.key === 'seven_day');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // One box, and inside it each window reads "label (resets) bar pct":
        // the countdown sits next to the label it belongs to, and the
        // percentage closes the group.
        className={`flex cursor-pointer items-center gap-4 rounded border px-2 py-1 text-[11px] text-[var(--text-dim)] hover:border-[var(--text-dim)] ${
          data.stale ? 'border-amber-400/40' : 'border-[var(--border)]'
        }`}
        title={
          data.error
            ? data.stale
              ? `Showing the last reading — ${data.error}`
              : data.error
            : 'Claude subscription usage — click for details'
        }
      >
        {data.windows.length === 0 ? (
          <span className="text-amber-400">usage n/a</span>
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
                  className="flex items-center gap-1.5"
                  title={`${w.label} — ${Math.round(w.utilization)}% used${
                    timeUntil(w.resetsAt) ? `, resets in ${timeUntil(w.resetsAt)}` : ''
                  }`}
                >
                  <span className="opacity-60">{label}</span>
                  {/* Secondary by weight, not by punctuation: the label opens
                      the group and the percentage closes it, so no brackets
                      are needed to tie the countdown to its window.
                      Rounded down: "2 hr" while 2 h 45 min remain. */}
                  {timeUntil(w.resetsAt, true) && (
                    <span className="flex items-center gap-[2px] text-[10px] leading-none opacity-40">
                      <ResetIcon />
                      {timeUntil(w.resetsAt, true)}
                    </span>
                  )}
                  <Bar pct={w.utilization} className="h-1.5 w-8" />
                  <span className="font-mono font-semibold text-[var(--text)]">{Math.round(w.utilization)}%</span>
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
            {/* A stale response still carries figures: show the warning above
                them rather than replacing them with it. */}
            {data.error && <p className="mb-2 text-xs text-amber-400">{data.error}</p>}
            {data.windows.length > 0 && (
              <div className="space-y-2.5">
                {data.windows.map((w) => (
                  <WindowRow key={w.key} w={w} />
                ))}
              </div>
            )}
            <p className="mt-3 text-[10px] leading-snug text-[var(--text-dim)]">
              Same figures as Claude Code’s /usage. Read from your stored session, never modified; refreshed on session
              activity, otherwise every {Math.round(refreshMs / 1000)}s
              {data.fetchedAt ? ` · last ${timeSince(data.fetchedAt)}` : ''}.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
