import { useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown.tsx';

/**
 * One remark about one passage of a plan.
 *
 * `quote` is what the reader selected, and it is the ANCHOR — the same choice
 * Claude Code's own IDE panel makes (`[Re: "<selected text>"] <comment>`), and
 * for the same reason: a line number means nothing to a model reading markdown,
 * and the plan it is holding is the text, not a file with a gutter.
 *
 * `start`/`end` are that passage's offsets in the RENDERED text, and they exist
 * only to paint it. They are kept beside the quote rather than derived from it
 * because a selection crossing two blocks reads back with newlines the rendered
 * text does not have, so the two can never be recovered from one another —
 * `quote` is what a human and a model read, the offsets are what the browser
 * paints. `-1` is a selection whose ends were not both in text nodes: the
 * comment still stands, it just goes unpainted.
 */
export interface PlanComment {
  id: string;
  quote: string;
  /** The nearest heading above the passage — what tells two similar quotes apart. */
  heading: string;
  text: string;
  start: number;
  end: number;
}

/** Registered under its own name so the find bar's marks cannot delete these. */
const HIGHLIGHT_NAME = 'plan-comment';

/** How much of a quote is repeated back to Claude before it is cut. */
const QUOTE_MAX = 240;

/**
 * The comments as the sentence Claude is given, in Claude Code's own shape.
 *
 * It goes out as the *keep planning* message — the one channel that is certainly
 * read, since it lands in the transcript as `userFeedback` and the plan card
 * then prints it under "the user said" ([AI_RUNNING_CLAUDE.md]).
 */
export function commentsFeedback(comments: PlanComment[]): string {
  if (comments.length === 0) return '';
  const lines = comments.map((c) => {
    const quote = c.quote.length > QUOTE_MAX ? `${c.quote.slice(0, QUOTE_MAX)}…` : c.quote;
    const where = c.heading ? ` · under "${c.heading}"` : '';
    return `[Re: "${quote}"${where}] ${c.text}`;
  });
  return `Comments on the plan:\n${lines.join('\n')}`;
}

/**
 * The selection grown out to whole words.
 *
 * A drag ends where the mouse came up, so a real reader's selection routinely
 * starts and finishes mid-word — `d porque, según CLAUDE.md d` was a live one.
 * As a quote that is both ugly to read and a worse anchor: it is the text Claude
 * is asked to find in its own plan. Only the two ends are touched, and only
 * while both sides of them are word characters, so a selection that already
 * lands on a boundary is left exactly where it was.
 */
function snapToWords(range: Range): Range {
  const word = /[\p{L}\p{N}_]/u;
  const snapped = range.cloneRange();
  const { startContainer, endContainer } = snapped;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const data = (startContainer as Text).data;
    let at = snapped.startOffset;
    while (at > 0 && word.test(data[at - 1] ?? '') && word.test(data[at] ?? '')) at--;
    snapped.setStart(startContainer, at);
  }
  if (endContainer.nodeType === Node.TEXT_NODE) {
    const data = (endContainer as Text).data;
    let at = snapped.endOffset;
    while (at < data.length && word.test(data[at] ?? '') && word.test(data[at - 1] ?? '')) at++;
    snapped.setEnd(endContainer, at);
  }
  return snapped;
}

