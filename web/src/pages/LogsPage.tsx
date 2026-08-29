import { LOG_LEVELS, type LogLevel, type LogRecord } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { actionClass } from '../components/controlClass.ts';
import { copyPlain } from '../lib/clipboard.ts';
import { formatBytes, formatDateTime, relativeTime } from '../lib/format.ts';
import { hasSelection } from '../lib/selection.ts';

/** Diagnostics, so the whole thing lives under Settings rather than the nav. */

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'text-[var(--text-dim)] opacity-70',
  info: 'text-[var(--text-dim)]',
  warn: 'text-amber-400',
  error: 'text-red-400',
  fatal: 'text-red-400 font-semibold',
};

/** Time only: the day is already the thing you picked on the left. */
function clockTime(t: string): string {
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return t;
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function Chip({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-xs ${
        active ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
          aria-hidden="true"
        />
        <span className={`truncate ${tone ?? ''}`}>{label}</span>
      </span>
      <span className="shrink-0 font-mono text-[10px] opacity-60">{count}</span>
    </button>
  );
}

/** Put text on the clipboard and flash a confirmation on the button that did it. */
function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void copyPlain(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_200);
    });
  };
  return [copied, copy];
}

function Row({ record, showPid }: { record: LogRecord; showPid: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopy();
  const hasDetail = record.err !== undefined || record.data !== undefined || record.msg.length > 160;
  // Keep the expanded detail lined up with the message, whichever columns are on.
  const detailIndent = showPid ? 'ml-[10.25rem]' : 'ml-[6.5rem]';
  return (
    // A plain div, not a button: text inside a <button> cannot be selected, so
    // the row being one made a log message impossible to copy by hand — which is
    // most of what a log viewer is for.
    <div
      onClick={() => {
        // Do not fight a selection the user just made in order to copy it.
        if (hasSelection()) return;
        if (hasDetail) setOpen(!open);
      }}
      className={`group border-b border-[var(--border)]/40 px-3 py-1 font-mono text-[11px] hover:bg-[var(--bg-hover)]/40 ${
        hasDetail ? 'cursor-pointer' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0 text-[var(--text-dim)] opacity-70">{clockTime(record.t)}</span>
        <span className={`w-10 shrink-0 uppercase ${LEVEL_STYLE[record.lvl] ?? ''}`}>{record.lvl}</span>
        <span className="w-24 shrink-0 truncate text-[var(--accent)] opacity-80">{record.src}</span>
        {showPid && <span className="w-12 shrink-0 text-right text-[var(--text-dim)] opacity-70">{record.pid}</span>}
        <span className={`min-w-0 flex-1 select-text ${open ? 'break-words whitespace-pre-wrap' : 'truncate'}`}>
          {record.msg}
        </span>
        <button
          type="button"
          title="Copy this record as JSON"
          onClick={(e) => {
            e.stopPropagation();
            copy(JSON.stringify(record, null, 2));
          }}
          className="shrink-0 cursor-pointer px-1 text-[10px] text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:text-[var(--text)]"
        >
          {copied ? 'copied' : 'copy'}
        </button>
        <span className="w-3 shrink-0 text-[var(--text-dim)]">{hasDetail ? (open ? '▾' : '▸') : ''}</span>
      </div>
      {open && (
        <div className={`mt-1 ${detailIndent} space-y-1 text-[11px] text-[var(--text-dim)] select-text`}>
          {record.data !== undefined && (
            <pre className="overflow-x-auto rounded bg-black/30 p-2">{JSON.stringify(record.data, null, 2)}</pre>
          )}
          {record.err && <pre className="overflow-x-auto rounded bg-black/30 p-2 text-red-300/80">{record.err}</pre>}
          <div className="opacity-60">
            {formatDateTime(record.t)} · pid {record.pid}
          </div>
        </div>
      )}
    </div>
  );
}

/** The installer's own log: PowerShell-written plain text, shown as-is. */
function UpdateLogView() {
  const { data } = useQuery({ queryKey: ['updateLog'], queryFn: api.updateLog });
  if (!data) return <div className="p-6 text-xs text-[var(--text-dim)]">Loading…</div>;
  if (!data.available) {
    return (
      <div className="p-6 text-xs text-[var(--text-dim)]">
        No <span className="font-mono">update.log</span> yet.
        {data.path ? (
          <>
            {' '}
            It appears at <span className="font-mono break-all">{data.path}</span> the first time an update is applied.
          </>
        ) : (
          ' This instance is not a managed install (source or portable), so there is no installer log.'
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-dim)]">
        <span className="font-mono break-all">{data.path}</span> · {formatBytes(data.sizeBytes)} · last written{' '}
        {data.modifiedAt ? `${formatDateTime(data.modifiedAt)} (${relativeTime(data.modifiedAt)})` : 'unknown'}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] whitespace-pre-wrap">{data.text}</pre>
    </div>
  );
}

export function LogsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'update' ? 'update' : 'app';
  const levels = params.get('level')?.split(',').filter(Boolean) ?? [];
  const sources = params.get('src')?.split(',').filter(Boolean) ?? [];
  const query = params.get('q') ?? '';
  const [draftQuery, setDraftQuery] = useState(query);
  const [follow, setFollow] = useState(true);
  // Off by default — the pid only matters when you suspect two instances are
  // writing the same day's file — and remembered, like the viewer's toggles.
  const [showPid, setShowPid] = useState(() => localStorage.getItem('logsShowPid') === 'true');
  const [busy, setBusy] = useState(false);
  const [copiedAll, copyAll] = useCopy();

  const logs = useQuery({ queryKey: ['logs'], queryFn: api.logs, refetchOnWindowFocus: true, staleTime: 0 });
  const date = params.get('date') ?? logs.data?.days[0]?.date ?? '';

  const day = useQuery({
    queryKey: ['logDay', date, levels.join(','), sources.join(','), query],
    queryFn: () => api.logDay(date, { levels, sources, q: query }),
    enabled: date !== '',
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // Debounce typing into the URL, which is what actually triggers the request.
  useEffect(() => {
    if (draftQuery === query) return;
    const timer = setTimeout(() => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (draftQuery) next.set('q', draftQuery);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [draftQuery, query, setParams]);

  const setParam = (key: string, value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const toggle = (key: 'level' | 'src', value: string, all: string[]) => {
    // No parameter in the URL means "everything", so that is the starting set.
    const current = new Set(params.get(key)?.split(',').filter(Boolean) ?? all);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    // Everything ticked and nothing ticked both mean "no filter" — the second
    // because a view with every level off would just be an empty screen.
    const everything = current.size === all.length && all.every((v) => current.has(v));
    setParam(key, current.size === 0 || everything ? null : [...current].join(','));
  };

  const knownSources = useMemo(() => Object.keys(day.data?.sources ?? {}).sort(), [day.data]);
  const shownLevels = LOG_LEVELS.filter((l) => (day.data?.levels[l] ?? 0) > 0 || levels.includes(l));

  /**
   * New records arrive by SSE, which keeps this list live. Unticking "follow"
   * freezes what is on screen instead of stopping the refresh: records are
   * newest-first, so live ones are PREPENDED, and that shifts whatever you were
   * reading down the page. Deliberately keyed on `follow` alone — re-running it
   * whenever the data changes is exactly what would defeat the freeze.
   */
  const [frozen, setFrozen] = useState<LogRecord[] | null>(null);
  useEffect(() => {
    setFrozen(follow ? null : (day.data?.records ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);
  const records = frozen ?? day.data?.records ?? [];

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--border)] p-3">
        <div>
          <Link to="/settings" className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">
            ← Settings
          </Link>
          <h1 className="mt-2 text-sm font-semibold">Logs</h1>
        </div>

        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setParam('tab', null)}
            className={`w-full cursor-pointer rounded px-1.5 py-0.5 text-left text-xs ${
              tab === 'app' ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
            }`}
          >
            Application
          </button>
          <button
            type="button"
            onClick={() => setParam('tab', 'update')}
            className={`w-full cursor-pointer rounded px-1.5 py-0.5 text-left text-xs ${
              tab === 'update'
                ? 'bg-[var(--bg-hover)] text-[var(--text)]'
                : 'text-[var(--text-dim)] hover:text-[var(--text)]'
            }`}
          >
            update.log
          </button>
        </div>

        {tab === 'app' && (
          <>
            <div>
              <h2 className="mb-1 text-[11px] font-semibold text-[var(--text-dim)] uppercase">Day</h2>
              {logs.data?.days.length === 0 && <p className="text-xs text-[var(--text-dim)]">Nothing logged yet.</p>}
              <div className="space-y-0.5">
                {logs.data?.days.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setParam('date', d.date)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-xs ${
                      d.date === date
                        ? 'bg-[var(--bg-hover)] text-[var(--text)]'
                        : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                    }`}
                  >
                    <span className="font-mono">{d.date}</span>
                    <span className="shrink-0 text-[10px] opacity-60">{formatBytes(d.sizeBytes)}</span>
                  </button>
                ))}
              </div>
            </div>

            {shownLevels.length > 0 && (
              <div>
                <h2 className="mb-1 text-[11px] font-semibold text-[var(--text-dim)] uppercase">Level</h2>
                <div className="space-y-0.5">
                  {shownLevels.map((l) => (
                    <Chip
                      key={l}
                      label={l}
                      tone={LEVEL_STYLE[l]}
                      count={day.data?.levels[l] ?? 0}
                      active={levels.length === 0 || levels.includes(l)}
                      onClick={() => toggle('level', l, [...shownLevels])}
                    />
                  ))}
                </div>
              </div>
            )}

            {knownSources.length > 0 && (
              <div>
                <h2 className="mb-1 text-[11px] font-semibold text-[var(--text-dim)] uppercase">Source</h2>
                <div className="space-y-0.5">
                  {knownSources.map((s) => (
                    <Chip
                      key={s}
                      label={s}
                      count={day.data?.sources[s] ?? 0}
                      active={sources.length === 0 || sources.includes(s)}
                      onClick={() => toggle('src', s, knownSources)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto space-y-2 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-dim)]">
              <p>
                Level written: <span className="text-[var(--text)]">{logs.data?.level}</span> · kept{' '}
                <span className="text-[var(--text)]">{logs.data?.retentionDays} days</span>
              </p>
              <p className="font-mono break-all opacity-60">{logs.data?.logsDir}</p>
              <button
                type="button"
                className={actionClass}
                disabled={busy}
                onClick={() => {
                  if (!confirm('Delete every log file, including today?')) return;
                  setBusy(true);
                  void api
                    .clearLogs()
                    .then(() => {
                      void queryClient.invalidateQueries({ queryKey: ['logs'] });
                      void queryClient.invalidateQueries({ queryKey: ['logDay'] });
                    })
                    .finally(() => setBusy(false));
                }}
              >
                Delete all logs
              </button>
            </div>
          </>
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {tab === 'update' ? (
          <UpdateLogView />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2">
              <input
                type="text"
                value={draftQuery}
                onChange={(e) => setDraftQuery(e.target.value)}
                placeholder="Search messages…"
                spellCheck={false}
                className="w-64 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs focus:border-[var(--text-dim)] focus:outline-none"
              />
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-dim)]">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(e) => setFollow(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                follow
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-dim)]" title="Show the pid that wrote each record">
                <input
                  type="checkbox"
                  checked={showPid}
                  onChange={(e) => {
                    setShowPid(e.target.checked);
                    localStorage.setItem('logsShowPid', String(e.target.checked));
                  }}
                  className="accent-[var(--accent)]"
                />
                pid
              </label>
              {/* Copying the whole filtered set is the point: it is what you
                  paste elsewhere when asking someone what went wrong. */}
              <button
                type="button"
                className={actionClass}
                disabled={records.length === 0}
                title="Copy every record shown, one JSON object per line"
                onClick={() => copyAll(records.map((r) => JSON.stringify(r)).join('\n'))}
              >
                {copiedAll ? 'Copied' : 'Copy shown'}
              </button>
              <span className="ml-auto text-xs text-[var(--text-dim)]">
                {day.data ? `${records.length} of ${day.data.total} records` : ''}
                {day.data?.truncated && <span className="ml-2 text-amber-400">newest only</span>}
                {frozen && <span className="ml-2 text-amber-400">paused</span>}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {records.length === 0 && day.data && (
                <p className="p-6 text-xs text-[var(--text-dim)]">
                  Nothing matches. {query && 'Try clearing the search, or '}
                  pick another day on the left.
                </p>
              )}
              {records.map((r, i) => (
                <Row key={`${r.t}#${i}`} record={r} showPid={showPid} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
