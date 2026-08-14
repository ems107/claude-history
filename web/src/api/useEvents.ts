import type { ServerEvent } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { readUsageSettings } from './usageSettings.ts';
import { markUsageRead } from './usageReason.ts';

/** Collapses the write burst of a single turn into one usage read. */
const USAGE_DEBOUNCE_MS = 3_000;
/**
 * A second above the server's own floor on purpose: the server measures it
 * from the moment it actually fetched, which is later than the moment we
 * asked, so asking at exactly the floor lands on the cached side of the
 * boundary and the reading would stay behind for another whole cycle.
 */
const FLOOR_MARGIN_MS = 1_000;

/**
 * Live updates: one EventSource on /api/events; server events invalidate
 * the relevant queries so the UI refreshes automatically.
 */
export function useEvents(): void {
  const queryClient = useQueryClient();
  const usageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usageAskedAt = useRef(0);
  /** Sessions Claude answered in while the debounce timer was running. */
  const pendingIds = useRef(new Set<string>());
  useEffect(() => {
    /**
     * Subscription usage moves when Claude answers, and the server says which
     * of the changed sessions that was (`assistantIds`) — the rest grew for
     * reasons that cost nothing: your prompt being written, a tool result
     * coming back, the sidecar lines rewritten every single turn.
     *
     * One turn still writes many times, so reads are throttled; and because
     * any event without a pending timer schedules one, the LAST write of a
     * burst always gets a read after it. Without that trailing read the widget
     * would freeze on whatever it caught mid-turn.
     *
     * Deliberately NOT wired to 'live-changed': that fires on every heartbeat
     * written under ~/.claude/sessions, idle sessions included, which would
     * quietly turn this into a permanent poll at the floor.
     */
    const kickUsage = (ids: string[]) => {
      const s = readUsageSettings(queryClient);
      if (!s.usageOnActivity || ids.length === 0) return;
      // Sessions accumulate across the burst: the read that eventually fires
      // answers for every session that moved while the timer was pending.
      for (const id of ids) pendingIds.current.add(id);
      if (usageTimer.current) return;
      const floorMs = s.usageMinIntervalSeconds * 1_000 + FLOOR_MARGIN_MS;
      const wait = Math.max(USAGE_DEBOUNCE_MS, floorMs - (Date.now() - usageAskedAt.current));
      usageTimer.current = setTimeout(() => {
        usageTimer.current = null;
        usageAskedAt.current = Date.now();
        markUsageRead('widget-activity', [...pendingIds.current]);
        pendingIds.current.clear();
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
          kickUsage(event.assistantIds ?? []);
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
        // A turn started, finished, or a process came and went. This is the
        // only notice of it: a --print run writes no `status` into
        // ~/.claude/sessions, so `live-changed` never speaks for these.
        case 'chat-changed':
          void queryClient.invalidateQueries({ queryKey: ['chat', event.id] });
          // The list shows these turns as busy, and its only source for that is
          // the chat state — so the badge moves with this event, not with
          // 'live-changed', which knows nothing about our processes.
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
          void queryClient.invalidateQueries({ queryKey: ['live'] });
          break;
        // Throttled to one a second by the server, and it carries only the
        // newest seq — the panel fetches from where it left off, so a tab with
        // it closed pays nothing for this.
        case 'git-commands':
          void queryClient.invalidateQueries({ queryKey: ['git', 'commands'] });
          break;
        // A repository's gitdir changed: branch switched, index written, merge
        // started. LOCAL state only — this must never lead to a fetch.
        case 'git-repo-changed':
          void queryClient.invalidateQueries({ queryKey: ['git', 'status', event.id] });
          void queryClient.invalidateQueries({ queryKey: ['git', 'branches', event.id] });
          void queryClient.invalidateQueries({ queryKey: ['git', 'stashes', event.id] });
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
