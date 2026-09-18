import { useQuery } from '@tanstack/react-query';
import { api } from './client.ts';

/**
 * The sessions that have stopped — the header's bell, and the session view
 * clearing its own row on the way in.
 *
 * No `refetchInterval`. The server raises and withdraws every row itself and
 * says so on `notifications-changed`, so a poll here would only ask a question
 * the answer to which is already on its way. Mounted for the life of the page by
 * the bell, which is what lets the session view read it for free.
 */
export function useNotifications() {
  return useQuery({ queryKey: ['notifications'], queryFn: api.notifications });
}
