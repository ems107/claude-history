import { MIN_USAGE_INTERVAL_SECONDS, type ServerEvent } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

/** Collapses the write burst of a single turn into one usage read. */
const USAGE_DEBOUNCE_MS = 3_000;
/**
 * A second above the server's own floor on purpose: the server measures it
 * from the moment it actually fetched, which is later than the moment we
 * asked, so asking at exactly 15 s lands on the cached side of the boundary
 * and the reading would stay behind for another whole cycle.
 */
const USAGE_FLOOR_MS = MIN_USAGE_INTERVAL_SECONDS * 1_000 + 1_000;

/**
 * Live updates: one EventSource on /api/events; server events invalidate
 * the relevant queries so the UI refreshes automatically.
 */
export function useEvents(): void {
  const queryClient = useQueryClient();
  const usageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usageAskedAt = useRef(0);
  useEffect(() => {
    /**
     * Subscription usage moves when Claude answers, and a transcript growing
     * is the signal for that — far better than polling. One turn writes many
     * times (the prompt, every tool call, the reply), so reads are throttled;
     * and because any event without a pending timer schedules one, the LAST
     * write of a burst always gets a read after it. Without that trailing
     * read the widget would freeze on whatever it caught mid-turn.
     *
     * Deliberately NOT wired to 'live-changed': that fires on every heartbeat
     * written under ~/.claude/sessions, idle sessions included, which would
     * quietly turn this into a permanent poll at the floor.
     */
    const kickUsage = () => {
      if (usageTimer.current) return;
      const wait = Math.max(USAGE_DEBOUNCE_MS, USAGE_FLOOR_MS - (Date.now() - usageAskedAt.current));
      usageTimer.current = setTimeout(() => {
        usageTimer.current = null;
        usageAskedAt.current = Date.now();
        void queryClient.invalidateQueries({ queryKey: ['usage'] });
      }, wait);
    };

    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(e.data) as ServerEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case 'sessions-changed':
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
          void queryClient.invalidateQueries({ queryKey: ['projects'] });
          for (const id of event.ids) void queryClient.invalidateQueries({ queryKey: ['session', id] });
          kickUsage();
          break;
        case 'session-updated':
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
          void queryClient.invalidateQueries({ queryKey: ['session', event.id] });
          break;
        case 'live-changed':
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
          void queryClient.invalidateQueries({ queryKey: ['live'] });
          break;
        case 'index-progress':
          void queryClient.invalidateQueries({ queryKey: ['meta'] });
          break;
        case 'update-status':
          void queryClient.invalidateQueries({ queryKey: ['update'] });
          break;
        // Already throttled to one per second by the server. Cheap: both
        // queries are local reads, and the day parse is cached and incremental.
        case 'logs-appended':
          void queryClient.invalidateQueries({ queryKey: ['logs'] });
          void queryClient.invalidateQueries({ queryKey: ['logDay'] });
          break;
      }
    };
    return () => {
      es.close();
      if (usageTimer.current) clearTimeout(usageTimer.current);
    };
  }, [queryClient]);
}
