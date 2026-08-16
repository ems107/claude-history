import type { CompactBoundary, ContextSnapshot } from '@claude-history/shared';
import { useMemo, useRef, useState } from 'react';
import { formatContextTokens } from '../../lib/context.ts';
import { FoldHeader } from './FoldHeader.tsx';
import { Markdown } from './Markdown.tsx';
import { CopyActions } from './MessageActions.tsx';

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString());

/** Under a group already headed by `jira-pccom`, the prefix is noise. */
function shortToolName(tool: string, server: string): string {
  const prefix = `mcp__${server}__`;
  return tool.startsWith(prefix) ? tool.slice(prefix.length) : tool;
}

/**
 * A `/context` run, rendered where it happened.
 *
 * This is the only place in the app that shows a per-category split or a share
 * of the window, and it may: both were computed by Claude Code against the real
 * limit and are quoted, not derived. The deferred rows are called out because
 * they are counted by /context and are NOT in the context — subtract them and
 * the categories add up to the reported total exactly.
 */
export function ContextSnapshotPanel({ snapshot }: { snapshot: ContextSnapshot }) {
  const [showMcp, setShowMcp] = useState(false);
  const [openServers, setOpenServers] = useState<ReadonlySet<string>>(() => new Set());
  const deferred = snapshot.categories.filter((c) => c.deferred);
  const deferredTotal = deferred.reduce((a, c) => a + c.tokens, 0);
  const loaded = snapshot.categories.filter((c) => !c.deferred && !/free space/i.test(c.label));
  const free = snapshot.categories.find((c) => /free space/i.test(c.label));
  const widest = Math.max(...snapshot.categories.map((c) => c.tokens), 1);

  // /context prints one flat list of tools ordered by weight, which interleaves
  // the servers: the 12 Jira tools are scattered among the 18 devtools ones and
  // nothing says what Jira costs. The question a reader has first is per server
  // — which connection is worth its tokens — and only then which of its tools
  // is the expensive one, so the table is grouped and each server folds.
  const mcpServers = useMemo(() => {
    const byServer = new Map<string, { server: string; tokens: number; tools: ContextSnapshot['mcpTools'] }>();
    for (const t of snapshot.mcpTools) {
      const group = byServer.get(t.server) ?? { server: t.server, tokens: 0, tools: [] };
      group.tokens += t.tokens;
      group.tools.push(t);
      byServer.set(t.server, group);
    }
    for (const group of byServer.values()) group.tools.sort((a, b) => b.tokens - a.tokens);
    return [...byServer.values()].sort((a, b) => b.tokens - a.tokens || a.server.localeCompare(b.server));
  }, [snapshot.mcpTools]);
  const mcpTotal = mcpServers.reduce((a, s) => a + s.tokens, 0);
  const widestServer = Math.max(...mcpServers.map((s) => s.tokens), 1);

  const Bar = ({ tokens, dim, max = widest }: { tokens: number; dim?: boolean; max?: number }) => (
    <span className="block h-1 rounded-full bg-[var(--border)]">
      <span
        className={`block h-1 rounded-full ${dim ? 'bg-[var(--text-dim)]/40' : 'bg-[var(--accent)]/70'}`}
        style={{ width: `${Math.max(1, (tokens / max) * 100)}%` }}
      />
    </span>
  );

  const Row = ({ label, tokens, pct, dim }: { label: string; tokens: number; pct: number; dim?: boolean }) => (
    <div className="grid grid-cols-[10rem_1fr_5rem_3.5rem] items-center gap-2 py-0.5">
      <span className={dim ? 'text-[var(--text-dim)]' : ''}>{label}</span>
      <Bar tokens={tokens} dim={dim} />
      <span className="text-right font-mono tabular-nums">{fmt(tokens)}</span>
      <span className="text-right font-mono text-[var(--text-dim)] tabular-nums">{pct}%</span>
    </div>
  );

  return (
    <div className="my-2 rounded border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-sky-300 uppercase">
          /context
        </span>
        {snapshot.model && <span className="font-mono text-[var(--text-dim)]">{snapshot.model}</span>}
        <span className="font-mono">
          {fmt(snapshot.reportedTokens)}
          {snapshot.limitTokens !== null && (
            <span className="text-[var(--text-dim)]"> / {formatContextTokens(snapshot.limitTokens)}</span>
          )}
          {snapshot.reportedPct !== null && <span className="text-[var(--text-dim)]"> ({snapshot.reportedPct}%)</span>}
        </span>
      </div>

      {loaded.map((c) => (
        <Row key={c.label} label={c.label} tokens={c.tokens} pct={c.pct} />
      ))}
      {free && <Row label={free.label} tokens={free.tokens} pct={free.pct} dim />}

      {deferred.length > 0 && (
        <div className="mt-1.5 border-t border-[var(--border)] pt-1.5">
          {deferred.map((c) => (
            <Row key={c.label} label={c.label} tokens={c.tokens} pct={c.pct} dim />
          ))}
          <p className="mt-1 text-[10px] text-[var(--text-dim)]">
            Deferred tools are counted by <span className="font-mono">/context</span> but are not loaded into the
            context: those {fmt(deferredTotal)} tokens are exactly the gap between the categories and the{' '}
            {fmt(snapshot.reportedTokens)} reported above.
          </p>
        </div>
      )}

      {mcpServers.length > 0 && (
        <div className="mt-1.5 border-t border-[var(--border)] pt-1.5">
          <FoldHeader
            open={showMcp}
            onToggle={() => setShowMcp((v) => !v)}
            className="inline-block text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            {showMcp ? '▾' : '▸'} {mcpServers.length} MCP {mcpServers.length === 1 ? 'server' : 'servers'} ·{' '}
            {snapshot.mcpTools.length} tools · {fmt(mcpTotal)} tokens
          </FoldHeader>
          {showMcp && (
            <div className="mt-1">
              {mcpServers.map((s) => {
                const open = openServers.has(s.server);
                return (
                  <div key={s.server} className="border-t border-[var(--border)]">
                    <FoldHeader
                      open={open}
                      onToggle={() =>
                        setOpenServers((prev) => {
                          const next = new Set(prev);
                          if (!next.delete(s.server)) next.add(s.server);
                          return next;
                        })
                      }
                      className="grid grid-cols-[12rem_1fr_5rem_4rem] items-center gap-2 py-0.5 hover:text-[var(--text)]"
                    >
                      <span className="truncate font-mono">
                        <span className="text-[var(--text-dim)]">{open ? '▾' : '▸'}</span> {s.server}
                      </span>
                      <Bar tokens={s.tokens} max={widestServer} />
                      <span className="text-right font-mono tabular-nums">{fmt(s.tokens)}</span>
                      <span className="text-right text-[10px] text-[var(--text-dim)] tabular-nums">
                        {s.tools.length} tools
                      </span>
                    </FoldHeader>
                    {open && (
                      <div className="mb-1 ml-2 border-l border-[var(--border)] pl-3">
                        {s.tools.map((t) => (
                          <div key={t.tool} className="grid grid-cols-[1fr_5rem] gap-2 py-px">
                            <span className="font-mono break-all text-[var(--text-dim)]">
                              {shortToolName(t.tool, s.server)}
                            </span>
                            <span className="text-right font-mono tabular-nums">{fmt(t.tokens)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A compaction boundary: the one place the transcript states one outright.
 *
 * It carries no cost pill because there is nothing to price: the call that wrote
 * the summary is recorded nowhere — no assistant line, and the summary itself
 * (`isCompactSummary`) is a `user` line with no `usage` (3 of 3 boundaries on
 * this machine). The spend is real — the whole conversation in, the summary out —
 * so the panel says so rather than letting the absence read as "it was free".
 */
export function CompactBoundaryPanel({ boundary }: { boundary: CompactBoundary }) {
  const dropped =
    boundary.preTokens !== null && boundary.postTokens !== null ? boundary.preTokens - boundary.postTokens : null;
  return (
    <div className="my-2 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300 uppercase">
          compacted{boundary.trigger ? ` · ${boundary.trigger}` : ''}
        </span>
        {boundary.preTokens !== null && boundary.postTokens !== null && (
          <span className="font-mono">
            {formatContextTokens(boundary.preTokens)} → {formatContextTokens(boundary.postTokens)}
            {dropped !== null && (
              <span className="text-[var(--text-dim)]"> ({formatContextTokens(dropped)} dropped)</span>
            )}
          </span>
        )}
        {boundary.preservedMessages !== null && (
          <span className="text-[var(--text-dim)]">{boundary.preservedMessages} messages kept</span>
        )}
        {boundary.durationMs !== null && (
          <span className="text-[var(--text-dim)]">took {Math.round(boundary.durationMs / 1000)} s</span>
        )}
        {boundary.droppedTokens !== null && (
          <span className="text-[var(--text-dim)]">
            {formatContextTokens(boundary.droppedTokens)} dropped in this session so far
          </span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-dim)]">
        No cost here because none was recorded: the call that wrote the summary leaves no{' '}
        <span className="font-mono">usage</span> in the transcript, so its spend — this whole conversation in, the
        summary out — is real but is not part of the session total.
      </p>
    </div>
  );
}

/**
 * The summary a compaction wrote. Claude Code appends it as an ordinary `user`
 * line, so the viewer used to show it as a 17,000-character prompt nobody
 * typed. It is the head of the new context, not a message: collapsed by
 * default, and rendered as the markdown it is when opened.
 */
export function CompactSummaryPanel({ id, text }: { id: string; text: string }) {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  return (
    // `group/bubble` so the copy buttons reveal on hover exactly as they do on a
    // user or assistant bubble — this is the one thing here that IS a message's
    // worth of text, whoever wrote it.
    <div id={id} className="group/bubble my-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <FoldHeader open={open} onToggle={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="text-[var(--text-dim)]">{open ? '▾' : '▸'}</span>
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300 uppercase">
            carried-over summary
          </span>
          <span className="min-w-0 truncate text-[var(--text-dim)]">
            {text.length.toLocaleString()} characters — everything above, as the model kept it
          </span>
        </FoldHeader>
        {/* Only while open, and for the same reason the bubbles' buttons copy
            only what they rendered: the formatted copy reads the node on
            screen, and folded there is none — a button that silently did
            nothing would be worse than no button. */}
        {open && <CopyActions markdown={() => text} body={body} />}
      </div>
      {open && (
        <div ref={body} className="mt-2 border-t border-[var(--border)] pt-2">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}
