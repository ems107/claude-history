import type { StoppedSessionEntry } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useMatch } from 'react-router';
import { api } from '../api/client.ts';
import { useNotifications } from '../api/useNotifications.ts';
import { announceStop, primeAudio } from '../lib/notificationSound.ts';
import { claimAnnouncement, useAnyTabVisible } from '../lib/tabs.ts';
import { useWindowFocused } from '../lib/windowFocus.ts';
import { DismissCross, FALLBACK_COLOR, NotificationRow } from './NotificationRow.tsx';

/**
 * How long a card stays, and the duration of the bar's animation in
 * `styles.css`. **The bar is what actually ends the card** — see `Toast` — so
 * this figure exists to be read beside that one and to size the backstop below.
 * Exported for the session view, whose deferred withdrawal of an announced
 * row (`notifyInFront`) is this same window measured from the stop.
 */
export const TOAST_MS = 10_000;

/**
 * The card cannot be immortal, whatever happens to its animation. Nothing in
 * this app reads `prefers-reduced-motion` (see `styles.css`), so the bar always
 * runs and `animationend` always comes — but a browser that disabled animations
 * some other way would otherwise leave a card on screen for ever. Far longer
 * than any pause a person makes with a pointer, so it never races the real end.
 *
 * It measures the time somebody was WATCHING, in whole stretches: the timer is
 * dropped when every tab goes away and started again from the top when one comes
 * back. A ceiling on how long a card can hold the corner in front of a person,
 * which is what it was always for — never a second clock on the ten seconds.
 */
const BACKSTOP_MS = TOAST_MS * 12;

/**
 * A hard ceiling, not a budget — every stop that happens together should be on
 * screen together, so this is set where the column still fits the shortest
 * window worth caring about rather than where the list looks tidy. Measured: a
 * card is 76 px and the gaps are 8, so six of them end 548 px down, inside a
 * 600 px window. Four fitted twice over and would have bitten first.
 *
 * When it does bite, what is dropped is only the ANNOUNCEMENT: the bell holds
 * every one of them, with the count on the badge right above the stack.
 */
const MAX_VISIBLE = 6;

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
 *
 * **And it is where the SOUND comes from**, for the one reason that matters: the
 * `lastAt` map below is the only thing in the app that knows a stop is news, and
 * a second copy of that reasoning somewhere else would be the duplication
 * `NotificationRow` was extracted to prevent. A card and a tone announce exactly
 * the same set, so they are decided in the same place — the tone's mechanics are
 * `lib/notificationSound.ts` and whose turn it is to make it is `lib/tabs.ts`.
 */
