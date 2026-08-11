import type { PriceTable } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../api/client.ts';
import { costEntries } from '../../lib/cost.ts';
import { CostPill } from './CostPill.tsx';
import { TurnList } from './TurnList.tsx';

const NO_PRICES: PriceTable = {};

export function SubagentDrawer({
  sessionId,
  agentId,
  showThinking,
  onClose,
}: {
  sessionId: string;
  agentId: string;
  showThinking: boolean;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ['subagent', sessionId, agentId],
    queryFn: () => api.subagent(sessionId, agentId),
  });
  const pricesQ = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  const prices = pricesQ.data?.prices ?? NO_PRICES;
  // A subagent runs as its own API conversation, so this cost is NOT part of the
  // session total in the token panel — one session on this machine spends 43%
  // again on top of its parent. The drawer is the only place it can be seen.
  const entries = useMemo(
    () => costEntries((query.data?.turns ?? []).flatMap((t) => t.items), prices),
    [query.data, prices],
  );

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[44rem] max-w-[90vw] flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs font-semibold text-sky-400">
          ⑂ {query.data?.meta.agentType ?? 'subagent'}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" title={query.data?.meta.description}>
          {query.data?.meta.description ?? agentId}
        </span>
        <CostPill entries={entries} prices={prices} label="agent" variant="badge" />
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
        {query.data && <TurnList key={agentId} turns={query.data.turns} showThinking={showThinking} />}
      </div>
    </div>
  );
}
