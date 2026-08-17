import { useState } from 'react';
import { copyPlain } from '../../lib/clipboard.ts';

const FLASH_MS = 1500;

/**
 * Copy one piece of text, for the rows of the cross-session pages — a prompt, a
 * starred message. The bubbles in the viewer have their own pair of buttons
 * (`MessageActions`), because there a formatted copy can be read back out of the
 * DOM node already on screen; here there is only the source text.
 */
export function CopyTextButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void copyPlain(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), FLASH_MS);
        });
      }}
      className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
      title={title}
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}
