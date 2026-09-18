/**
 * Is the user holding a text selection right now?
 *
 * Asked by everything that folds on a click: a drag that ends inside a header
 * must copy that text, not collapse what the user was reading. A click with no
 * drag never sees one — `mousedown` collapses the previous selection before the
 * `click` event fires — so this only ever answers true for the case it is for.
 */
export function hasSelection(): boolean {
  return Boolean(selectionText());
}

/**
 * The highlighted text itself, for the callers that have to tell one selection
 * from another rather than merely notice that there is one.
 *
 * The terminal panel is the case: a press that leaves the SAME words
 * highlighted did not select anything, it just happened while something was
 * ([SessionTerminal]).
 */
export function selectionText(): string {
  return window.getSelection()?.toString() ?? '';
}
