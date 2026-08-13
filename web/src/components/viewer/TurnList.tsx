import type { PriceTable, Turn } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { buildContextIndex } from '../../lib/context.ts';
import { buildCostIndex } from '../../lib/cost.ts';
import { type FoldState, turnKey } from '../../lib/folding.ts';
import { type MatchHighlight, markMatches, revealRange } from '../../lib/highlight.ts';
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
/**
 * How long the anchor is looked for. Opening the way in is a chain of state
 * updates — segment, rewound branch, turn, tool run, tool block — so the element
 * to flash does not exist when the effect runs, and on a multi-megabyte session
 * the first paint is not instant either.
 */
const ANCHOR_STEP_MS = 100;
const ANCHOR_TRIES = 15;
/** When an offloaded tool output, fetched on arrival, would have landed. */
const LATE_TEXT_MS = 900;

const keyOf = (t: SegmentTurn): string => turnKey(t.turn, t.index);

export function TurnList({
  turns,
  showThinking,
  expandTools = false,
  fold,
  expandSegments = false,
  scrollToUuid,
  scrollToTool,
  highlight,
  onOpenAgent,
  footer,
  pending,
}: {
  turns: Turn[];
  showThinking: boolean;
  expandTools?: boolean;
  /** Which turns have their answers folded away — owned above, see useFoldState. */
  fold: FoldState;
  /** Unfold every compacted segment at once (the header toggle). */
  expandSegments?: boolean;
  scrollToUuid?: string | null;
  /**
   * A tool call to open and go to (`?tool=`), which is the only anchor a hit in
   * tool output has: it is not a message, and the line carrying its result is
   * rendered nowhere. It wins over `scrollToUuid` when both are given.
   */
  scrollToTool?: string | null;
  /** The words a search matched, when the link came from one. */
  highlight?: MatchHighlight | null;
  onOpenAgent?: (agentId: string) => void;
  /**
   * Hung at the end of the last turn still in the conversation — the working
   * indicator. It goes through the turn rather than after the list so it lands
   * on that turn's rail, which is what makes it read as the answer coming in
   * instead of as a sibling of the prompt.
   */
  footer?: ReactNode;
  /**
   * Prompts sent from the composer that the transcript has not caught up with,
   * appended after the last turn. Passed in rather than rendered beside the
   * list so they sit inside its spacing and look like what they will become.
   */
  pending?: ReactNode;
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

  /**
   * uuid (and every alias) → where it is, so a deep link can open its way in.
   * Tool calls are in the same map: a hit in tool output is anchored by its
   * `toolUseId`, and it has to open the same segment and turn as any other.
   */
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
            for (const block of item.blocks) {
              if (block.kind === 'tool' && block.toolUseId) map.set(block.toolUseId, at);
            }
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
    // A tool call is the more precise anchor and wins: a `call` hit also carries
    // the uuid of the message that made it, which would flash a whole answer
    // instead of the one call among a run of thirty.
    const anchor = scrollToTool ?? scrollToUuid;
    if (!anchor) return;
    // A folded segment, a rewound-away branch or a folded turn would swallow the
    // link silently, so open the way in first — the state lands well before the
    // scroll below fires. The tool's own run and block open on the way down, from
    // `targetTool`; this only has to make the turn itself visible.
    const at = locate.get(anchor);
    if (at) {
      setOpenSegments((s) => (s.has(at.segment) ? s : new Set(s).add(at.segment)));
      if (at.discarded) {
        const key = at.discarded;
        setOpenDiscarded((s) => (s.has(key) ? s : new Set(s).add(key)));
      }
      fold.open(at.turn);
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    let clearMarks: (() => void) | null = null;
    const find = (): HTMLElement | null => {
      if (scrollToTool) {
        const tool = document.querySelector<HTMLElement>(`[data-tool-id="${CSS.escape(scrollToTool)}"]`);
        if (tool) return tool;
        // Only then the message: a tool id this parse does not hold (a fork, a
        // subagent's own call) still lands on the exchange it belonged to.
        if (!scrollToUuid) return null;
      }
      return scrollToUuid ? document.getElementById(scrollToUuid) : null;
    };

    const arrive = (el: HTMLElement): void => {
      // The anchor may be an alias uuid — a zero-sized <span> inside the bubble —
      // so what gets flashed is the box, not whatever carries the id. A tool block
      // is its own box and sits outside any bubble.
      const box = el.closest<HTMLElement>('[data-bubble]') ?? el;
      box.scrollIntoView({ block: 'center' });
      box.classList.add('match-flash');
      timers.push(setTimeout(() => box.classList.remove('match-flash'), FLASH_MS));

      const hl = highlightRef.current;
      if (!hl) return;
      // A bubble marks its body only, to keep the role and the model out of it;
      // a tool block has no such split, and its header — the tool name and its
      // input summary — is often exactly where the hit is.
      const body = box.querySelector<HTMLElement>('[data-bubble-body]') ?? box;
      const mark = () => {
        clearMarks?.();
        const marked = markMatches(body, hl);
        clearMarks = marked.clear;
        return marked;
      };
      const marked = mark();
      timers.push(
        setTimeout(() => {
          clearMarks?.();
          clearMarks = null;
        }, MARK_MS),
      );
      // A long answer, or a tool result of a thousand lines, can be taller than
      // the window — or scroll inside its own box — so centring the box is no
      // promise that the match is on screen. `revealRange` moves only what has to
      // move, and nothing at all when the mark is already in view: centring is
      // otherwise thrown away, taking the box's own header with it.
      if (marked.first) revealRange(marked.first);
      // An offloaded tool output is fetched on arrival and lands after this pass,
      // so the text searched may not be here yet. Re-marking once, and only when
      // the text really changed, is what covers that without a second guess.
      const settled = body.textContent?.length ?? 0;
      timers.push(
        setTimeout(() => {
          if (!clearMarks || (body.textContent?.length ?? 0) === settled) return;
          const late = mark();
          if (late.first) revealRange(late.first);
        }, LATE_TEXT_MS),
      );
    };

    // Polled rather than waited out once: opening the way in is a chain of state
    // updates — segment, branch, turn, tool run, tool block — and a single 100 ms
    // guess at the end of it is a race on a big session.
    let tries = 0;
    const attempt = (): void => {
      const el = find();
      if (el) {
        arrive(el);
        return;
      }
      if (++tries < ANCHOR_TRIES) timers.push(setTimeout(attempt, ANCHOR_STEP_MS));
    };
    timers.push(setTimeout(attempt, ANCHOR_STEP_MS));
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
  }, [scrollToUuid, scrollToTool]);

  /**
   * The turn the footer belongs to: the last one of the live segment, and only
   * if it is still part of the conversation. A rewound-away branch is history —
   * hanging "Claude is working" off it would say the abandoned exchange is the
   * one being answered. Null means there is nowhere to put it (an empty session,
   * or a last group that is discarded), and it is rendered on its own below.
   */
  const footerTurnKey = useMemo(() => {
    const last = segments[segments.length - 1];
    if (!last) return null;
    const groups = groupTurns(last.turns);
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup.kind !== 'live') return null;
    const st = lastGroup.turns[lastGroup.turns.length - 1];
    return st ? keyOf(st) : null;
  }, [segments]);

  const renderPlain = (segmentTurns: SegmentTurn[]) =>
    segmentTurns.map((st) => {
      const key = keyOf(st);
      return (
        <TurnView
          key={key}
          footer={footer && key === footerTurnKey ? footer : undefined}
          turn={st.turn}
          showThinking={showThinking}
          expandTools={expandTools}
          onOpenAgent={onOpenAgent}
          costs={costs}
          turnCost={index.perTurn[st.index] ?? []}
          turnContext={contextIndex.perTurn[st.index] ?? null}
          expanded={fold.isOpen(key)}
          onToggleExpanded={() => fold.toggle(key)}
          targetTool={scrollToTool}
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
      {/* Nowhere to hang it: no turns at all, or a last group that is a rewound
          branch. Better loose than attached to the wrong exchange. */}
      {footer && footerTurnKey === null && footer}
      {/* Prompts the transcript has not caught up with. They render INSIDE this
          container so they inherit the same `space-y-4` every turn gets: as a
          sibling outside it, the echo sat 6 px closer to the answer above than
          the real message would, and visibly dropped into place when it landed. */}
      {pending}
    </div>
  );
}
