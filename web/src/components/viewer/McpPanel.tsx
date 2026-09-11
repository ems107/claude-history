import type { McpPicture, McpServer, McpServerLog, McpStatus } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../api/client.ts';
import { durationBetween, formatDateTime, formatMs, formatTimeOfDay } from '../../lib/format.ts';
import { Fold } from '../Fold.tsx';
import { Chip } from './Chip.tsx';

/**
 * How each status reads, and what it is worth being told.
 *
 * `warn` is the amber of `Chip` and of the rail's mark, and it covers three of
 * the five: a server that never connected, one still waiting to be signed into,
 * one that was left mid-handshake. None of them is red — `BlockedBar` keeps red
 * for what actually broke, and the session ran, it just ran without something.
 */
const STATUS: Record<McpStatus, { label: string; warn: boolean; title: string }> = {
  connected: {
    label: 'connected',
    warn: false,
    title: 'Its tools were offered to the model. Claude Code writes no list of servers that worked, so this is what "connected" is made of.',
  },
  failed: {
    label: 'failed',
    warn: true,
    title: 'It never connected, and the session ran without it',
  },
  pending: {
    label: 'pending',
    warn: true,
    title: 'Still connecting the last time the transcript said anything about it',
  },
  'needs-auth': {
    label: 'needs auth',
    warn: true,
    title: 'It was waiting to be signed into',
  },
  unknown: {
    label: 'unknown',
    warn: false,
    title: 'It stopped being listed as failed, pending or unauthenticated without its tools ever being offered — so it was neither connected nor broken, and saying so beats guessing',
  },
};

