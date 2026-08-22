import { useSyncExternalStore } from 'react';

/**
 * Is ANYBODY looking at this app right now — this tab, or another one of ours in
 * the same browser?
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
 */

/** One channel for the whole origin. */
const CHANNEL = 'claude-history:tabs';

type TabMessage =
  | { type: 'hello'; id: string }
  | { type: 'state'; id: string; visible: boolean }
  | { type: 'gone'; id: string };

/**
 * Who we are, and only so that peers can be told apart in a set.
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
const listeners = new Set<() => void>();
/** The snapshot `useSyncExternalStore` reads. Kept, not recomputed per render. */
let anyVisible = true;

function visibleHere(): boolean {
  return document.visibilityState === 'visible';
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
