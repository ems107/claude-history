// The message a reader has clicked.
//
// It is its own thing, not the find bar's: clicking a message marks it whether
// or not anything is searching, a deep link leaves the message it landed on
// marked, and the bar merely READS it to decide what "this message" means.
//
// It lives outside React on purpose. The mark changes on every click, and the
// only thing that has to know is the find bar — a few controls — while the
// thing that must NOT re-render is the conversation, which is three hundred
// bubbles and a thousand tool blocks. So the value is a module variable, the
// ring is a DOM attribute put on directly, and React hears about it only where
// it is subscribed to. The same shape the search marks have, for the same
// reason: the state decides and the DOM applies.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { anchorOfKey } from './highlight.ts';

/** `msg:<uuid>` or `tool:<toolUseId>` — the key `boxKeyOf` reads off an element. */
let selected: string | null = null;
const listeners = new Set<() => void>();

/**
 * Where the ring is remembered, one slot per conversation, so F5 comes back to
 * the message that was being read instead of to the top of the session.
 *
 * In `sessionStorage` and NOT in the URL, which is the other obvious place. The
 * ring moves on every click, and writing it into `?msg=` would make every click
 * a deep link — a flash, a scroll and, in a live session, a fight with the
 * follow — while giving one parameter two provenances: "the message a link asked
 * for" and "the message somebody happens to be pointing at". It is the shape the
 * session list already uses for its filters and its scroll
 * (`lib/listState.ts`): a tab remembers where it was, and F5 is that tab asking
 * for it back. A new tab, like a new visit, starts with nothing selected.
 */
const STORE_PREFIX = 'ch:selected:';
/** Which conversation the slot belongs to. Nothing is stored until a page says. */
let scope: string | null = null;

function remember(): void {
  if (scope === null) return;
  if (selected) sessionStorage.setItem(STORE_PREFIX + scope, selected);
  else sessionStorage.removeItem(STORE_PREFIX + scope);
}

export function getSelectedMessage(): string | null {
  return selected;
}

/**
 * Puts `data-selected` where it belongs and nowhere else.
 *
 * Called on every change, and again after every render of the conversation —
 * React owns those nodes and drops the attribute whenever it rebuilds one.
 */
export function applySelection(): void {
  for (const el of document.querySelectorAll('[data-selected]')) el.removeAttribute('data-selected');
  if (!selected) return;
  const { uuid, toolUseId } = anchorOfKey(selected);
  const el = toolUseId
    ? document.querySelector<HTMLElement>(`[data-tool-id="${CSS.escape(toolUseId)}"]`)
    : uuid
      ? document.getElementById(uuid)
      : null;
  el?.setAttribute('data-selected', '');
}

/** Null deselects — which is what a click on the empty space beside a message is. */
export function selectMessage(key: string | null): void {
  if (key === selected) return;
  selected = key;
  remember();
  applySelection();
  for (const fn of listeners) fn();
}

export function subscribeSelected(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For the handful of controls that really do have to redraw when it changes. */
export function useSelectedMessage(): string | null {
  return useSyncExternalStore(subscribeSelected, getSelectedMessage, getSelectedMessage);
}

/**
 * Adopts the selection this tab was left on, and hands the key back so the
 * viewer can be sent to it: a ring thirty screens above the fold is not the
 * message being kept, and the folds are rebuilt from scratch by a reload, so a
 * remembered scroll offset would land somewhere else entirely. The message is
 * the only durable address the conversation has.
 *
 * Null means there is nothing to restore — nobody was selected in this
 * conversation, or the URL already asks to stand somewhere, which outranks a
 * remembered ring and leaves one of its own on arrival.
 *
 * The slot is read ONCE per conversation, into a ref: every click writes to it,
 * so a second read on a later render would hand the page a fresh anchor and turn
 * an ordinary click into a jump.
 */
export function useRestoredSelection(sessionId: string, anchored: boolean): string | null {
  const stored = useRef<{ session: string | null; key: string | null }>({ session: null, key: null });
  if (stored.current.session !== sessionId) {
    stored.current = { session: sessionId, key: sessionStorage.getItem(STORE_PREFIX + sessionId) };
  }
  const restored = anchored ? null : stored.current.key;
  useEffect(() => {
    // The scope first: from here on a click in this conversation is remembered
    // under its id, and the previous one's slot is left exactly as it was.
    scope = sessionId;
    selectMessage(restored);
    // `restored` is read as the conversation opens and is deliberately not a
    // dependency: following a link later brings a selection of its own, and
    // re-running this would clear the ring that link had just left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  return restored;
}
