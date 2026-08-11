import type { ContentBlock, MessageItem } from '@claude-history/shared';
import { type RefObject, useState } from 'react';
import { copyPlain, copyRich } from '../../lib/clipboard.ts';
import { blocksMarkdown, type ExportOptions } from '../../lib/exportMarkdown.ts';

/**
 * What a copy takes: the bubble's own content. Tool runs live outside it (and
 * would drop megabytes of JSON on the clipboard), the images are already
 * megabytes of base64, and the system rows are not part of any message.
 * Thinking rides along because the caller only passes the blocks it actually
 * rendered — if it is on screen it gets copied.
 */
const COPY_OPTS: ExportOptions = {
  includeTools: false,
  includeThinking: true,
  includeSystem: false,
  includeImages: false,
};

const FLASH_MS = 1500;

/**
 * The two copy buttons on a message, revealed on hover like the rename/pin
 * buttons in the session header.
 *
 * "Copy" reads the HTML back out of the DOM node that is already on screen,
 * rather than re-rendering the markdown through a second pipeline: what lands
 * in Word is then exactly what the viewer shows, and there is no second
 * renderer to drift from the first.
 */
export function MessageActions({
  item,
  blocks,
  body,
}: {
  item: MessageItem;
  /** The blocks the bubble rendered — not necessarily all of the item's. */
  blocks: readonly ContentBlock[];
  /** The bubble's content node, for the formatted copy. */
  body: RefObject<HTMLDivElement | null>;
}) {
  const [done, setDone] = useState<'rich' | 'md' | null>(null);
  const flash = (which: 'rich' | 'md') => {
    setDone(which);
    setTimeout(() => setDone(null), FLASH_MS);
  };

  const cls =
    'shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-normal tracking-normal text-[var(--text-dim)] normal-case hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

  return (
    // `hidden`, not `opacity-0`: invisible buttons still take their width, and
    // here that left a permanent gap in the header. They live in the empty
    // middle of the row, BEFORE the auto margin, so appearing eats slack from
    // the spacer instead of shoving the model/cost/context pills sideways
    // exactly when the pointer is heading for them.
    //
    // The click never belongs to whatever is underneath: a folded bubble
    // unfolds its turn.
    <span
      className="hidden items-center gap-0.5 group-hover/bubble:flex"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={cls}
        title="Copy this message with its formatting (paste into Word, Outlook, Jira…)"
        onClick={() => {
          const node = body.current;
          if (!node) return;
          void copyRich(node.innerHTML, node.innerText).then(() => flash('rich'));
        }}
      >
        {done === 'rich' ? 'Copied ✓' : '⧉ Copy'}
      </button>
      <button
        type="button"
        className={cls}
        title="Copy this message as Markdown source"
        onClick={() => void copyPlain(blocksMarkdown(item, blocks, COPY_OPTS)).then(() => flash('md'))}
      >
        {done === 'md' ? 'Copied ✓' : '⧉ MD'}
      </button>
    </span>
  );
}
