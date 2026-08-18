// Clipboard helpers.
//
// `navigator.clipboard` is `[SecureContext]`, and a secure context is HTTPS or
// localhost — nothing else. Served over plain HTTP from a LAN address (which is
// what remote access is), the object does not merely refuse: it is `undefined`,
// so every copy button throws a TypeError. Hence the `execCommand` fallback
// below, which is deprecated but not secure-context gated and works in every
// current browser. Nothing here READS the clipboard; that half of the API is
// what got the whole namespace put behind secure contexts in the first place,
// and we have never needed it.

/**
 * Put HTML and plain text on the clipboard through the `copy` event.
 *
 * `execCommand('copy')` copies the current SELECTION, so there has to be one:
 * a throwaway node is selected, the event handler replaces what it would have
 * copied with the two flavours we actually want, and the node goes away again.
 * Returns false when the browser refuses, so the caller can report a failure
 * rather than claim a success.
 */
function copyViaExecCommand(html: string | null, text: string): boolean {
  const holder = document.createElement('div');
  // Off-screen rather than `display: none`: a node that is not rendered cannot
  // be selected, and an unselectable node copies nothing.
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  holder.textContent = text;
  document.body.appendChild(holder);

  const selection = window.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/plain', text);
    if (html) e.clipboardData.setData('text/html', html);
    e.preventDefault();
  };
  document.addEventListener('copy', onCopy, true);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    holder.remove();
    // Put the user's own selection back: copying a message must not clear the
    // text they had highlighted to find it.
    selection?.removeAllRanges();
    if (previous) selection?.addRange(previous);
  }
  return ok;
}

/**
 * Copy with formatting: HTML for anything that takes it (Word, Outlook,
 * Confluence, Jira), plain text for everything else. Both flavours go in the
 * same clipboard item, so the destination picks.
 *
 * Firefox only grew `ClipboardItem` support for text/html in 127 and rejects
 * the write outright below that — hence the fallback rather than a feature
 * check alone.
 */
export async function copyRich(html: string, text: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // fall through to the plain-text write
    }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Plain HTTP: no async clipboard at all. The formatting survives here too —
  // the `copy` event carries both flavours just as ClipboardItem does.
  if (!copyViaExecCommand(html, text)) throw new Error('The browser refused the copy.');
}

export async function copyPlain(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (!copyViaExecCommand(null, text)) throw new Error('The browser refused the copy.');
}
