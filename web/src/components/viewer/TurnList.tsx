import type { PriceTable, Turn } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { buildContextIndex } from '../../lib/context.ts';
import { buildCostIndex } from '../../lib/cost.ts';
import { type FoldState, turnKey } from '../../lib/folding.ts';
import { type MatchHighlight, markMatches } from '../../lib/highlight.ts';
import { buildSegments, groupTurns, type SegmentTurn } from '../../lib/segments.ts';
import { CompactedSegment } from './CompactedSegment.tsx';
import { DiscardedBranch } from './DiscardedBranch.tsx';
import { TurnView } from './Turn.tsx';

/** Stable identity, so the cost index is not rebuilt on every render before the prices arrive. */
const NO_PRICES: PriceTable = {};
/** Must match the `match-flash` animation in styles.css. */
const FLASH_MS = 2500;
/**
 * The marked words outlive the flash: the flash says which message, and it is
 * read at a glance, while finding a word inside a long answer is a search of its
 * own. Long enough to do that, short enough that the page is not left painted.
 */
const MARK_MS = 8000;

const keyOf = (t: SegmentTurn): string => turnKey(t.turn, t.index);

export function TurnList({
  turns,
  showThinking,
  expandTools = false,
  fold,
  expandSegments = false,
  scrollToUuid,
  highlight,
  onOpenAgent,
}: {
  turns: Turn[];
  showThinking: boolean;
  expandTools?: boolean;
  /** Which turns have their answers folded away — owned above, see useFoldState. */
  fold: FoldState;
  /** Unfold every compacted segment at once (the header toggle). */
  expandSegments?: boolean;
  scrollToUuid?: string | null;
  /** The words a search matched, when the link came from one. */
  highlight?: MatchHighlight | null;
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
  /** Rewound-away branches the user has opened, by their stable group key. */
  const [openDiscarded, setOpenDiscarded] = useState<Set<string>>(() => new Set());

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

  /** uuid (and every alias) → where it is, so a deep link can open its way in. */
  const locate = useMemo(() => {
    const map = new Map<string, { segment: number; turn: string; discarded: string | null }>();
    for (const segment of segments) {
      for (const group of groupTurns(segment.turns)) {
        for (const st of group.turns) {
          const at = {
            segment: segment.index,
            turn: keyOf(st),
            discarded: group.kind === 'discarded' ? group.key : null,
          };
          for (const item of st.turn.items) {
            map.set(item.uuid, at);
            for (const alias of item.aliasUuids) map.set(alias, at);
          }
        }
      }
    }
    return map;
  }, [segments]);

  // Read through a ref for the same reason `segments` is: the effect below keys
  // on the link alone, and this arrives as a fresh object on every render.
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;

  useEffect(() => {
    if (!scrollToUuid) return;
    // A folded segment or turn would swallow the link silently, so open the
    // way in first — the state lands well before the scroll below fires.
    const at = locate.get(scrollToUuid);
    if (at) {
      setOpenSegments((s) => (s.has(at.segment) ? s : new Set(s).add(at.segment)));
      if (at.discarded) {
        const key = at.discarded;
        setOpenDiscarded((s) => (s.has(key) ? s : new Set(s).add(key)));
      }
      fold.open(at.turn);
    }
    // Let the DOM settle before scrolling to the deep-linked message.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let clearMarks: (() => void) | null = null;
    timers.push(
      setTimeout(() => {
        const el = document.getElementById(scrollToUuid);
        if (!el) return;
        // The anchor may be an alias uuid — a zero-sized <span> inside the
        // bubble — so what gets flashed is the box, not whatever carries the id.
        const box = el.closest<HTMLElement>('[data-bubble]') ?? el;
        box.scrollIntoView({ block: 'center' });
        box.classList.add('match-flash');
        timers.push(setTimeout(() => box.classList.remove('match-flash'), FLASH_MS));

        const hl = highlightRef.current;
        if (!hl) return;
        const marked = markMatches(box.querySelector<HTMLElement>('[data-bubble-body]') ?? box, hl);
        clearMarks = marked.clear;
        timers.push(
          setTimeout(() => {
            marked.clear();
            clearMarks = null;
          }, MARK_MS),
        );
        // A long answer can be taller than the window, so centring the bubble is
        // no promise that the match is on screen. Only then is the paragraph
        // holding it scrolled to: doing it always would push the bubble's own
        // header — role, time, cost — out of view for nothing.
        const rect = marked.first?.getBoundingClientRect();
        if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
          const target = marked.first?.startContainer.parentElement;
          target?.scrollIntoView({ block: 'center' });
        }
      }, 100),
    );
    return () => {
      for (const t of timers) clearTimeout(t);
      clearMarks?.();
    };
    // Deliberately NOT keyed on `turns`/`locate`: the deep-linked jump belongs
    // to the link, not to the data. Re-running it on every refetch yanked a live
    // session back to the linked message every few seconds — and it fought the
    // follow-the-end button for control of the scroll. The turns are already
    // rendered when this mounts, so there is nothing to wait for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToUuid]);

  const renderPlain = (segmentTurns: SegmentTurn[]) =>
    segmentTurns.map((st) => {
      const key = keyOf(st);
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
          expanded={fold.isOpen(key)}
          onToggleExpanded={() => fold.toggle(key)}
        />
      );
    });

  /**
   * The turns of a segment, with every rewound-away run folded behind its own
   * header. Grouping is presentation only, like the segments themselves: the
   * cost and context indexes still run over every turn, by original index.
   */
  const renderTurns = (segmentTurns: SegmentTurn[]) =>
    groupTurns(segmentTurns).map((group) =>
      group.kind === 'live' ? (
        // A keyed Fragment, not a bare array: the runs of a segment come and go
        // as a live session grows, and React needs to tell them apart.
        <Fragment key={`live-${keyOf(group.turns[0])}`}>{renderPlain(group.turns)}</Fragment>
      ) : (
        <DiscardedBranch
          key={group.key}
          turns={group.turns}
          prices={prices}
          open={openDiscarded.has(group.key)}
          onToggle={() =>
            setOpenDiscarded((s) => {
              const next = new Set(s);
              if (!next.delete(group.key)) next.add(group.key);
              return next;
            })
          }
        >
          {openDiscarded.has(group.key) && renderPlain(group.turns)}
        </DiscardedBranch>
      ),
    );

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
