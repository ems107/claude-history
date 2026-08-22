import { useSyncExternalStore } from 'react';

/**
 * What the tabs of this app tell each other, which is two things.
 *
 * ## Is ANYBODY looking right now — this tab, or another one of ours?
 *
 * Written for the toast cards, whose ten seconds must not be spent while nobody
 * is there to read them ([NotificationToasts]). `document.visibilityState` alone
 * answers the wrong question for that: with three tabs of the app open and one
 * of them on screen, the other two are hidden and their cards are being
 * announced all the same — the person has SEEN the stop, and finding it again
 * twice over on the next two tab switches is the same announcement three times.
 * A stop is announced once to a person, not once per tab.
 *
 * So the answer is the OR of every tab's own visibility, and the tabs tell each
 * other over a `BroadcastChannel` — same origin, which is also what keeps the
 * dev instance on 7434 and the release on 7433 from ever hearing one another
 * (`CLAUDE.md`, the two instances). Only transitions are sent: a tab announces
 * itself when it opens, when its visibility flips and when it goes. **No
 * heartbeat**, so a tab that dies without a word (a crash, never a close — the
 * lifecycle fires `hidden` before `pagehide`) leaves the others believing
 * somebody is still looking, which is exactly the behaviour this file replaces
 * and not a new failure. A heartbeat everywhere, for ever, to be right about a
 * browser that crashed is not a trade worth making.
 *
 * **Visible, not focused.** A window you can see but have not clicked into is a
 * window whose cards you are reading, so `visibilityState` is the right test and
 * `document.hasFocus()` would be a stricter one that pauses the countdown of a
 * card in plain sight. It is also the test `UsageWidget` already uses.
 *
 * ## And which ONE tab rings
 *
 * The same sentence, applied to the thing that cannot be taken twice. A card in
 * every tab is a card; a tone in every tab is a flam — three near-simultaneous
 * copies of one ding, which sounds like a fault rather than like a notification.
 * So exactly one tab plays it, and the others stay quiet.
 *
 * **A claim with a deterministic tiebreak, not an elected leader.** Every tab
 * that sees the stop publishes a `ring` for its key and, a fraction of a second
 * later, rings only if its own id is the LOWEST of the claims it heard, its own
 * included. Nothing is shared, nothing is negotiated and there is no race to
 * lose: every tab is looking at the same set and every tab picks the same
 * minimum. The ids begin with a base-36 timestamp, so the winner is reliably the
 * oldest tab — which is a nicety rather than the point.
 *
 * **The Web Locks API would be the obvious tool and is unusable here**, for the
 * same reason `crypto.randomUUID()` is below: secure contexts only, and a release
 * reached from another machine is plain `http://` on purpose.
 */

/** One channel for the whole origin. */
const CHANNEL = 'claude-history:tabs';

type TabMessage =
  | { type: 'hello'; id: string }
  | { type: 'state'; id: string; visible: boolean }
  | { type: 'gone'; id: string }
  | { type: 'ring'; id: string; key: string };

/**
 * How long a tab waits to hear who else saw the same stop.
 *
 * It is a delay on the TONE and on nothing else — the card is already up — so it
 * is set generously rather than tightly: two tabs learn of a stop through two
 * separate refetches of `['notifications']`, and a spread of a tenth of a second
 * between them is ordinary. Too short and both tabs decide they were alone.
 */
const CLAIM_MS = 250;

/**
 * Who we are: enough to tell peers apart in a set, and — since the ring claim
 * breaks its tie on the lowest one — enough to order them against each other.
 *
 * **Not `crypto.randomUUID()`**: that is exposed to secure contexts only, and a
 * release reached from another machine is plain `http://` on purpose
 * ([AI_REMOTE_ACCESS.md](../../../docs/AI_REMOTE_ACCESS.md)) — the id would be a
 * `TypeError` on precisely the setup this app supports. `BroadcastChannel`
 * itself has no such gate, which is why the rest of this works there.
 */
