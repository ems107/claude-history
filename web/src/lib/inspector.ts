import { useCallback, useEffect, useMemo, useState } from 'react';
import { INSPECTOR_MAX, INSPECTOR_MIN, trackPointer } from './sideColumns.ts';

/**
 * Which panel is open beside the conversation, and how wide it is.
 *
 * The six panels were six buttons in the header and six independent booleans in
 * the page, each opening its panel ABOVE the conversation — which is the thing
 * this replaces. Opening one pushed down exactly what you were reading, and the
 * only way to have two open was to push it down twice.
 *
 * Beside it instead, one at a time, chosen from a rail on the right. Single
 * choice is not a limitation kept for simplicity: it is what gives Escape one
 * meaning. Only `?agents=1` was ever in the page's unwind, because putting one
 * file panel in it and not the other would have been worse than neither
 * ([AI_VIEWER.md](../../docs/AI_VIEWER.md) § The three file panels) — and with
 * one thing open there is one thing to close.
 */

/**
 * `RAIL_PX` and `GRIP_PX` used to live here, and moved to `lib/sideColumns.ts`
 * when the file viewer and the subagent transcript became columns: they are the
 * layout's constants rather than the inspector's, and every column beside the
 * conversation is measured against them. This module is the rail's own state —
 * which panel is open, and how wide the inspector was dragged.
 */

const WIDTH_KEY = 'inspectorWidth';
const INSPECTOR_DEFAULT = 400;

export type PanelKey = 'tokens' | 'changed' | 'sent' | 'mentioned' | 'agents' | 'lineage';

export interface PanelItem {
  key: PanelKey;
  /** In the rail, under the icon. Short: it lives in 72 px. */
  short: string;
  /** In the inspector's own title bar, and it may be longer. */
  title: string;
  /** `null` while the number cannot be known yet — the mentions, which ask the disk. */
  count: number | null;
  hint: string;
}

export interface InspectorState {
  open: PanelKey | null;
  width: number;
  /** Only the panels this session HAS, in rail order. */
  items: PanelItem[];
  toggle: (key: PanelKey) => void;
  close: () => void;
  startResize: (e: React.MouseEvent, max: number) => void;
  /**
   * Its seam is under the hand. The page turns this into `layoutColumns`'
   * priority, which is what lets an inspector being dragged push the column
   * beside it out of the way instead of stopping dead against it.
   */
  dragging: boolean;
}

function readWidth(): number {
  const n = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(n) && n > 0 ? Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, n)) : INSPECTOR_DEFAULT;
}

