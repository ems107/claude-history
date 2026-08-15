import type { PriceTable, Turn } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../api/client.ts';
import { costEntries } from '../../lib/cost.ts';
import { useFoldState } from '../../lib/folding.ts';
import { ZOOM_DEFAULT } from '../../lib/viewPrefs.ts';
import { CostPill } from './CostPill.tsx';
import { useSubagents } from './SubagentContext.ts';
import { TurnList } from './TurnList.tsx';

const NO_PRICES: PriceTable = {};
/** Stable identity while the transcript loads. */
const EMPTY_TURNS: Turn[] = [];

export function SubagentDrawer({
  sessionId,
  agentId,
  showThinking,
  zoom,
  scrollToTool,
  scrollToUuid,
  jumpNonce,
  onClose,
}: {
  sessionId: string;
  agentId: string;
  showThinking: boolean;
  /** The thread zoom, passed down rather than read again: this is a thread too. */
  zoom: number;
  /**
   * Anchors inside THIS transcript, which is where a nested agent's call and
   * report live — the agent that spawned it made the call and received the
   * report, so neither is in the conversation underneath.
   */
  scrollToTool?: string | null;
  scrollToUuid?: string | null;
  jumpNonce?: number;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ['subagent', sessionId, agentId],
    queryFn: () => api.subagent(sessionId, agentId),
  });
  const pricesQ = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  const prices = pricesQ.data?.prices ?? NO_PRICES;
  // Priced here from the parsed turns, and the enricher totals the same messages
  // from the same file for the session total — the two are checked against each
  // other (worst delta 2.7e-15 across every session with agents). What this cost
  // is NOT part of is the conversation's own row: none of it is in that file.
  const entries = useMemo(
    () => costEntries((query.data?.turns ?? []).flatMap((t) => t.items), prices),
    [query.data, prices],
  );
  // Its own fold state: the drawer has no header buttons, but its turns fold
  // exactly like the conversation's.
  const fold = useFoldState(query.data?.turns ?? EMPTY_TURNS, showThinking, agentId);

  // Where this one sits among the session's agents, so a drawer is not a dead
  // end: five agents sent out together are read one after another, and closing
  // and hunting for the next call in the conversation is the long way round.
  const subagents = useSubagents();
  const order = subagents ? [...subagents.byId.keys()] : [];
  const at = order.indexOf(agentId);
  const step = (delta: number): (() => void) | undefined => {
    const next = order[at + delta];
    return at >= 0 && next ? () => subagents?.openAgent(next) : undefined;
  };
  const previous = step(-1);
  const following = step(1);
  const call = subagents?.byId.get(agentId)?.toolUseId;

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[44rem] max-w-[90vw] flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs font-semibold text-sky-400">
          ⑂ {query.data?.meta.agentType ?? 'subagent'}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" title={query.data?.meta.description}>
          {query.data?.meta.description ?? agentId}
        </span>
        {/* Written down because it is what the URL carries and what a
            notification calls this agent — searchable now, and until it was on
            screen there was no way to go from the string back to the agent. */}
        <span className="shrink-0 font-mono text-[10px] text-[var(--text-dim)] opacity-60 select-text" title="Subagent id — paste it into the search to come back here">
          {agentId}
        </span>
        <CostPill entries={entries} prices={prices} label="agent" variant="badge" />
        {call && subagents?.hasCall(call) && (
          <button
            type="button"
            onClick={() => subagents.goToCall(call)}
            className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
            title="Go to the call that sent it out"
          >
            ↑ the call
          </button>
        )}
        {at >= 0 && order.length > 1 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--text-dim)]">
            <button
              type="button"
              disabled={!previous}
              onClick={previous}
              className={previous ? 'cursor-pointer px-1 hover:text-[var(--text)]' : 'px-1 opacity-30'}
              title="Previous subagent"
            >
              ‹
            </button>
            {at + 1} of {order.length}
            <button
              type="button"
              disabled={!following}
              onClick={following}
              className={following ? 'cursor-pointer px-1 hover:text-[var(--text)]' : 'px-1 opacity-30'}
              title="Next subagent"
            >
              ›
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded px-2 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {query.isLoading && <div className="text-[var(--text-dim)]">Loading subagent transcript…</div>}
        {query.isError && <div className="text-red-400">Failed: {String(query.error)}</div>}
        {query.data && (
          <div style={zoom === ZOOM_DEFAULT ? undefined : { zoom: `${zoom}%` }}>
            <TurnList
              key={agentId}
              turns={query.data.turns}
              showThinking={showThinking}
              fold={fold}
              scrollToTool={scrollToTool}
              scrollToUuid={scrollToUuid}
              jumpNonce={jumpNonce}
            />
          </div>
        )}
      </div>
    </div>
  );
}
