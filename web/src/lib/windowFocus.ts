import { useSyncExternalStore } from 'react';

/**
 * Is somebody AT this window right now?
 *
 * ## Why this is not the question `lib/tabs.ts` answers
 *
 * That one asks whether any tab of the app is ON SCREEN, and it is deliberately
 * the softer test: a card's ten seconds are ten seconds of somebody looking, and
 * a window you can see but have not clicked into is a window whose cards you are
 * reading. Nothing there is lost by being generous — the worst a wrong answer
 * costs is a countdown that ran while nobody watched.
 *
 * This one decides whether having a session open COUNTS AS HAVING SEEN IT, and a
 * wrong answer there costs the notice itself: the session view withdraws its own
 * row from the bell on the strength of it (`SessionViewPage`), and the
 * announcement is skipped for the session in front of you
 * (`NotificationToasts`). A page left open behind an editor is a page nobody has
 * looked at, so answering "yes, seen" for it throws away the one thing that
 * would have said what happened while you were away — which is precisely the bug
 * this exists to fix.
 *
 * So the test is the strict pair: the tab is the front one of a window that is
 * not minimised (`visibilityState`), AND the desktop is pointing at that window
 * (`hasFocus`). In practice the second half is the whole of it — a background
 * tab and a minimised window both report `hasFocus() === false` — and the first
 * is the belt: Chrome takes a fully covered window to `hidden` on its own, and
 * an AND of the two can only ever err towards KEEPING a row, which is the cheap
 * failure. The dear one is dropping it.
 *
 * The costs of being strict, both of them small and both deliberate: the URL bar
 * and the devtools take the focus off the document, so a row survives a moment
 * longer than it might have — and the next click in the page withdraws it.
 *
 * ## Per window, so per tab, and told to nobody
 *
 * No `BroadcastChannel` here. Focus is not a fact about the person the way
 * "somebody is looking" is — exactly one window can hold it, and the tab that
 * holds it is the only one that has to know. Gossiping it would also mean
 * trusting a peer's last word about its own focus, and a tab that dies without
 * one would go on silencing a session's notices for ever: the very failure
 * `tabs.ts` can afford (a stale "somebody is looking" merely pauses a bar) is
 * unaffordable here.
 */

const listeners = new Set<() => void>();

function read(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * The snapshot `useSyncExternalStore` reads. Kept, not recomputed per render.
 *
 * Read at import time rather than assumed, which is not a nicety here: the store
 * is subscribed to in an effect, so a value invented for the first render is a
 * value the first pass of every effect beside it sees — and the effect that
 * matters is the one that withdraws a bell row. `true` there would withdraw it
 * on a page loading into a window nobody is at, which is the whole bug.
 */
let atWindow = read();

function recompute(): void {
  const next = read();
  if (next === atWindow) return;
  atWindow = next;
  for (const fn of listeners) fn();
}

/**
 * The shape the other stores in here use: a module variable, a set of listeners,
 * and the events hung on the FIRST subscriber. The snapshot is re-read on the way
 * in, because nothing was watching between the last unsubscribe and this one.
 */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    atWindow = read();
    window.addEventListener('focus', recompute);
    window.addEventListener('blur', recompute);
    document.addEventListener('visibilitychange', recompute);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener('focus', recompute);
    window.removeEventListener('blur', recompute);
    document.removeEventListener('visibilitychange', recompute);
  };
}

function getSnapshot(): boolean {
  return atWindow;
}

export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
