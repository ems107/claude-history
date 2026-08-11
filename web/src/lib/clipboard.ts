// Clipboard helpers. The app is served from 127.0.0.1, which is a secure
// context, so `navigator.clipboard` is available — no execCommand fallback.

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
  await navigator.clipboard.writeText(text);
}

export async function copyPlain(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
