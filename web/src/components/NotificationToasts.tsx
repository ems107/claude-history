import type { StoppedSessionEntry } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { useNotifications } from '../api/useNotifications.ts';
import { DismissCross, FALLBACK_COLOR, NotificationRow } from './NotificationRow.tsx';

/**
 * How long a card stays. Also the duration of the bar's animation, in
 * `styles.css` — the two must agree, and this is the number that decides.
 */
export const TOAST_MS = 10_000;

/**
 * Above that and the stack owns the screen. The bell holds every one of them
 * anyway, so what is dropped here is only the announcement, never the record.
 */
const MAX_VISIBLE = 4;

/** What makes a stop THIS stop: a later one for the same session is a new card. */
const keyOf = (s: StoppedSessionEntry): string => `${s.sessionId}:${s.at}`;

/**
 * The cards that float in when a session stops.
 *
 * **A stop is announced once, and the bell is the record.** So a card is raised
 * by a row APPEARING, not by a row existing — otherwise every reload would throw
 * up the whole list, which is the same mistake the server side had to avoid and
 * for the same reason (see `core/notifications.ts`). The first answer to
 * `['notifications']` therefore seeds silently: what was already there when this
 * page loaded was not seen to happen.
 *
 * The clock is per session and not a set of keys: `at` only ever moves forward
 * for one session, so `at > lastAt` is "this is news" and the map stays the size
 * of the sessions involved rather than growing with every stop of the day. It
 * also makes withdraw-then-raise behave — the same stop re-listed is not news,
 * a later one is.
 *
 * **Where it sits, and why not the bottom right.** That corner is the busiest
 * geometry in the app: the follow pill lives in it, the composer's Send is under
 * it, and a terminal's resize handle crosses it — all of it measured by check 27,
 * and none of it worth a new set of collision rules. Under the header on the
 * right, a card appears where the bell it belongs to already is, which is also
 * the only thing on screen that explains where it went when it goes.
 *
 * **It sits BELOW the popovers on purpose** (`z-[35]`, under the bell's own
 * click-catcher at 40 and its panel at 50). Opening the bell covers the cards,
 * which is right: you are looking at the list they were announcing.
 */
export function NotificationToasts() {
  const { data } = useNotifications();
  const [toasts, setToasts] = useState<StoppedSessionEntry[]>([]);
  /** The newest `at` seen per session. `null` until the first answer seeds it. */
  const lastAt = useRef<Map<string, number> | null>(null);
  // Only once there is something to draw: a colour for the project tags is worth
  // a read when a card is up, and nothing at all the rest of the time. Deduped
  // with the list page's copy and with the bell's.
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects,
    enabled: toasts.length > 0,
  });

  const stopped = data?.stopped;

  useEffect(() => {
    if (!stopped) return;
    const seen = lastAt.current;
    if (seen === null) {
      lastAt.current = new Map(stopped.map((s) => [s.sessionId, s.at]));
      return;
    }
    const fresh = stopped.filter((s) => s.at > (seen.get(s.sessionId) ?? -1));
    for (const s of stopped) seen.set(s.sessionId, Math.max(s.at, seen.get(s.sessionId) ?? -1));
    // A card whose row has gone is announcing something that is no longer true —
    // the session went back to work, or it was cleared, or it was read in the
    // panel. Dropping it keeps the two halves saying the same thing.
    const live = new Set(stopped.map(keyOf));
    setToasts((current) => {
      const kept = current.filter((t) => live.has(keyOf(t)));
      if (fresh.length === 0) return kept.length === current.length ? current : kept;
      // Newest first, nearest the bell.
      return [...fresh, ...kept.filter((t) => !fresh.some((f) => keyOf(f) === keyOf(t)))].slice(0, MAX_VISIBLE);
    });
  }, [stopped]);

  const close = (key: string) => setToasts((current) => current.filter((t) => keyOf(t) !== key));

  if (toasts.length === 0) return null;

  return (
    // `pointer-events-none` on the column and back on for each card: the gaps
    // between cards must not swallow clicks meant for the page underneath.
    //
    // A polite live region, announced once per card. The bar inside is
    // `aria-hidden` — a countdown read out ten times would drown the sentence.
    <div
      className="pointer-events-none fixed top-[3.25rem] right-3 z-[35] flex w-[22rem] flex-col gap-2"
      role="region"
      aria-label="Recent session stops"
      aria-live="polite"
    >
      {toasts.map((stop) => (
        <Toast
          key={keyOf(stop)}
          stop={stop}
          color={
            (stop.projectKey ? projects?.find((p) => p.key === stop.projectKey)?.color : undefined) ?? FALLBACK_COLOR
          }
          onClose={() => close(keyOf(stop))}
        />
      ))}
    </div>
  );
}

function Toast({
  stop,
  color,
  onClose,
}: {
  stop: StoppedSessionEntry;
  color: string;
  onClose: () => void;
}) {
  const needsYou = stop.kind === 'needs-you';
  // The card takes itself down. A ref-free timeout keyed on the card's identity:
  // it is remounted per key, so one timer per card and no reset on a re-render.
  useEffect(() => {
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`group pointer-events-auto overflow-hidden rounded-lg border bg-[var(--bg-raised)] shadow-xl ${
        needsYou ? 'border-amber-500/50' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-stretch gap-1 pt-1.5">
        <div className="min-w-0 flex-1">
          {/* Which of the two reasons, in the same amber the panel's heading uses
              — a card has no group above it to say so, and the whole point of
              the distinction is that one of them wants something from you. */}
          <div
            className={`px-2.5 text-[10px] font-semibold tracking-wide uppercase ${
              needsYou ? 'text-amber-400' : 'text-[var(--text-dim)]'
            }`}
          >
            {needsYou ? 'Needs you' : 'Finished'}
          </div>
          <NotificationRow stop={stop} color={color} onNavigate={onClose} className="px-2.5 pt-0.5 pb-2" />
        </div>
        {/* Outside the link, and given the card's own top-right corner. */}
        <div className="pr-1">
          <DismissCross label={stop.title ?? stop.sessionId} onClick={onClose} title="Close" />
        </div>
      </div>
      {/* The time left, as a bar that FILLS. Drawn full width and scaled from
          nothing, so the animation is a transform the compositor owns rather
          than a width every frame relayouts — and `scaleX` still reports through
          `getBoundingClientRect`, so it stays measurable. Track underneath, or
          the bar reads as an edge of the card rather than as a gauge. */}
      <div aria-hidden="true" className="h-[3px] w-full bg-[var(--border)]">
        <div className={`toast-fill h-full origin-left ${needsYou ? 'bg-amber-400' : 'bg-[var(--accent)]'}`} />
      </div>
    </div>
  );
}
