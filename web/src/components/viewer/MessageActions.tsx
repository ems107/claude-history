import type { ContentBlock, MessageItem } from '@claude-history/shared';
import { type ReactNode, type RefObject, useState } from 'react';
import { copyPlain, copyRich } from '../../lib/clipboard.ts';
import { blocksMarkdown, type ExportOptions } from '../../lib/exportMarkdown.ts';
import { useStars } from './StarContext.ts';

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
 * The star and the two copy buttons on a message, revealed on hover like the
 * rename/pin buttons in the session header.
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
  return (
    <CopyActions markdown={() => blocksMarkdown(item, blocks, COPY_OPTS)} body={body}>
      <StarButton item={item} />
    </CopyActions>
  );
}

/**
 * The star, which is the one button here that stays visible with the pointer
 * elsewhere: a starred message has to say so while you are scrolling past it.
 *
 * Nothing is drawn to the bubble itself. Recolouring its outline means
 * recolouring `[data-bubble-tail]` too — a separate element with its own opaque
 * fill and its own keyframes — and `match-flash` already animates that same
 * border for 2.5 s, so the two would fight over a deep link's arrival.
 *
 * Absent context means there is nothing to star against (the subagent drawer,
 * whose uuids belong to another transcript), and then there is no button.
 */
function StarButton({ item }: { item: MessageItem }) {
  const stars = useStars();
  if (!stars) return null;
  const starred = stars.isStarred(item);
  const busy = stars.busy === item.uuid;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => stars.toggle(item)}
      // `hidden` rather than `opacity-0` (which is what the session header's pin
      // uses): an invisible button still takes its width, and here that left a
      // permanent gap in the header row.
      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-normal tracking-normal normal-case ${
        busy ? 'cursor-default opacity-60' : 'cursor-pointer'
      } ${
        starred
          ? 'text-amber-400 hover:bg-[var(--bg-hover)] hover:text-amber-300'
          : 'hidden text-[var(--text-dim)] group-hover/bubble:inline-block hover:bg-[var(--bg-hover)] hover:text-amber-400'
      }`}
      title={starred ? 'Remove from Starred' : 'Star this message (kept locally, with a copy of its text)'}
      aria-pressed={starred}
    >
      {starred ? '★' : '☆'}
    </button>
  );
}

/**
 * The buttons themselves, for anything with a body worth copying — a bubble, or
 * the summary a compaction wrote. `markdown` is a thunk so nothing builds a
 * 17,000-character string on every render of a panel nobody clicked.
 */
export function CopyActions({
  markdown,
  body,
  children,
}: {
  /** The source form, for the Markdown button. */
  markdown: () => string;
  /** The rendered node, whose HTML the formatted copy takes. */
  body: RefObject<HTMLDivElement | null>;
  /** Anything that belongs in the same toolbar — the star, drawn after the buttons. */
  children?: ReactNode;
}) {
  const [done, setDone] = useState<'rich' | 'md' | null>(null);
  const flash = (which: 'rich' | 'md') => {
    setDone(which);
    setTimeout(() => setDone(null), FLASH_MS);
  };

  // `hidden`, not `opacity-0`: invisible buttons still take their width, and
  // here that left a permanent gap in the header. It sits on each button rather
  // than on the row, because the star stays visible once it is set.
  const cls =
    'hidden shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-normal tracking-normal text-[var(--text-dim)] normal-case group-hover/bubble:inline-block hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

  return (
    // The row sits right before the model/cost/context run, after a `flex-1`
    // spacer that absorbs its width, so a button appearing shrinks the spacer
    // instead of shoving those pills sideways exactly when the pointer is
    // heading for them.
    //
    // `-my-0.5` cancels the buttons' own vertical padding from the row's
    // height: the assistant's pills are bare text (the `inline` HoverCard
    // variant), so without it the header grew by 4 px on hover and nudged the
    // answer down. The buttons still paint their full padding, 2 px over the
    // row on each side.
    //
    // The click never belongs to whatever is underneath: a folded bubble
    // unfolds its turn.
    <span className="-my-0.5 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
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
        onClick={() => void copyPlain(markdown()).then(() => flash('md'))}
      >
        {done === 'md' ? 'Copied ✓' : '⧉ Copy as Markdown'}
      </button>
      {/* Last in the row, so a set star sits right against the model and the
          pills — the part of the header that is always there. Put first, it
          floated alone in the middle of the row whenever the copy buttons were
          hidden. */}
      {children}
    </span>
  );
}
