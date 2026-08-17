import type { PriceTable, Turn } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { buildContextIndex } from '../../lib/context.ts';
import { buildCostIndex } from '../../lib/cost.ts';
import { type FoldState, turnKey } from '../../lib/folding.ts';
import {
  boxKeyOf,
  boxRanges,
  type MatchHighlight,
  markConversation,
  markMatches,
  revealRange,
  setCurrentMark,
} from '../../lib/highlight.ts';
import { buildSegments, groupTurns, type SegmentTurn } from '../../lib/segments.ts';
import { CompactedSegment } from './CompactedSegment.tsx';
import { DiscardedBranch } from './DiscardedBranch.tsx';
import { RevealContext, type RevealContextValue } from './RevealContext.ts';
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
/**
 * How long the find bar's marks wait after the conversation last changed shape.
 * Unfolding a run is several state updates and a paint; repainting on each of
 * them would walk the whole conversation three times for one click.
 */
const MARK_SETTLE_MS = 120;

const keyOf = (t: SegmentTurn): string => turnKey(t.turn, t.index);

/**
 * The timers one jump owns, cleared together. They are collected rather than
 * tracked individually because a jump superseded halfway through has a flash to
 * take back, marks to drop and a poll to stop, and forgetting any one of them
 * leaves the previous link painting over the new one.
 */
function timerBag() {
  const timers: ReturnType<typeof setTimeout>[] = [];
  return {
    after(ms: number, fn: () => void): void {
      timers.push(setTimeout(fn, ms));
    },
    clear(): void {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    },
  };
}

/**
 * The element an anchor names, tool first: a `call` hit also carries the uuid of
 * the message that made it, and that would point at a whole answer instead of at
 * the one call among a run of thirty. A tool id this parse does not hold (a fork,
 * a subagent's own call) still lands on the exchange it belonged to.
 */
function findAnchor(toolUseId: string | null | undefined, uuid: string | null | undefined): HTMLElement | null {
  if (toolUseId) {
    const tool = document.querySelector<HTMLElement>(`[data-tool-id="${CSS.escape(toolUseId)}"]`);
    if (tool) return tool;
    if (!uuid) return null;
  }
  return uuid ? document.getElementById(uuid) : null;
}

/**
 * The box an anchor lands on. The anchor may be an alias uuid — a zero-sized
 * <span> inside the bubble — so what gets flashed and marked is the box, not
 * whatever carries the id.
 *
 * A tool block is its own box, and it is tested FIRST because it is not always
 * OUTSIDE a bubble, as this used to assume. A run that ends at a question or a
 * plan inside a message that also has prose is rendered into that message's own
 * bubble (`tools-before-ask`), and there `closest` climbed past the one call to
 * the whole answer: 25 calls over the 20 largest sessions, and `b343d4ac`'s
 * `toolu_01CyGpmXFjFcBj8apDVmAXck` flashed 19,383 characters to point at 17,047
 * of them.
 */
export function anchorBox(el: HTMLElement): HTMLElement {
  return el.matches('[data-tool-id]') ? el : (el.closest<HTMLElement>('[data-bubble]') ?? el);
}

/**
 * Where marks may go inside a box. A bubble marks its body only, to keep the
 * role and the model out of it; a tool block has no such split, and its header —
 * the tool name and its input summary — is often exactly where the hit is.
 */
export function markingBody(box: HTMLElement): HTMLElement {
  return box.querySelector<HTMLElement>('[data-bubble-body]') ?? box;
}

/**
 * Looks for the anchor until it appears, rather than waiting one guess out:
 * opening the way in is a chain of state updates — segment, branch, turn, tool
 * run, tool block — and a single 100 ms bet at the end of it is a race on a big
 * session. Returns nothing; the bag is what stops it.
 */
function pollForAnchor(bag: ReturnType<typeof timerBag>, find: () => HTMLElement | null, arrive: (el: HTMLElement) => void): void {
  let tries = 0;
  const attempt = (): void => {
    const el = find();
    if (el) {
      arrive(el);
      return;
    }
    if (++tries < ANCHOR_TRIES) bag.after(ANCHOR_STEP_MS, attempt);
  };
  bag.after(ANCHOR_STEP_MS, attempt);
}

/** One step of the find bar: which box, and which occurrence inside it. */
export interface FindTarget {
  uuid: string;
  toolUseId: string | null;
  /** Nth occurrence within the box, counted in the corpus. */
  ordinal: number;
  /** Bumped on every step ASKED for — the find bar's `jumpNonce`. */
  nonce: number;
}

/**
 * Everything the find bar publishes to the list, or null when it is shut. One
 * object rather than three props, because the three arrive together and the
 * effects below all gate on the same thing: is the bar open.
 */
