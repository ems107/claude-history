import type { MessageItem } from '@claude-history/shared';
import { createContext, useContext } from 'react';

/**
 * Starring a message, for the toolbar inside a bubble — a context for the same
 * reason `SubagentContext` is one: the button sits several components below the
 * page that knows which session this is.
 *
 * Absent means there is nothing to star against, and the button is not drawn at
 * all. That is what keeps it out of the subagent drawer: an agent's uuids live
 * in the agent's own transcript, so a star there would key on a message the
 * session does not contain. Same for a test rendering a turn on its own.
 */
export interface StarContextValue {
  /**
   * Asks by the canonical uuid AND by the aliases: a star is stored under the
   * canonical one, but a merged answer answers to any of its chunks' uuids.
   */
  isStarred(item: MessageItem): boolean;
  /** Star it, or unstar it if it already is. */
  toggle(item: MessageItem): void;
  /** The uuid of a write in flight, so its button can stop offering a second click. */
  busy: string | null;
}

export const StarContext = createContext<StarContextValue | null>(null);

export function useStars(): StarContextValue | null {
  return useContext(StarContext);
}
