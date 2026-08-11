import type { PriceTable, Turn } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { buildContextIndex } from '../../lib/context.ts';
import { buildCostIndex } from '../../lib/cost.ts';
import { buildSegments, type SegmentTurn } from '../../lib/segments.ts';
import { CompactedSegment } from './CompactedSegment.tsx';
import { TurnView } from './Turn.tsx';

/** Stable identity, so the cost index is not rebuilt on every render before the prices arrive. */
const NO_PRICES: PriceTable = {};

/**
 * A live session's turns array is replaced wholesale every few seconds, so the
 * key has to come from the data: the first item's uuid. (It also fixes real
 * duplicate keys — after a compaction the summary turn and the `/compact` turn
 * carry the same promptId, which is what this used to key on.)
 */
function turnKey(t: SegmentTurn): string {
  return t.turn.items[0]?.uuid ?? `turn-${t.index}`;
}

export function TurnList({
  turns,
  showThinking,
  expandTools = false,
  promptsOnly = false,
  expandSegments = false,
  scrollToUuid,
  onOpenAgent,
}: {
  turns: Turn[];
  showThinking: boolean;
  expandTools?: boolean;
  /** Show only the prompts; each turn opens on demand. */
  promptsOnly?: boolean;
  /** Unfold every compacted segment at once (the header toggle). */
  expandSegments?: boolean;
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
  // The context chain needs no prices, so it is built once per conversation.
  const contextIndex = useMemo(() => buildContextIndex(turns), [turns]);
  const costs = useMemo(
    () => ({ prices, cumulative: index.cumulative, sessionTotal: index.total, context: contextIndex.byUuid }),
    [prices, index, contextIndex],
  );
  // Presentation only: the indexes above still see every turn, which is the
  // only reason the pills reconcile with the session total.
  const segments = useMemo(() => buildSegments(turns), [turns]);

  const [openSegments, setOpenSegments] = useState<Set<number>>(() => new Set());
  const [openTurns, setOpenTurns] = useState<Set<string>>(() => new Set());

  // Read through a ref so this effect keys on the toggle ALONE: `segments` gets
  // a new identity on every refetch, and depending on it would re-fold whatever
  // the user had opened, every few seconds, in a live session.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  useEffect(() => {
    setOpenSegments(
      expandSegments ? new Set(segmentsRef.current.filter((s) => !s.isLive).map((s) => s.index)) : new Set(),
    );
  }, [expandSegments]);

  // Leaving prompts-only and coming back starts folded again: the mode is
  // asked for to get the overview, not to find the turns left open last time.
  useEffect(() => {
    setOpenTurns(new Set());
  }, [promptsOnly]);

  /** uuid (and every alias) → where it is, so a deep link can open its way in. */
  const locate = useMemo(() => {
    const map = new Map<string, { segment: number; turn: string }>();
    for (const segment of segments) {
      for (const st of segment.turns) {
        const at = { segment: segment.index, turn: turnKey(st) };
        for (const item of st.turn.items) {
          map.set(item.uuid, at);
          for (const alias of item.aliasUuids) map.set(alias, at);
        }
      }
    }
    return map;
  }, [segments]);

  useEffect(() => {
    if (!scrollToUuid) return;
    // A folded segment or turn would swallow the link silently, so open the
    // way in first — the state lands well before the scroll below fires.
    const at = locate.get(scrollToUuid);
    if (at) {
      setOpenSegments((s) => (s.has(at.segment) ? s : new Set(s).add(at.segment)));
      setOpenTurns((s) => (s.has(at.turn) ? s : new Set(s).add(at.turn)));
    }
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
    // Deliberately NOT keyed on `turns`/`locate`: the deep-linked jump belongs
    // to the link, not to the data. Re-running it on every refetch yanked a live
    // session back to the linked message every few seconds — and it fought the
    // follow-the-end button for control of the scroll. The turns are already
    // rendered when this mounts, so there is nothing to wait for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToUuid]);

  const renderTurns = (segmentTurns: SegmentTurn[]) =>
    segmentTurns.map((st) => {
      const key = turnKey(st);
      return (
        <TurnView
          key={key}
          turn={st.turn}
          showThinking={showThinking}
          expandTools={expandTools}
          onOpenAgent={onOpenAgent}
          costs={costs}
          turnCost={index.perTurn[st.index] ?? []}
          turnContext={contextIndex.perTurn[st.index] ?? null}
          promptsOnly={promptsOnly}
          expanded={openTurns.has(key)}
          onToggleExpanded={() =>
            setOpenTurns((s) => {
              const next = new Set(s);
              if (!next.delete(key)) next.add(key);
              return next;
            })
          }
        />
      );
    });

  return (
    <div className="space-y-4">
      {segments.map((segment) =>
        segment.isLive ? (
          <div key={`live-${segment.index}`} className="space-y-4">
            {renderTurns(segment.turns)}
          </div>
        ) : (
          <CompactedSegment
            key={segment.index}
            segment={segment}
            prices={prices}
            open={openSegments.has(segment.index)}
            onToggle={() =>
              setOpenSegments((s) => {
                const next = new Set(s);
                if (!next.delete(segment.index)) next.add(segment.index);
                return next;
              })
            }
          >
            {openSegments.has(segment.index) && renderTurns(segment.turns)}
          </CompactedSegment>
        ),
      )}
    </div>
  );
}
