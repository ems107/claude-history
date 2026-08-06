import type { ServerEvent } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Live updates: one EventSource on /api/events; server events invalidate
 * the relevant queries so the UI refreshes automatically.
 */
export function useEvents(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
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
      }
    };
    return () => es.close();
  }, [queryClient]);
}
