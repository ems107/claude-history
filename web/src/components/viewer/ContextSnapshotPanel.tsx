import type { CompactBoundary, ContextSnapshot } from '@claude-history/shared';
import { useState } from 'react';
import { formatContextTokens } from '../../lib/context.ts';

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString());

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
  const deferred = snapshot.categories.filter((c) => c.deferred);
  const deferredTotal = deferred.reduce((a, c) => a + c.tokens, 0);
  const loaded = snapshot.categories.filter((c) => !c.deferred && !/free space/i.test(c.label));
  const free = snapshot.categories.find((c) => /free space/i.test(c.label));
  const widest = Math.max(...snapshot.categories.map((c) => c.tokens), 1);

  const Bar = ({ tokens, dim }: { tokens: number; dim?: boolean }) => (
    <span className="block h-1 rounded-full bg-[var(--border)]">
      <span
        className={`block h-1 rounded-full ${dim ? 'bg-[var(--text-dim)]/40' : 'bg-[var(--accent)]/70'}`}
        style={{ width: `${Math.max(1, (tokens / widest) * 100)}%` }}
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

      {snapshot.mcpTools.length > 0 && (
        <div className="mt-1.5 border-t border-[var(--border)] pt-1.5">
          <button
            type="button"
            onClick={() => setShowMcp((v) => !v)}
            className="cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            {showMcp ? '▾' : '▸'} {snapshot.mcpTools.length} MCP tools ·{' '}
            {fmt(snapshot.mcpTools.reduce((a, t) => a + t.tokens, 0))} tokens
          </button>
          {showMcp && (
            <table className="mt-1 w-full">
              <tbody>
                {[...snapshot.mcpTools]
                  .sort((a, b) => b.tokens - a.tokens)
                  .map((t) => (
                    <tr key={t.tool} className="border-t border-[var(--border)]">
                      <td className="py-px pr-2 font-mono break-all">{t.tool}</td>
                      <td className="py-px pr-2 text-[var(--text-dim)]">{t.server}</td>
                      <td className="py-px text-right font-mono tabular-nums">{t.tokens}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** A compaction boundary: the one place the transcript states one outright. */
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
    </div>
  );
}