export function useInspector({
  changed,
  sent,
  mentionCandidates,
  mentionCount,
  agentCount,
  hasLineage,
  agents,
}: {
  changed: number;
  sent: number;
  /** How many paths were named at all: whether the panel exists is a transcript fact. */
  mentionCandidates: number;
  /** What survived being checked against the disk, or null until it has been. */
  mentionCount: number | null;
  agentCount: number;
  hasLineage: boolean;
  /**
   * The subagent list is the one panel whose open/closed lives in the URL, and
   * it has to stay there: the ⑂ badge in the session list opens a session
   * straight onto it, and that link can be copied. So this hook holds the other
   * five and defers to the page for that one.
   */
  agents: { open: boolean; toggle: () => void; close: () => void };
}): InspectorState {
  /**
   * Which panel is open — INCLUDING `agents`, which is also in the URL.
   *
   * Holding `agents` here as well is not redundancy, it is what removes a hole.
   * The two halves do not land in the same commit: a `setState` is synchronous
   * and `setSearchParams` goes through the router, which wraps navigation in a
   * transition. So with `agents` living ONLY in the URL, every switch into or
   * out of it left one value already changed and the other not yet — and since
   * the panel is derived from both, that reads as the inspector vanishing and
   * coming back. Measured before the fix, sampling every frame: 22 frames
   * (~360 ms) of nothing going in, 12 coming out.
   *
   * With the panel named here the synchronous half always says something true,
   * and the URL catching up a few frames later changes nothing on screen.
   */
  const [local, setLocal] = useState<PanelKey | null>(agents.open ? 'agents' : null);
  const [width, setWidth] = useState(readWidth);
  /** Its seam is under the hand — see `InspectorState.dragging`. */
  const [dragging, setDragging] = useState(false);

  /**
   * What is open is what this says, full stop — and `?agents=1` is a mirror of
   * it rather than half of the answer.
   *
   * Deriving it from both (`agents.open ? 'agents' : local`) removed the hole in
   * three of the four directions but left the fourth slow: leaving the agent
   * list had to wait for the parameter to go before the value could change, so
   * the old panel sat there ~15 frames longer than any other switch. Reading one
   * value makes every click instant, and costs one thing: the URL changing from
   * OUTSIDE has to be adopted rather than simply read.
   */
  const open: PanelKey | null = local;

  /**
   * Which is this, and it is the whole of the URL→state direction: the parameter
   * arriving means open the list (a deep link, the ⑂ badge in the session list,
   * the token panel's own link to it), and the parameter going means close it
   * (the back button). Keyed on the parameter alone, so it never fires on the
   * commit where a rail click has already said the answer.
   */
  useEffect(() => {
    setLocal((prev) => (agents.open ? 'agents' : prev === 'agents' ? null : prev));
  }, [agents.open]);

  const toggle = useCallback(
    (key: PanelKey) => {
      if (key === 'agents') {
        const willOpen = !agents.open;
        setLocal(willOpen ? 'agents' : null);
        agents.toggle();
        return;
      }
      // Nothing else may stay open behind it, and the parameter is only touched
      // when it is actually set — asking a toggle to close what is already
      // closed would open it.
      if (agents.open) agents.close();
      setLocal((prev) => (prev === key ? null : key));
    },
    [agents],
  );

  const close = useCallback(() => {
    if (agents.open) agents.close();
    setLocal(null);
  }, [agents]);

  // The same gesture as the column beside it, through the same function: the
  // seam is anchored to the panel's right edge and follows the pointer, and
  // `max` — `SideLayout.maxInspector`, passed down by `Inspector` — is where
  // the column has yielded all it can and the conversation is on its floor.
  const startResize = useCallback((e: React.MouseEvent, max: number) => {
    trackPointer(
      e,
      INSPECTOR_MIN,
      Math.min(INSPECTOR_MAX, max),
      (w) => {
        setWidth(w);
        localStorage.setItem(WIDTH_KEY, String(w));
      },
      setDragging,
    );
  }, []);

  const items = useMemo<PanelItem[]>(() => {
    const all: Array<PanelItem | null> = [
      {
        key: 'tokens',
        short: 'Tokens',
        title: 'Tokens',
        count: null,
        hint: 'What this session spent, per model, and how its context grew',
      },
      // The words are the feature and they are not interchangeable: one lists
      // what the session CHANGED, one what it HANDED OVER, one what it only
      // TALKED about, and none of the three is another's superset.
      changed > 0
        ? {
            key: 'changed',
            short: 'Changed',
            title: 'Changed files',
            count: changed,
            hint: 'Files this session edited or wrote — from the Edit/Write calls in this transcript',
          }
        : null,
      sent > 0
        ? {
            key: 'sent',
            short: 'Sent',
            title: 'Sent files',
            count: sent,
            hint: 'Files this session handed over: delivered to you with SendUserFile, published as an artifact, or written as a plan — with the state of each on disk right now',
          }
        : null,
      mentionCandidates > 0
        ? {
            key: 'mentioned',
            short: 'Mentioned',
            title: 'Mentioned files',
            count: mentionCount,
            hint: 'Files this session only talked about: the paths its own answers named. Most of what an answer names is written for a person to read — a partial path, a placeholder — so a row that finds nothing is listed and marked rather than hidden.',
          }
        : null,
      agentCount > 0
        ? {
            key: 'agents',
            short: 'Subagents',
            title: '⑂ Subagents',
            count: agentCount,
            hint: 'The agents this session sent out: what each was asked, what it reported back, and what it cost',
          }
        : null,
      hasLineage
        ? {
            key: 'lineage',
            short: 'Lineage',
            title: 'Lineage',
            count: null,
            hint: 'The full fork chain of this session',
          }
        : null,
    ];
    return all.filter((p): p is PanelItem => p !== null);
  }, [changed, sent, mentionCandidates, mentionCount, agentCount, hasLineage]);

  return useMemo(
    // A panel that stopped existing cannot stay open: a session whose last
    // subagent row went away with a re-parse would otherwise leave the
    // inspector holding a title with nothing under it.
    () => ({
      open: open !== null && items.some((i) => i.key === open) ? open : null,
      width,
      items,
      toggle,
      close,
      startResize,
      dragging,
    }),
    [open, width, items, toggle, close, startResize, dragging],
  );
}