const selfId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | null = null;
/** The peers that last said they were on screen. Never contains `selfId`. */
const visiblePeers = new Set<string>();
/**
 * Every claim heard for an announcement, whether or not this tab has claimed it
 * yet — the order the two arrive in must not decide who rings.
 *
 * Entries delete themselves after four windows: a key is one stop, and there is
 * no reason to remember one for longer than it takes every tab to have spoken.
 * That is also what stops this map from growing with every stop of the day.
 */
const claims = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
/** The snapshot `useSyncExternalStore` reads. Kept, not recomputed per render. */
let anyVisible = true;

function visibleHere(): boolean {
  return document.visibilityState === 'visible';
}

function noteClaim(key: string, id: string): void {
  const heard = claims.get(key);
  if (heard) {
    heard.add(id);
    return;
  }
  claims.set(key, new Set([id]));
  window.setTimeout(() => claims.delete(key), CLAIM_MS * 4);
}

function recompute(): void {
  const next = visibleHere() || visiblePeers.size > 0;
  if (next === anyVisible) return;
  anyVisible = next;
  for (const fn of listeners) fn();
}

function post(message: TabMessage): void {
  channel?.postMessage(message);
}

/** A channel never echoes to its own sender, so nothing here can be us. */
function onMessage(e: MessageEvent<TabMessage>): void {
  const m = e.data;
  if (!m || typeof m.id !== 'string' || m.id === selfId) return;
  switch (m.type) {
    case 'hello':
      // A tab that just opened knows nothing about anyone, so everyone answers
      // it. Its own state arrives right behind its hello.
      post({ type: 'state', id: selfId, visible: visibleHere() });
      return;
    case 'state':
      if (m.visible) visiblePeers.add(m.id);
      else visiblePeers.delete(m.id);
      break;
    case 'gone':
      visiblePeers.delete(m.id);
      break;
    case 'ring':
      // Nothing about who is looking has changed, so this one does not recompute.
      if (typeof m.key === 'string') noteClaim(m.key, m.id);
      return;
    default:
      return;
  }
  recompute();
}

function onVisibilityChange(): void {
  post({ type: 'state', id: selfId, visible: visibleHere() });
  recompute();
}

/**
 * The tab is going. `visibilitychange` to hidden already fires before this on a
 * real close, so this is the belt to that pair of braces — and the one thing
 * that covers a window closing straight out of the visible state.
 */
function onPageHide(): void {
  post({ type: 'gone', id: selfId });
}

function start(): void {
  visiblePeers.clear();
  claims.clear();
  anyVisible = visibleHere();
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  if (typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener('message', onMessage);
  post({ type: 'hello', id: selfId });
  post({ type: 'state', id: selfId, visible: visibleHere() });
}

function stop(): void {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('pagehide', onPageHide);
  post({ type: 'gone', id: selfId });
  channel?.close();
  channel = null;
  visiblePeers.clear();
  claims.clear();
}

/**
 * The shape `terminalPrefs.ts` and `selectedMessage.ts` use: a module variable,
 * a set of listeners, and the listeners hung on the FIRST subscriber. The
 * snapshot is re-read on the way in, because everything learned before the last
 * unsubscribe was thrown away with the channel.
 */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getAnyTabVisible(): boolean {
  return anyVisible;
}

export function useAnyTabVisible(): boolean {
  return useSyncExternalStore(subscribe, getAnyTabVisible, getAnyTabVisible);
}

/**
 * Is it THIS tab's turn to make the noise for this stop?
 *
 * The key must be the one thing that makes a stop that stop — `sessionId:at`,
 * the same one the cards are keyed on — so that a later stop of the same session
 * is a separate claim and a re-listed one is not.
 *
 * With no channel (no `BroadcastChannel`, or nobody subscribed to the store yet)
 * the answer is yes: a tab that cannot hear anybody is a tab that is alone, and
 * the failure worth avoiding is silence, not a doubled ding.
 */
export function claimAnnouncement(key: string): Promise<boolean> {
  if (!channel) return Promise.resolve(true);
  noteClaim(key, selfId);
  post({ type: 'ring', id: selfId, key });
  return new Promise((resolve) => {
    window.setTimeout(() => {
      let lowest = selfId;
      for (const id of claims.get(key) ?? []) if (id < lowest) lowest = id;
      resolve(lowest === selfId);
    }, CLAIM_MS);
  });
}