export interface FindState {
  /** The words to paint. Null while nothing has been typed. */
  highlight: MatchHighlight | null;
  /** The box the reader clicked, drawn with a ring. */
  focusedKey: string | null;
  /** Where the reader is standing. Null until the first step. */
  target: FindTarget | null;
}

export function TurnList({
  turns,
  showThinking,
  expandTools = false,
  fold,
  expandSegments = false,
  scrollToUuid,
  scrollToTool,
  jumpNonce,
  highlight,
  find = null,
  onFindMarks,
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
  /**
   * Changes every time a jump is ASKED for, even to the anchor already in the
   * URL. The effect below keys on the link and not on the data, which is what
   * stops a live session being yanked back every few seconds — and also what
   * made clicking the same row twice do nothing after scrolling away from it.
   */
  jumpNonce?: number;
  /** The words a search matched, when the link came from one. */
  highlight?: MatchHighlight | null;
  /**
   * The find bar, or null when it is shut. Its step travels the same road a deep
   * link does — this list is the only thing that knows what is folded — but it
   * does not wear off: the marks stay for as long as the bar is open.
   */
  find?: FindState | null;
  /**
   * How many of each box's matches are really on screen, reported after every
   * marking pass. It is what the bar's "visible" scope counts, and the only
   * honest answer to it: a folded body has no text nodes.
   */
  onFindMarks?: (counts: Map<string, number>) => void;
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

  /**
   * Unfolds everything between the top of the list and an anchor: a folded
   * segment, a rewound-away branch or a folded turn would swallow a link
   * silently. The state lands well before the scroll does. The tool's own run
   * and block open on the way down, from `targetTool`; this only has to make the
   * turn itself visible.
   *
   * It is only ever called from an effect that runs on the render where the jump
   * was asked for, so closing over this render's `locate` and `fold` is right.
   */
  const openWayIn = (anchor: string): void => {
    const at = locate.get(anchor);
    if (!at) return;
    setOpenSegments((s) => (s.has(at.segment) ? s : new Set(s).add(at.segment)));
    if (at.discarded) {
      const key = at.discarded;
      setOpenDiscarded((s) => (s.has(key) ? s : new Set(s).add(key)));
    }
    fold.open(at.turn);
  };

  useEffect(() => {
    // A tool call is the more precise anchor and wins.
    const anchor = scrollToTool ?? scrollToUuid;
    if (!anchor) return;
    openWayIn(anchor);

    const bag = timerBag();
    let clearMarks: (() => void) | null = null;

    const arrive = (el: HTMLElement): void => {
      const box = anchorBox(el);
      box.scrollIntoView({ block: 'center' });
      box.classList.add('match-flash');
      bag.after(FLASH_MS, () => box.classList.remove('match-flash'));

      const hl = highlightRef.current;
      if (!hl) return;
      const body = markingBody(box);
      const mark = () => {
        clearMarks?.();
        const marked = markMatches(body, hl);
        clearMarks = marked.clear;
        return marked;
      };
      const marked = mark();
      bag.after(MARK_MS, () => {
        clearMarks?.();
        clearMarks = null;
      });
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
      bag.after(LATE_TEXT_MS, () => {
        if (!clearMarks || (body.textContent?.length ?? 0) === settled) return;
        const late = mark();
        if (late.first) revealRange(late.first);
      });
    };

    pollForAnchor(bag, () => findAnchor(scrollToTool, scrollToUuid), arrive);
    return () => {
      bag.clear();
      clearMarks?.();
    };
    // Deliberately NOT keyed on `turns`/`locate`: the deep-linked jump belongs
    // to the link, not to the data. Re-running it on every refetch yanked a live
    // session back to the linked message every few seconds — and it fought the
    // follow-the-end button for control of the scroll. The turns are already
    // rendered when this mounts, so there is nothing to wait for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToUuid, scrollToTool, jumpNonce]);

  /**
   * The find bar's step. Same road as the deep link above — open the way in,
   * poll for the anchor, reveal — with three differences, each of them the
   * point of the feature rather than an omission.
   *
   * No flash: the reader typed the word, so `find-current` already says which
   * match this is, and a 2.5 s animation on every Enter would be noise fighting
   * `revealRange` for the scroll.
   *
   * The mark does not expire; the ink effect below owns it for as long as the
   * bar is open.
   *
   * And the box is asked for its ranges with no cap, because the ordinal names
   * one of them by position. It is counted in the corpus and applied to the DOM,
   * which agree for prose and can drift where the two texts do — a tool block's
   * chrome, markdown's own syntax — so it is clamped to the last range there is:
   * the worst case is landing on a neighbouring match in the SAME box, and every
   * match in that box is painted anyway.
   */
  const findRef = useRef<FindState | null>(find);
  findRef.current = find;
  const reveal = (state: FindState, target: FindTarget, el: HTMLElement): void => {
    const box = anchorBox(el);
    const ranges = state.highlight ? boxRanges(markingBody(box), state.highlight) : [];
    const range = ranges.length > 0 ? ranges[Math.min(target.ordinal, ranges.length - 1)] : null;
    setCurrentMark(range);
    if (range) revealRange(range);
    else box.scrollIntoView({ block: 'center' });
  };

  const step = find?.target ?? null;
  useEffect(() => {
    const state = findRef.current;
    if (!state?.target) return;
    const target = state.target;
    openWayIn(target.toolUseId ?? target.uuid);
    const bag = timerBag();
    pollForAnchor(
      bag,
      () => findAnchor(target.toolUseId, target.uuid),
      (el) => reveal(state, target, el),
    );
    return () => bag.clear();
    // On the step asked for, and on nothing else: keyed on the data, a live
    // session would drag the reader back to the current match every few seconds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.nonce]);

  /**
   * The ink. Every match in every open box, repainted whenever the conversation
   * changes shape — a turn unfolding, a run opening, a tool block's own fold, an
   * offloaded output arriving, a live refetch replacing fifteen hundred blocks.
   *
   * A `MutationObserver` can watch for all of that at once precisely BECAUSE the
   * marks are ranges in the CSS Custom Highlight API: painting them writes
   * nothing into the DOM, so the pass cannot trigger the observer that ran it.
   * With <mark> elements this would be an infinite loop.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const findOpen = !!find;
  const findHl = find?.highlight ?? null;
  const focusedKey = find?.focusedKey ?? null;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !findOpen) return;
    let clear: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;

    const paint = (): void => {
      const state = findRef.current;
      clear?.();
      clear = null;
      if (state?.highlight) {
        const marked = markConversation(root, state.highlight);
        clear = marked.clear;
        if (onFindMarks) {
          const counts = new Map<string, number>();
          for (const [box, ranges] of marked.boxes) {
            const key = boxKeyOf(box);
            if (key) counts.set(key, (counts.get(key) ?? 0) + ranges.length);
          }
          onFindMarks(counts);
        }
      } else onFindMarks?.(new Map());

      // The ring on the box the reader clicked. An attribute rather than React
      // state read by three hundred bubbles, which would re-render all of them
      // on every click — the state decides and the DOM applies it, the same
      // shape the marks have. Reapplied here because a re-render drops it.
      for (const el of root.querySelectorAll('[data-find-scope]')) el.removeAttribute('data-find-scope');
      const key = state?.focusedKey ?? null;
      if (key) {
        const el = key.startsWith('tool:')
          ? root.querySelector<HTMLElement>(`[data-tool-id="${CSS.escape(key.slice(5))}"]`)
          : document.getElementById(key.slice(4));
        el?.setAttribute('data-find-scope', '');
      }

      // React may have thrown away the node the current mark pointed into, so it
      // is resolved again rather than kept. This is also what covers an offloaded
      // output landing after the jump: its text arriving is a mutation like any
      // other, and the pass it triggers finds the match that was not there yet.
      const target = state?.target ?? null;
      if (!state || !target) {
        setCurrentMark(null);
        return;
      }
      const el = findAnchor(target.toolUseId, target.uuid);
      if (el) reveal(state, target, el);
    };

    const schedule = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        frame = requestAnimationFrame(paint);
      }, MARK_SETTLE_MS);
    };

    paint();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      clear?.();
      setCurrentMark(null);
      for (const el of root.querySelectorAll('[data-find-scope]')) el.removeAttribute('data-find-scope');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, findHl, focusedKey, onFindMarks]);

  /**
   * What the folds inside a box read to know a step is coming for them. Built
   * from the primitives rather than from `find`, which is a new object on every
   * render and would re-render every consumer with it.
   */
  const revealKey = step ? (step.toolUseId ? `tool:${step.toolUseId}` : `msg:${step.uuid}`) : null;
  const revealNonce = step?.nonce ?? 0;
  const revealValue = useMemo<RevealContextValue>(
    () => ({ key: revealKey, nonce: revealNonce }),
    [revealKey, revealNonce],
  );

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
    // The provider wraps the list and nothing else: what is folded lives here,
    // and so does the only thing allowed to unfold it from outside.
    <RevealContext value={revealValue}>
      <div ref={rootRef} className="space-y-4">
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
    </RevealContext>
  );
}