/** Every text node under `root`, in document order — the string the offsets index. */
function textNodesIn(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** Where a selection falls in that string, or null if either end is not text. */
function offsetsOf(root: HTMLElement, range: Range): { start: number; end: number } | null {
  let pos = 0;
  let start = -1;
  let end = -1;
  for (const node of textNodesIn(root)) {
    if (node === range.startContainer) start = pos + range.startOffset;
    if (node === range.endContainer) end = pos + range.endOffset;
    pos += node.data.length;
  }
  return start >= 0 && end > start ? { start, end } : null;
}

/**
 * The inverse, and the reason the offsets are stored at all: the panel is
 * rendered twice — in the strip and, full screen, in a portal — and the second
 * one is a fresh set of nodes. A `Range` cannot survive that; two numbers can.
 */
function rangeOf(root: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  let pos = 0;
  let opened = false;
  for (const node of textNodesIn(root)) {
    const len = node.data.length;
    if (!opened && start <= pos + len) {
      range.setStart(node, Math.max(0, start - pos));
      opened = true;
    }
    if (opened && end <= pos + len) {
      range.setEnd(node, Math.max(0, end - pos));
      return range;
    }
    pos += len;
  }
  return null;
}

/**
 * The heading a passage sits under: the nearest `h1`-`h6` before it, walking
 * back through siblings and then up. The same walk Claude Code's IDE panel does,
 * and a selection inside a heading answers with itself.
 */
function headingOf(node: Node): string {
  const from = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const own = from?.closest('h1, h2, h3, h4, h5, h6');
  if (own) return own.textContent?.trim() ?? '';
  for (let current = from; current; current = current.parentElement) {
    for (let sib = current.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (/^H[1-6]$/.test(sib.tagName)) return sib.textContent?.trim() ?? '';
    }
  }
  return '';
}

interface Pending {
  quote: string;
  heading: string;
  start: number;
  end: number;
  /** Offsets from the wrapper's own box, so they hold however the panel scrolls. */
  top: number;
  left: number;
}

/**
 * The plan, with a passage of it commentable.
 *
 * Select text and a *Comment* button appears under it; what you write is filed
 * against that passage. There is no gutter and no line numbers: the plan is
 * prose, the reader is pointing at a sentence, and a sentence is what Claude can
 * be told about. Same affordance as the IDE panel — which is a webview doing
 * exactly this over `window.getSelection()`, not the editor's comment API.
 *
 * The passages are painted through the CSS Custom Highlight API, never with
 * `<mark>` nodes: the markdown belongs to React ([AI_VIEWER.md]).
 */
export function PlanReview({
  plan,
  comments,
  onAdd,
  onRemove,
}: {
  plan: string;
  comments: PlanComment[];
  onAdd: (comment: Omit<PlanComment, 'id'>) => void;
  onRemove: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');

  // Paint every commented passage, and repaint after a remount: going full
  // screen builds these nodes again, and the ranges of the old ones point at
  // nothing. Keyed on the plan too, for the same reason.
  useEffect(() => {
    const root = box.current;
    if (!root || typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    const ranges = comments
      .filter((c) => c.start >= 0)
      .map((c) => rangeOf(root, c.start, c.end))
      .filter((r): r is Range => r !== null);
    if (ranges.length === 0) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      return;
    }
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    return () => {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    };
  }, [comments, plan]);

  /**
   * A selection made and let go of. While something is being written the plan
   * stops listening: a click meant to put the caret back in the textarea would
   * otherwise throw away the sentence half typed into it.
   */
  const onMouseUp = () => {
    if (writing) return;
    const root = box.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPending(null);
      return;
    }
    const range = snapToWords(sel.getRangeAt(0));
    if (!root.contains(range.commonAncestorContainer)) {
      setPending(null);
      return;
    }
    // Put the grown selection back on screen: what is highlighted has to be
    // what gets quoted, or the button appears to comment on something else.
    sel.removeAllRanges();
    sel.addRange(range);
    const quote = range.toString().trim();
    if (!quote) {
      setPending(null);
      return;
    }
    const off = offsetsOf(root, range);
    const rect = range.getBoundingClientRect();
    const wrap = root.getBoundingClientRect();
    setPending({
      quote,
      heading: headingOf(range.startContainer),
      start: off?.start ?? -1,
      end: off?.end ?? -1,
      top: rect.bottom - wrap.top + 4,
      left: Math.max(0, rect.left - wrap.left),
    });
  };

  const close = () => {
    setWriting(false);
    setDraft('');
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const save = () => {
    const text = draft.trim();
    if (!pending || !text) return;
    onAdd({ quote: pending.quote, heading: pending.heading, text, start: pending.start, end: pending.end });
    close();
  };

  return (
    <div className="relative">
      <div ref={box} onMouseUp={onMouseUp}>
        <Markdown text={plan} />
      </div>
      {pending && !writing && (
        <button
          type="button"
          onClick={() => setWriting(true)}
          style={{ top: pending.top, left: pending.left }}
          className="absolute z-10 rounded border border-[var(--accent-dim)] bg-[var(--bg-raised)] px-2 py-0.5 text-[11px] text-[var(--accent)] shadow-lg hover:bg-[var(--bg-hover)]"
        >
          ✎ Comment
        </button>
      )}
      {pending && writing && (
        <div
          style={{ top: pending.top, left: pending.left }}
          className="absolute z-10 w-80 max-w-full rounded border border-[var(--accent-dim)] bg-[var(--bg-raised)] p-2 shadow-xl"
        >
          <div className="mb-1 line-clamp-2 border-l-2 border-[var(--accent-dim)] pl-2 text-[11px] text-[var(--text-dim)] italic">
            {pending.quote.length > 120 ? `${pending.quote.slice(0, 120)}…` : pending.quote}
          </div>
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter files it, Shift+Enter is a newline — the composer's own
              // rule, and the IDE panel's. Escape must stop here: the page's
              // handler ends in `navigate(-1)`.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                save();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
            placeholder="What should change here?"
            className="w-full resize-none rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
          />
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--text-dim)]">Enter to add · Esc to cancel</span>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={close}
              className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!draft.trim()}
              className="rounded border border-[var(--accent-dim)] px-2 py-0.5 text-[11px] text-[var(--accent)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
      {/* The list is inside the plan rather than under the buttons so a comment
          sits near what it is about; the strip above the footer says how many
          there are while the decision is being taken. */}
      {comments.length > 0 && (
        <div className="mt-3 border-t border-[var(--border)] pt-2">
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
            {comments.length} comment{comments.length === 1 ? '' : 's'} on this plan
          </div>
          <div className="space-y-1">
            {comments.map((c, i) => (
              <div key={c.id} className="flex items-start gap-2 rounded border border-[var(--border)] px-2 py-1 text-xs">
                <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-[var(--text-dim)] italic">
                    “{c.quote}”{c.heading && <span className="not-italic"> · under {c.heading}</span>}
                  </div>
                  <div className="whitespace-pre-wrap text-[var(--text)]">{c.text}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(c.id)}
                  title="Remove this comment"
                  className="shrink-0 rounded px-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