export function NotificationToasts() {
  const { data } = useNotifications();
  const [toasts, setToasts] = useState<StoppedSessionEntry[]>([]);
  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const settings = settingsData?.settings;
  /**
   * Whether a stop gets announced at all.
   *
   * Undefined settings mean "not yet", not "yes": there is nothing to guess with
   * and one silent stop is a smaller wrong than a card somebody switched off.
   * The window barely exists — the first answer to `['notifications']` seeds in
   * silence anyway, so a stop would have to arrive between two local requests.
   */
  const announce = settings?.notifyEnabled === true;
  /**
   * **The ten seconds are ten seconds of somebody looking.** Read once here and
   * handed down, so every card on the stack answers to one reading of it rather
   * than to a subscription each — and so the OTHER tabs' answer is in it, which
   * is the whole of `tabs.ts`.
   */
  const watching = useAnyTabVisible();
  /**
   * **The session you are looking at needs no announcing.** A card and a tone
   * for a stop you are watching happen is an interruption that carries nothing:
   * the page is already saying it, in the indicator, in the turn arriving and in
   * the dialog waiting to be answered.
   *
   * Which is only true while somebody is really in front of it — the same
   * question the row's withdrawal asks, and for the same reason
   * (`lib/windowFocus.ts`). A session view in a background tab, or behind an
   * editor, announces exactly like any other session, because that is a stop
   * nobody has seen.
   *
   * Decided HERE and not in the session view, because this is where a stop is
   * known to be news at all, and the switches next to it are decided in one
   * place for the same reason.
   *
   * Unless `notifyInFront` says otherwise: with it on, the session in front of
   * you is announced exactly like any other, so `inFront` stays null and the
   * filter below has nothing to drop. The session view defers its withdrawal
   * of the row for the same setting, or the card would fall with the row
   * before anybody heard it.
   */
  const viewed = useMatch('/session/:id')?.params.id ?? null;
  const focused = useWindowFocused();
  const inFront = focused && settings?.notifyInFront !== true ? viewed : null;
  /** The newest `at` seen per session. `null` until the first answer seeds it. */
  const lastAt = useRef<Map<string, number> | null>(null);
  /**
   * The keys listed as of the last answer, for the tone to look at again when its
   * claim comes back — the cards have the same test applied to them by `live`
   * below, but the tone is decided a quarter of a second later than they are.
   *
   * What it catches is the one gap `inFront` cannot close: the session in front
   * of somebody is a fact about THIS tab, so a second tab of the app — the list
   * page, say, in a window nobody is in — hears the same stop and knows nothing
   * about where you are looking. Its row is withdrawn by the tab that owns the
   * view within milliseconds, and this is what makes that withdrawal silence the
   * ding as well as the card. A stop that has stopped being true is not
   * announced, whichever tab happens to hold the claim.
   */
  const listed = useRef<Set<string>>(new Set());
  // Only once there is something to draw: a colour for the project tags is worth
  // a read when a card is up, and nothing at all the rest of the time. Deduped
  // with the list page's copy and with the bell's.
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects,
    enabled: toasts.length > 0,
  });

  const stopped = data?.stopped;

  /**
   * Arm the audio unlock the moment a tone becomes possible, and not a moment
   * later: an `AudioContext` can only be made running from inside a gesture, and
   * a session stopping is not one (see `primeAudio`, which for that reason arms a
   * listener and makes nothing). Volume 0 is somebody asking for silence, and
   * silence needs no listener either.
   */
  const mayRing = announce && (settings?.notifyVolume ?? 0) > 0;
  useEffect(() => {
    if (mayRing) primeAudio();
  }, [mayRing]);

  // Switching it off is felt now rather than in ten seconds' time. Through the
  // setter, so the common case — nothing up, nothing to clear — is not a render.
  useEffect(() => {
    if (!announce) setToasts((current) => (current.length === 0 ? current : []));
  }, [announce]);

  useEffect(() => {
    if (!stopped) return;
    const seen = lastAt.current;
    if (seen === null) {
      lastAt.current = new Map(stopped.map((s) => [s.sessionId, s.at]));
      return;
    }
    const news = stopped.filter((s) => s.at > (seen.get(s.sessionId) ?? -1));
    for (const s of stopped) seen.set(s.sessionId, Math.max(s.at, seen.get(s.sessionId) ?? -1));
    /**
     * **The two checks govern the ANNOUNCEMENT, never the bell.** A kind switched
     * off is a kind you go and look up, not one that stopped happening — the
     * panel lists both all day, with the count on the badge, exactly as before.
     *
     * The seeding above happens either way, switched off included, or turning it
     * back on would bring in everything that stopped while it was off, all at
     * once, as though it had just happened.
     */
    const fresh = announce
      ? news
          .filter((s) => s.sessionId !== inFront)
          .filter((s) => (s.kind === 'needs-you' ? settings.notifyOnNeedsYou : settings.notifyOnFinished))
      : [];
    // A card whose row has gone is announcing something that is no longer true —
    // the session went back to work, or it was cleared, or it was read in the
    // panel. Dropping it keeps the two halves saying the same thing.
    const live = new Set(stopped.map(keyOf));
    listed.current = live;
    setToasts((current) => {
      const kept = current.filter((t) => live.has(keyOf(t)));
      if (fresh.length === 0) return kept.length === current.length ? current : kept;
      // Newest first, nearest the bell.
      return [...fresh, ...kept.filter((t) => !fresh.some((f) => keyOf(f) === keyOf(t)))].slice(0, MAX_VISIBLE);
    });

    /**
     * **One tone for the batch, not one per card.** Six stops arriving together
     * are six cards and a single ding: six dings inside a second is a noise with
     * no information in it, and the cards are already the part that says how
     * many. `needs-you` leads a mixed batch — it is the kind that wants
     * something from you — and it is therefore also what the narrator says.
     *
     * The claim is keyed on the stop the tone is FOR, so two tabs comparing
     * notes are comparing the same thing.
     */
    const lead = fresh.find((s) => s.kind === 'needs-you') ?? fresh[0];
    if (!settings || !lead) return;
    void claimAnnouncement(keyOf(lead)).then((mine) => {
      if (mine && listed.current.has(keyOf(lead))) announceStop(lead.kind, settings);
    });
    // Re-running on a settings change — or on the focus moving, or on a
    // navigation — is harmless and deliberately not guarded against: `seen` has
    // already been advanced, so there is no news left to announce and the card
    // list comes back identical.
  }, [stopped, announce, settings, inFront]);

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
          watching={watching}
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
  watching,
  onClose,
}: {
  stop: StoppedSessionEntry;
  color: string;
  /** Whether any tab of the app is on screen — see `NotificationToasts`. */
  watching: boolean;
  onClose: () => void;
}) {
  const needsYou = stop.kind === 'needs-you';
  const [hovered, setHovered] = useState(false);
  /**
   * **The two reasons the ten seconds are not being spent, as one fact.** The
   * pointer is on the card, so it is being read; or nobody is at the app at all,
   * so nothing is. Both are "there is a person in front of this and the card
   * must wait for them", and the second is only the stronger of the two.
   */
  const running = watching && !hovered;
  const bar = useRef<HTMLDivElement>(null);
  /** How far the bar had got when it was stopped, in ms of its own ten. */
  const held = useRef(0);

  /**
   * **The bar ends the card, not a timer beside it.**
   *
   * A `setTimeout(TOAST_MS)` was the obvious way and it was wrong: hovering
   * pauses the ANIMATION, and a timeout knows nothing about that — so a card
   * held under the pointer disappeared anyway with its bar frozen at 30%, the
   * gauge saying seven seconds left as the thing went. Two clocks for one fact,
   * and the visible one was the liar.
   *
   * `animationend` is that fact: it fires when the bar is full, which is when
   * the ten seconds have actually been spent, pauses included. The backstop
   * below is only for a browser where the animation never runs at all.
   *
   * **Which is why the pause is driven here and not from a class**, and why the
   * `:hover` rule left `styles.css` to join it. A CSS animation is timed off the
   * document's clock, not off the frames it is drawn in: a hidden tab paints
   * nothing, and the animation it never drew is nonetheless FINISHED when the
   * tab comes back — the bar jumps to full and the card is gone in the frame you
   * arrive on, its ten seconds spent on an empty screen. Stopping it has to be
   * an INSTRUCTION rather than a declaration for a stopped pipeline to notice,
   * which is `pause()` and is not a class: measured, a card raised into a hidden
   * tab sits at `currentTime` 0 for as long as the tab stays hidden. It is also
   * all-or-nothing: the API and `animation-play-state` do not share an animation
   * (touch one with a script and the property stops applying), so the pointer
   * has to come through here too.
   *
   * **And the position is written back by hand on the way in.** Belt to that
   * brace, and cheap: a browser that let its clock run on while the pause was
   * still pending would otherwise hand back a bar that is already full, and
   * setting `currentTime` before playing makes the resumed bar the one that was
   * stopped whatever it did meanwhile.
   */
  useEffect(() => {
    const el = bar.current;
    if (!el?.getAnimations) return;
    for (const animation of el.getAnimations()) {
      if (running) {
        animation.currentTime = held.current;
        animation.play();
      } else {
        animation.pause();
        const at = animation.currentTime;
        held.current = typeof at === 'number' ? at : held.current;
      }
    }
  }, [running]);

  /**
   * Only while something is being spent — a card nobody can see is not holding
   * anything up, and its backstop would be a clock running against a person who
   * is not there. Hovering does NOT stop it: a pointer left on a card for two
   * minutes is not somebody reading it.
   */
  useEffect(() => {
    if (!watching) return;
    const timer = setTimeout(onClose, BACKSTOP_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching]);

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerCancel={() => setHovered(false)}
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
        <div
          ref={bar}
          onAnimationEnd={onClose}
          className={`toast-fill h-full origin-left ${needsYou ? 'bg-amber-400' : 'bg-[var(--accent)]'}`}
        />
      </div>
    </div>
  );
}
