import type { ServerEvent } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { readUsageSettings } from './usageSettings.ts';
import { markUsageRead } from './usageReason.ts';

/** Collapses the write burst of a single turn into one usage read. */
const USAGE_DEBOUNCE_MS = 3_000;
/**
 * How long a refetch of the expensive queries waits for the rest of its burst.
 *
 * One line written by a working session produces two events, not one:
 * `rescan()` emits `sessions-changed` and fires the enricher without waiting
 * for it, and the enricher emits `session-updated` when it lands — measured 40
 * to 200 ms later. Both mean "this session moved", both invalidate the same
 * keys, and they are too far apart for TanStack to dedupe, so the list came
 * back twice per line: ~600 KB and a re-sort of every row, for one row.
 *
 * Long enough to cover that gap, short enough that nobody sees it.
 */
const BURST_MS = 250;
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
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Keys asked for during the burst, by their serialised form, so each is refetched once. */
  const burstKeys = useRef(new Map<string, readonly unknown[]>());
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

    /**
     * The keys a write burst would otherwise ask for twice: the 600 KB session
     * list, the project colours derived from it, and the transcript of whatever
     * moved — a full server-side parse each time.
     *
     * A THROTTLE, not a debounce: the first event of a burst schedules the
     * refetch and the rest join it without pushing the timer back, so a session
     * writing without pause cannot starve its own row of an update. Only the
     * SSE goes through here. An invalidation that follows something the user
     * just did — a rename, a pin — stays immediate, and so does `['live']`,
     * which is small and is what moves the badge on the session page.
     */
    const burst = (...keys: readonly unknown[][]) => {
      for (const k of keys) burstKeys.current.set(JSON.stringify(k), k);
      if (burstTimer.current) return;
      burstTimer.current = setTimeout(() => {
        burstTimer.current = null;
        const due = [...burstKeys.current.values()];
        burstKeys.current.clear();
        for (const queryKey of due) void queryClient.invalidateQueries({ queryKey });
      }, BURST_MS);
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
          burst(['sessions'], ['projects'], ...event.ids.map((id) => ['session', id]));
          /**
           * A subagent's transcript is a conversation of its own behind its own
           * key, and nothing else here reaches it: without this the drawer drew
           * an agent once and never looked at the file again, so watching one
           * work meant closing and reopening it.
           *
           * One key per agent the server says moved, and NOT the `['subagent',
           * id]` prefix: with the list open every agent of the session is
           * mounted, and 350-500 KB re-read eleven times per write is the whole
           * reason the event carries the ids. It beats the list's own 5-minute
           * `staleTime` — an invalidation refetches an active query whatever its
           * staleness — so the rows and the drawer move together.
           *
           * `session-updated` needs none of this: it lands right behind the same
           * rescan, and re-reading them twice would be the noise this avoids.
           */
          for (const a of event.agents ?? []) {
            void queryClient.invalidateQueries({ queryKey: ['subagent', a.sessionId, a.agentId] });
          }
          kickUsage(event.assistantIds ?? []);
          break;
        case 'session-updated':
          burst(['sessions'], ['session', event.id]);
          break;
        // Something registered under ~/.claude/sessions moved: a turn started or
        // ended, a CLI came up, a CLI is gone.
        case 'live-changed':
          burst(['sessions']);
          void queryClient.invalidateQueries({ queryKey: ['live'] });
          /**
           * A CLI that is not ours took a session or let go of it, and the only
           * place that is ever said is `blockedReason` — the composer and the
           * embedded terminal both refuse over this same list. Without this the
           * amber bar sat there naming a terminal that had been closed, until
           * somebody reloaded the page.
           *
           * By id, never the `['chat']` prefix: `ids` is the sessions that came
           * or went, and a busy/idle flip carries none, so a composer nobody
           * blocked is not refetched — which would throw away the model it has
           * just been switched to.
           */
          for (const id of event.ids ?? []) {
            void queryClient.invalidateQueries({ queryKey: ['chat', id] });
            void queryClient.invalidateQueries({ queryKey: ['terminal', id] });
          }
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
          // A composer process came or went, which is what six actions refuse
          // over — so the notice on the settings page moves with it.
          void queryClient.invalidateQueries({ queryKey: ['activeSessions'] });
          // The list shows these turns as busy, and its only source for that is
          // the chat state — so the badge moves with this event, not with
          // 'live-changed', which knows nothing about our processes.
          burst(['sessions']);
          void queryClient.invalidateQueries({ queryKey: ['live'] });
          break;
        // A terminal opened, its CLI exited, or it was closed. Its own event
        // rather than `live-changed`: the pseudo-terminal outlives the CLI
        // inside it on purpose, so ~/.claude/sessions cannot speak for it.
        case 'terminal-changed':
          void queryClient.invalidateQueries({ queryKey: ['terminal', event.id] });
          void queryClient.invalidateQueries({ queryKey: ['activeSessions'] });
          // The buttons that refuse while a terminal holds a session read this:
          // the composer's `blockedReason` and "Resume in terminal".
          void queryClient.invalidateQueries({ queryKey: ['chat', event.id] });
          burst(['sessions']);
          void queryClient.invalidateQueries({ queryKey: ['live'] });
          break;
        // Only the stars. Never `['session', id]`: the transcript did not
        // change, and re-parsing a multi-MB one to redraw a star would be the
        // most expensive way possible to colour a glyph.
        case 'stars-changed':
          void queryClient.invalidateQueries({ queryKey: ['stars'] });
          break;
        /**
         * Settings saved in ANOTHER window. Nothing else would ever refetch
         * them here: the usage widget in the header keeps `['settings']` mounted
         * for the life of the page, so the query never remounts, and
         * `refetchOnWindowFocus` is off. That left a second window running the
         * old policy — including whether it reads subscription usage at all.
         *
         * Deliberately NOT invalidating `['usage']`: that would turn one
         * person's toggle into a network read in every open window, and the one
         * that made the change already does its own labelled read. Both queries
         * here are local reads.
         */
        case 'settings-changed':
          void queryClient.invalidateQueries({ queryKey: ['settings'] });
          void queryClient.invalidateQueries({ queryKey: ['autoReload'] });
          // `maxActiveSessions` is one of them, and it is half of "3 of 10".
          void queryClient.invalidateQueries({ queryKey: ['activeSessions'] });
          break;
        // A session stopped, came back, or was cleared. One key, and only this
        // one — the bell and the toast stack both read it, and neither needs
        // anything else re-asked.
        case 'notifications-changed':
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          break;
        // A session was read, here or in another window. One key: the rows
        // subtract it from the summary they already hold, so nothing else has
        // to be re-asked for the count to move.
        case 'read-marks-changed':
          void queryClient.invalidateQueries({ queryKey: ['readMarks'] });
          break;
        // Costs are computed in the browser wherever they appear, so a saved
        // table has to reach the windows that did not save it.
        case 'prices-changed':
          void queryClient.invalidateQueries({ queryKey: ['prices'] });
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
      if (burstTimer.current) {
        clearTimeout(burstTimer.current);
        burstTimer.current = null;
        burstKeys.current.clear();
      }
    };
  }, [queryClient]);
}
