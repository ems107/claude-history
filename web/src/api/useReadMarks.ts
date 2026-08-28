import { useQuery } from '@tanstack/react-query';
import { api } from './client.ts';

/**
 * How much of each session had been read the last time somebody read it — what
 * the count on a list row is measured against.
 *
 * Like `useNotifications`, and for the same reasons: no `refetchInterval`,
 * because the server says `read-marks-changed` whenever a mark moves; one query
 * key across every visible row, so a hundred rows cost one request; and the same
 * lifetime as the bell's list, which is what makes both marks on a row behave
 * alike when the page is reloaded.
 */
export function useReadMarks() {
  return useQuery({ queryKey: ['readMarks'], queryFn: api.readMarks });
}
