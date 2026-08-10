import type { PriceTable, Turn } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { api } from '../../api/client.ts';
import { buildCostIndex } from '../../lib/cost.ts';
import { TurnView } from './Turn.tsx';

/** Stable identity, so the cost index is not rebuilt on every render before the prices arrive. */
const NO_PRICES: PriceTable = {};

export function TurnList({
  turns,
  showThinking,
  expandTools = false,
  scrollToUuid,
  onOpenAgent,
}: {
  turns: Turn[];
  showThinking: boolean;
  expandTools?: boolean;
  scrollToUuid?: string | null;
  onOpenAgent?: (agentId: string) => void;
}) {
  // The same cached query the token panel uses — no extra request.
  const pricesQ = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  const prices = pricesQ.data?.prices ?? NO_PRICES;
  // The total comes from the turns themselves rather than from the session
  // enrichment: both dedupe assistant lines by message.id, so they agree, and
  // this one also works for a subagent transcript, which is enriched nowhere.
  const index = useMemo(() => buildCostIndex(turns, prices), [turns, prices]);
  const costs = useMemo(
    () => ({ prices, cumulative: index.cumulative, sessionTotal: index.total }),
    [prices, index],
  );

  useEffect(() => {
    if (!scrollToUuid) return;
    // Let the DOM settle before scrolling to the deep-linked message.
    const t = setTimeout(() => {
      const el = document.getElementById(scrollToUuid);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('ring-2', 'ring-[var(--accent)]');
        setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--accent)]'), 2500);
      }
    }, 100);
    return () => clearTimeout(t);
    // Deliberately NOT keyed on `turns`: the deep-linked jump belongs to the
    // link, not to the data. Re-running it on every refetch yanked a live
    // session back to the linked message every few seconds — and it fought the
    // follow-the-end button for control of the scroll. The turns are already
    // rendered when this mounts, so there is nothing to wait for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToUuid]);

  return (
    <div className="space-y-4">
      {turns.map((turn, i) => (
        <TurnView
          key={turn.promptId ?? i}
          turn={turn}
          showThinking={showThinking}
          expandTools={expandTools}
          onOpenAgent={onOpenAgent}
          costs={costs}
          turnCost={index.perTurn[i] ?? []}
        />
      ))}
    </div>
  );
}
