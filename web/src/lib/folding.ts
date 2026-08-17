import type { Turn } from '@claude-history/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Identity of a turn for the fold state and for React.
 *
 * A live session's turns array is replaced wholesale every few seconds, so the
 * key has to come from the data: the first item's uuid. (It also avoids the
 * real duplicate keys a compaction produces, where two turns share a promptId.)
 */
export function turnKey(turn: Turn, index: number): string {
  return turn.items[0]?.uuid ?? `turn-${index}`;
}

export interface FoldCounts {
  responses: number;
  tools: number;
}

/** What a turn would fold away: the assistant's side of it. */
export function foldedCounts(turn: Turn, showThinking: boolean): FoldCounts {
  let responses = 0;
  let tools = 0;
  for (const item of turn.items) {
    if (item.role !== 'assistant') continue;
    const visible = item.blocks.filter((b) => b.kind !== 'thinking' || showThinking);
    if (visible.some((b) => b.kind === 'text' || b.kind === 'thinking')) responses += 1;
    tools += visible.filter((b) => b.kind === 'tool').length;
  }
  return { responses, tools };
}

export interface FoldState {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Used by deep links, which must never land on something folded away. */
  open: (key: string) => void;
  hideAll: () => void;
  showAll: () => void;
  /** False when there is nothing left to fold / unfold — the buttons say so. */
  canHide: boolean;
  canShow: boolean;
}

/**
 * Which turns have their answers folded away. Closed is the exception, so the
 * set holds the closed ones and a conversation opens fully unfolded.
 *
 * It lives above `TurnList` because the header buttons need to know whether
 * anything is left to fold or unfold, and only this state can say.
 */
export function useFoldState(turns: Turn[], showThinking: boolean, resetKey?: string): FoldState {
  const foldable = useMemo(() => {
    const keys: string[] = [];
    turns.forEach((turn, i) => {
      const counts = foldedCounts(turn, showThinking);
      if (counts.responses > 0 || counts.tools > 0) keys.push(turnKey(turn, i));
    });
    return keys;
  }, [turns, showThinking]);

  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  // Another session (or subagent) starts unfolded: what was folded here says
  // nothing about what is worth reading there.
  useEffect(() => {
    setClosed(new Set());
  }, [resetKey]);

  const toggle = useCallback((key: string) => {
    setClosed((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const open = useCallback((key: string) => {
    setClosed((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }, []);
  const hideAll = useCallback(() => setClosed(new Set(foldable)), [foldable]);
  const showAll = useCallback(() => setClosed(new Set()), []);

  // Memoised, and that is load-bearing rather than tidy: this object is a prop
  // of `TurnList`, which is memoised in turn, and a fresh identity here would
  // re-render every bubble and every tool block whenever anything else on the
  // page changed — a click, a panel opening, a star being set.
  return useMemo(
    () => ({
      isOpen: (key: string) => !closed.has(key),
      toggle,
      open,
      hideAll,
      showAll,
      canHide: foldable.some((k) => !closed.has(k)),
      canShow: foldable.some((k) => closed.has(k)),
    }),
    [closed, foldable, toggle, open, hideAll, showAll],
  );
}
