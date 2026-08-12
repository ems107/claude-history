/**
 * Is the user holding a text selection right now?
 *
 * Asked by everything that folds on a click: a drag that ends inside a header
 * must copy that text, not collapse what the user was reading. A click with no
 * drag never sees one — `mousedown` collapses the previous selection before the
 * `click` event fires — so this only ever answers true for the case it is for.
 */
export function hasSelection(): boolean {
  return Boolean(window.getSelection()?.toString());
}
