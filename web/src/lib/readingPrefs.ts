import { useCallback, useMemo, useState } from 'react';

/**
 * How the conversation is READ: which of its parts are drawn at all.
 *
 * The sibling of [viewPrefs], which owns how big it is drawn, and split from it
 * on purpose: zoom and width are geometry and apply to any thread (the new
 * session page has one too), while these three are about a transcript's own
 * content. Both are global and persisted for the same reason — a reading
 * preference belongs to the reader, not to one session.
 *
 * They lived as three `useState`s in `SessionViewPage` with the `localStorage`
 * write spelled out again inside each `onToggle` handed to the header, which is
 * how `expandTools` came to be written in a different place from where it was
 * read. One home, one pair of keys.
 */

const THINKING_KEY = 'showThinking';
const TOOLS_KEY = 'expandTools';

export interface ReadingPrefs {
  showThinking: boolean;
  toggleThinking: () => void;
  expandTools: boolean;
  toggleTools: () => void;
  expandSegments: boolean;
  toggleSegments: () => void;
  /**
   * Everything is where it started. What lights the `View` button, so a menu
   * nobody can see never changes the conversation in silence — the rule
   * `ViewButton` already applied to zoom and width, now covering all five.
   */
  isDefault: boolean;
}

export function useReadingPrefs(): ReadingPrefs {
  const [showThinking, setShowThinking] = useState(() => localStorage.getItem(THINKING_KEY) === 'true');
  const [expandTools, setExpandTools] = useState(() => localStorage.getItem(TOOLS_KEY) === 'true');
  /**
   * Not persisted, unlike the two above: folded is the point of the feature, and
   * a session opened tomorrow should still open on the context that is alive.
   */
  const [expandSegments, setExpandSegments] = useState(false);

  const toggleThinking = useCallback(() => {
    setShowThinking((v) => {
      localStorage.setItem(THINKING_KEY, String(!v));
      return !v;
    });
  }, []);
  const toggleTools = useCallback(() => {
    setExpandTools((v) => {
      localStorage.setItem(TOOLS_KEY, String(!v));
      return !v;
    });
  }, []);
  const toggleSegments = useCallback(() => setExpandSegments((v) => !v), []);

  return useMemo(
    () => ({
      showThinking,
      toggleThinking,
      expandTools,
      toggleTools,
      expandSegments,
      toggleSegments,
      isDefault: !showThinking && !expandTools && !expandSegments,
    }),
    [showThinking, toggleThinking, expandTools, toggleTools, expandSegments, toggleSegments],
  );
}
