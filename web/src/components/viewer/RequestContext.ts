import { createContext, useContext } from 'react';

/**
 * Opens a request beside the conversation (`?request=`), for the context pill
 * of the reply it produced — several components below the page that owns the
 * column, as `FileRefContext` and `SubagentContext` are.
 *
 * Provided around the conversation only, like `StarContext`: a subagent's
 * drawer draws a transcript that records its own requests, not wired yet. With
 * no opener the pill draws exactly what it drew before.
 */
export const RequestContext = createContext<((requestId: string) => void) | null>(null);

export function useRequestOpener(): ((requestId: string) => void) | null {
  return useContext(RequestContext);
}
