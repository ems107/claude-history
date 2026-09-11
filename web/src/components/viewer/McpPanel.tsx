import type { McpPicture, McpServer, McpStatus } from '@claude-history/shared';
import { useMemo } from 'react';
import { Fold } from '../Fold.tsx';
import { formatDateTime } from '../../lib/format.ts';
import { Chip } from './Chip.tsx';

/**
 * How each status reads, and what it is worth being told.
 *
 * `warn` is the amber of `Chip` and of the rail's badge, and it covers three of
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

function ServerRow({ server }: { server: McpServer }) {
  const s = STATUS[server.status];
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
        {server.since !== null && (
          <span title={`In this state since ${formatDateTime(server.since)}`}>{formatDateTime(server.since)}</span>
        )}
      </div>

      {server.tools.length > 0 && (
        <Fold label={`${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}`}>
          <div className="flex flex-col gap-0.5 font-mono text-[11px] text-[var(--text-dim)]">
            {server.tools.map((t) => (
              <span key={t}>{t}</span>
            ))}
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
 * resume — see the parser, which holds the four rules for reading them.
 *
 * **A snapshot with a time on it, never "now".** A server can die mid-session
 * without the transcript hearing about it, so every row says when it entered
 * the state it is in rather than claiming it is still in it.
 */
export function McpPanel({ mcp }: { mcp: McpPicture }) {
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
          <ServerRow key={s.key} server={s} />
        ))}
      </div>

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
            {moments.map(([when, events]) => (
              <div key={when} className="text-[11px]">
                <div className="text-[var(--text-dim)]">{when ? formatDateTime(when) : 'no timestamp'}</div>
                {events.map((e, i) => (
                  <div key={`${e.key}-${i}`} className="ml-2 flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-mono text-[var(--text)]">{nameOf(e.key)}</span>
                    <span className={STATUS[e.to].warn ? 'text-amber-300/90' : 'text-[var(--text-dim)]'}>
                      {e.from === null ? STATUS[e.to].label : `${STATUS[e.from].label} → ${STATUS[e.to].label}`}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
