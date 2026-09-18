import { useQuery } from '@tanstack/react-query';
import { api } from './client.ts';

/**
 * What the app is running, for a page that wants to say so BEFORE anything is
 * pressed — the settings section whose two controls the server would refuse.
 *
 * The refusals themselves need none of this: the 409 carries its own list, so a
 * button nobody presses costs nothing. Kept fresh by `chat-changed` and
 * `terminal-changed` in `useEvents`, which is also what makes it honest in a
 * second window.
 */
export function useActiveSessions() {
  return useQuery({ queryKey: ['activeSessions'], queryFn: api.activeSessions });
}
