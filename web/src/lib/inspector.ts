import { useCallback, useMemo, useState } from 'react';
import { WIDTH_MIN } from './viewPrefs.ts';

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
 * The rail's width. A constant rather than a class because two overlays have to
 * step around it: the subagent drawer and the file viewer are `position: fixed`
 * against the right edge, and the rail is furniture — nothing covers it.
 *
 * 72 px and not the 44 an icon needs, because every item carries its LABEL.
 * Six unlabelled glyphs down the side of the window is six things to learn and
 * a tooltip to wait for; the words cost 28 px once.
 */
export const RAIL_PX = 72;

/** The seam between the conversation and the inspector — `w-1`, as in the list's sidebar. */
export const GRIP_PX = 4;

const WIDTH_KEY = 'inspectorWidth';
export const INSPECTOR_DEFAULT = 400;
export const INSPECTOR_MIN = 320;
export const INSPECTOR_MAX = 900;

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
  startResize: (e: React.MouseEvent) => void;
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
  const [local, setLocal] = useState<PanelKey | null>(null);
  const [width, setWidth] = useState(readWidth);

  const open: PanelKey | null = agents.open ? 'agents' : local;

  const toggle = useCallback(
    (key: PanelKey) => {
      if (key === 'agents') {
        // Whichever way it goes, nothing else may stay open behind it.
        setLocal(null);
        agents.toggle();
        return;
      }
      if (agents.open) agents.close();
      setLocal((prev) => (prev === key ? null : key));
    },
    [agents],
  );

  const close = useCallback(() => {
    if (agents.open) agents.close();
    setLocal(null);
  }, [agents]);

  // Dragging the LEFT edge, so the sign is mirrored: the same shape as the
  // session list's sidebar handle, which is the other one of these in the app.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const from = readWidth();
    // Never so wide that the conversation drops below the narrowest width the
    // reader can choose for it. Read once, at the start of the drag: a window
    // resized afterwards simply squeezes the column, exactly as it always has.
    const max = Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, window.innerWidth - RAIL_PX - GRIP_PX - WIDTH_MIN));
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(max, Math.max(INSPECTOR_MIN, from + startX - ev.clientX));
      setWidth(w);
      localStorage.setItem(WIDTH_KEY, String(w));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
    }),
    [open, width, items, toggle, close, startResize],
  );
}
