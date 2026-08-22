import type { StoppedSessionEntry } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { useNotifications } from '../api/useNotifications.ts';
import { CountBadge } from './CountBadge.tsx';
import { BellIcon } from './icons.tsx';
import { DismissCross, FALLBACK_COLOR, NotificationRow } from './NotificationRow.tsx';

/**
 * The bell: sessions that have stopped, and what they stopped for.
 *
 * **A popover, not a modal**, which is the one place this deliberately parts
 * company with the update button beside it. That one blacks the page out and
 * opens at `max-w-6xl` because what is read inside it is every pending release's
 * notes; this is a handful of rows, and taking the whole window for them would
 * be a dialog to dismiss rather than a glance. The shape comes from
 * `UsageWidget`, its other neighbour, down to the invisible full-screen layer
 * that catches the click outside.
 *
 * The BUTTON is the update button's, class for class, because those two do have
 * to look like one pair of controls.
 *
 * Amber, like the update badge and for the same reason `BlockedBar` is amber:
 * nothing has gone wrong here. A session waiting on an answer is a state to
 * resolve, and red is kept for what actually broke.
 *
 * Never hidden. The bell answers when there is nothing pending — that was the
 * ask — so unlike `UpdateButton` and `UsageWidget` it has no early return, and
 * the header's right-hand group keeps the same width all day.
 */
export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data } = useNotifications();
  // Only while the panel is up: a colour for the project tags is worth one read
  // when they are about to be drawn, and nothing at all the rest of the time.
  // Deduped with the session list's copy whenever that page is mounted.
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: api.projects, enabled: open });

  const stopped = data?.stopped ?? [];
  const count = stopped.length;

  // Escape closes it. Neither of its neighbours does this, and both should: a
  // panel opened by accident should not need the mouse to get rid of.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const colorOf = (key: string | null): string =>
    (key ? projects?.find((p) => p.key === key)?.color : undefined) ?? FALLBACK_COLOR;

  // The answer replaces the cached list, so the badge drops on the click rather
  // than on the SSE round trip that follows it.
  const dismiss = (sessionId: string) => {
    void api
      .dismissNotification(sessionId)
      .then((body) => queryClient.setQueryData(['notifications'], body))
      .catch(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
  };
  const clearAll = () => {
    void api
      .clearNotifications()
      .then((body) => queryClient.setQueryData(['notifications'], body))
      .catch(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
  };

  const needsYou = stopped.filter((s) => s.kind === 'needs-you');
  const finished = stopped.filter((s) => s.kind === 'finished');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
        title={
          count > 0
            ? `${count} session${count !== 1 ? 's' : ''} stopped and waiting for you`
            : 'Sessions that have stopped'
        }
        aria-label="Notifications"
      >
        <BellIcon />
        <CountBadge count={count} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Wider than the usage panel's `w-84`: a row carries a session title
              and a project tag on one line, and at that width every title wrapped. */}
          <div className="absolute right-0 z-50 mt-1 w-[26rem] rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-3 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xs font-semibold" title="Sessions seen to stop while this app was watching">
                Notifications
              </h3>
              {count > 0 && (
                <span className="rounded bg-amber-400/15 px-1.5 py-px text-[10px] font-semibold text-amber-400 uppercase">
                  {count} stopped
                </span>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto cursor-pointer rounded px-1.5 text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                ✕
              </button>
            </div>

            {count === 0 ? (
              <div className="space-y-1 py-1 text-xs">
                <div className="text-[var(--text)]">Nothing is waiting for you.</div>
                {/* An empty panel that only says "empty" leaves the reader
                    wondering what would ever appear in it. */}
                <div className="text-[11px] text-[var(--text-dim)]">
                  A session shows up here when it stops — either because Claude finished answering, or because
                  something is on screen waiting for your decision.
                </div>
              </div>
            ) : (
              <div className="max-h-[70vh] space-y-3 overflow-y-auto">
                <Group
                  label="Needs you"
                  rows={needsYou}
                  colorOf={colorOf}
                  onDismiss={dismiss}
                  onOpen={() => setOpen(false)}
                />
                <Group
                  label="Finished"
                  rows={finished}
                  colorOf={colorOf}
                  onDismiss={dismiss}
                  onOpen={() => setOpen(false)}
                />
              </div>
            )}

            {count > 0 && (
              <div className="mt-3 flex justify-end border-t border-[var(--border)] pt-2">
                <button
                  type="button"
                  onClick={clearAll}
                  className="cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One of the two reasons, with its rows. Drawn only when it has any — the two
 * headings exist to tell the reasons apart, and a heading over nothing is worse
 * than no heading at all.
 */
function Group({
  label,
  rows,
  colorOf,
  onDismiss,
  onOpen,
}: {
  label: string;
  rows: StoppedSessionEntry[];
  colorOf: (key: string | null) => string;
  onDismiss: (sessionId: string) => void;
  onOpen: () => void;
}) {
  if (rows.length === 0) return null;
  const needsYou = label === 'Needs you';
  return (
    <div>
      <div
        className={`mb-1 text-[10px] font-semibold tracking-wide uppercase ${
          needsYou ? 'text-amber-400' : 'text-[var(--text-dim)]'
        }`}
      >
        {label} · {rows.length}
      </div>
      <div className="space-y-1">
        {rows.map((s) => (
          <Row key={s.sessionId} stop={s} color={colorOf(s.projectKey)} onDismiss={onDismiss} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function Row({
  stop,
  color,
  onDismiss,
  onOpen,
}: {
  stop: StoppedSessionEntry;
  color: string;
  onDismiss: (sessionId: string) => void;
  onOpen: () => void;
}) {
  // Everything inside is shared with the toast — see `NotificationRow` for why
  // the whole area is the link and the cross is its sibling. What is local to
  // the panel is the chrome: a hover fill, and no border of its own.
  return (
    <div className="group flex items-stretch gap-1 rounded hover:bg-[var(--bg-hover)]">
      <NotificationRow stop={stop} color={color} onNavigate={onOpen} />
      <DismissCross label={stop.title ?? stop.sessionId} onClick={() => onDismiss(stop.sessionId)} />
    </div>
  );
}