function ServerRow({ server, log }: { server: McpServer; log: McpServerLog | null }) {
  const s = STATUS[server.status];
  const used = server.tools.filter((t) => t.calls > 0).length;
  return (
    <div className="rounded border border-[var(--border)] px-2 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text)]" title={server.name}>
          {server.name}
        </span>
        <Chip tone={s.warn ? 'warn' : 'quiet'} title={s.title}>
          {s.label}
        </Chip>
      </div>

      {/* The error, verbatim. It is the whole reason this panel is worth
          opening on a session that went wrong, and it exists nowhere else. */}
      {server.errorCode !== null && (
        <div className="mt-1 text-[11px] break-words text-amber-300/80">
          <span className="font-mono">{server.errorCode}</span>
          {server.error ? ` — “${server.error}”` : ''}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-dim)]">
        {/* What the session DID with it, which is the fact that separates a
            server it leaned on from one that merely sat there. */}
        {server.callCount > 0 && (
          <span title="Tool calls this session actually made to it">
            <b className="text-[var(--text)]">{server.callCount}</b> call{server.callCount === 1 ? '' : 's'}
          </span>
        )}
        {/* How long it really took to answer — the CLI's own measurement, and
            nothing in the transcript comes close to it. 10 s of handshake is
            the difference between a server that works and one you are about to
            watch time out. */}
        {log?.connectMs != null && (
          <span title="How long the handshake took, from Claude Code's own log">
            handshake <b className="text-[var(--text)]">{formatMs(log.connectMs)}</b>
          </span>
        )}
        {server.since !== null && (
          <span title={`In this state since ${formatDateTime(server.since)}`}>{formatDateTime(server.since)}</span>
        )}
      </div>

      {server.tools.length > 0 && (
        <Fold
          label={
            // Two numbers, because the interesting one is the gap: a server
            // offering 18 tools of which the session touched 2 still paid the
            // tool budget for all 18.
            server.callCount > 0
              ? `${server.tools.length} tools · ${used} used`
              : `${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}`
          }
        >
          <div className="flex flex-col gap-0.5 text-[11px]">
            {server.tools.map((t) => (
              <div key={t.name} className="flex items-baseline gap-2">
                {/* A tool nobody called is dimmed rather than hidden: it is
                    what the model was offered, and what it ignored. */}
                <span className={`min-w-0 flex-1 truncate font-mono ${t.calls > 0 ? 'text-[var(--text)]' : 'text-[var(--text-dim)]/60'}`}>
                  {t.name}
                </span>
                {t.calls > 0 && (
                  <span className="shrink-0 tabular-nums text-[var(--text-dim)]">
                    {t.calls}×
                  </span>
                )}
              </div>
            ))}
          </div>
        </Fold>
      )}

      {/* What the CLI itself saw. The transcript knows two error codes and a
          templated sentence; this is the server's own stderr, which is where
          the reason actually is — a `CONNECT_TIMEOUT` above against "Sources
          changed, rebuilding MCP server" down here. */}
      {log && log.entries.length > 0 && (
        <Fold
          label={`${log.entries.length}${log.truncated ? '+' : ''} log line${log.entries.length === 1 ? '' : 's'}`}
        >
          <div className="flex flex-col gap-1 text-[11px]">
            {log.truncated && (
              <div className="text-[var(--text-dim)]/60 italic">
                the newest {log.entries.length} only — a failure is at the end
              </div>
            )}
            {log.entries.map((e, i) => {
              // A day heading where the day turns over, and bare clocks under
              // it — which is what `formatTimeOfDay` is documented for. These
              // logs span a session's whole life: `b7505527` reaches over
              // eleven days, and eleven days of bare `12:06` say nothing.
              const day = e.when ? e.when.slice(0, 10) : null;
              const newDay = day !== null && day !== (log.entries[i - 1]?.when?.slice(0, 10) ?? null);
              return (
                <div key={i}>
                  {newDay && (
                    <div className="mt-1 mb-0.5 text-[10px] font-semibold text-[var(--text-dim)]/70">
                      {formatDateTime(e.when).split(' ')[0]}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <span className="shrink-0 font-mono text-[10px] text-[var(--text-dim)]/60">
                      {formatTimeOfDay(e.when)}
                    </span>
                    <span
                      className={`min-w-0 flex-1 font-mono break-words whitespace-pre-wrap ${
                        e.kind === 'error' ? 'text-amber-300/80' : 'text-[var(--text-dim)]'
                      }`}
                    >
                      {e.text}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Fold>
      )}
    </div>
  );
}

/**
 * The MCP servers a session had, and what became of them.
 *
 * This is the only place the answer exists. `/mcp` in a terminal describes the
 * machine NOW; nothing else describes a session that ran in August, with the
 * error text of the server that was down that afternoon. It is read out of the
 * `deferred_tools_delta` lines Claude Code writes at startup and again on every
 * resume — see the parser, which holds the rules for reading them.
 *
 * **A snapshot with a time on it, never "now".** A server can die mid-session
 * without the transcript hearing about it, so every row says when it entered
 * the state it is in rather than claiming it is still in it.
 */
export function McpPanel({
  sessionId,
  mcp,
  onGoToMessage,
}: {
  sessionId: string;
  mcp: McpPicture;
  onGoToMessage: (uuid: string) => void;
}) {
  // Lazily, and only here: it is ~39 files per project on disk, and the session
  // payload must not pay for them to draw a conversation.
  const logs = useQuery({ queryKey: ['mcp-logs', sessionId], queryFn: () => api.mcpLogs(sessionId) });
  const logByKey = useMemo(
    () => new Map((logs.data?.servers ?? []).map((s) => [s.key, s])),
    [logs.data],
  );

  const nameOf = useMemo(() => {
    const byKey = new Map(mcp.servers.map((s) => [s.key, s.name]));
    // By key and never by a name copied into the event: a server gets renamed
    // mid-session when its own tools arrive after the needs-auth list named it.
    return (key: string) => byKey.get(key) ?? key;
  }, [mcp.servers]);

  /** One entry per instant, because a startup moves several servers at once. */
  const moments = useMemo(() => {
    const byWhen = new Map<string, typeof mcp.events>();
    for (const e of mcp.events) {
      const k = e.when ?? '';
      byWhen.set(k, [...(byWhen.get(k) ?? []), e]);
    }
    return [...byWhen.entries()];
  }, [mcp.events]);

  return (
    <div className="px-4 py-3">
      {/* The name and the count are the inspector's title bar now. */}
      <div className="mb-2 text-[11px] text-[var(--text-dim)]/80">
        what this session had plugged in, as its own transcript recorded it at the time — not what the machine offers
        now
      </div>

      <div className="space-y-1">
        {mcp.servers.map((s) => (
          <ServerRow key={s.key} server={s} log={logByKey.get(s.key) ?? null} />
        ))}
      </div>

      {/* No logs is ordinary rather than a failure — this is a folder Claude
          Code keeps for its own reasons, outside `~/.claude`, and a session
          older than it simply has none. Said once, at the foot, instead of on
          every row. */}
      {logs.data && !logs.data.available && (
        <div className="mt-2 text-[10px] text-[var(--text-dim)]/60">
          Claude Code kept no MCP logs for this project — only the transcript's own account above.
        </div>
      )}

      {/* One moment is the startup and needs no list: every row above already
          says when it happened. More than one means something CHANGED — a
          server that took its time, one that came back on the next resume — and
          that is a story the rows alone cannot tell. */}
      {moments.length > 1 && (
        <>
          <div className="mt-3 mb-1 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
            History
          </div>
          <div className="space-y-1.5">
            {moments.map(([when, events], i) => {
              // The gap, not the clock. Between a server that took six seconds
              // to come up and a session picked up the next morning the
              // absolute times differ by two characters and the meaning by
              // everything.
              const gap = i > 0 ? durationBetween(moments[i - 1][0], when) : null;
              // Every event of one instant came off the same line, so they
              // share an anchor; take the first that has one.
              const anchor = events.find((e) => e.anchor !== null)?.anchor ?? null;
              return (
                <div key={when} className="text-[11px]">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[var(--text-dim)]">{when ? formatDateTime(when) : 'no timestamp'}</span>
                    {gap && <span className="text-[var(--text-dim)]/60">+{gap}</span>}
                    <span className="flex-1" />
                    {/* Where in the conversation this happened. The line it
                        came off is not drawn — it is not a message — so the
                        anchor is the message above it, and a moment with none
                        is the startup of a session that had not begun. */}
                    {anchor && (
                      <button
                        type="button"
                        onClick={() => onGoToMessage(anchor)}
                        title="Go to where this happened in the conversation"
                        className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
                      >
                        ↓ here
                      </button>
                    )}
                  </div>
                  {events.map((e, n) => (
                    <div key={`${e.key}-${n}`} className="ml-2 flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-mono text-[var(--text)]">{nameOf(e.key)}</span>
                      <span className={STATUS[e.to].warn ? 'text-amber-300/90' : 'text-[var(--text-dim)]'}>
                        {e.from === null ? STATUS[e.to].label : `${STATUS[e.from].label} → ${STATUS[e.to].label}`}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
