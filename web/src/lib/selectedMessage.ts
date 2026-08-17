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

import { useSyncExternalStore } from 'react';

/** `msg:<uuid>` or `tool:<toolUseId>` — the key `boxKeyOf` reads off an element. */
let selected: string | null = null;
const listeners = new Set<() => void>();

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
  const el = selected.startsWith('tool:')
    ? document.querySelector<HTMLElement>(`[data-tool-id="${CSS.escape(selected.slice(5))}"]`)
    : document.getElementById(selected.slice(4));
  el?.setAttribute('data-selected', '');
}

/** Null deselects — which is what a click on the empty space beside a message is. */
export function selectMessage(key: string | null): void {
  if (key === selected) return;
  selected = key;
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
