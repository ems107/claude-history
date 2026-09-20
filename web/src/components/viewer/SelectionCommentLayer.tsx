import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { snapToWords } from '../../lib/anchors.ts';

/**
 * Select something inside this box and a *Comment* button appears; what you
 * write is handed back with the passage you wrote it about.
 *
 * It was `PlanReview.tsx`, and all of this is that component's, moved: the
 * gesture is the same whether what is under it is a plan's markdown, a file's
 * source or a diff, and Android's behaviour — which is most of what is
 * difficult here — is the same in all three. What stays with each caller is
 * everything that knows what the passage IS: how to turn the range into a
 * record, and how to paint the ones already written.
 *
 * The passages are painted through the CSS Custom Highlight API, never with
 * `<mark>` nodes: the content belongs to React ([AI_VIEWER.md]). See
 * `useCommentHighlights` below, which is that half.
 */

/**
 * How long after a touch the selection is believed.
 *
 * A mouse selection is finished when the button comes up. A touch one is not:
 * Android raises its own handles and settles the range a frame or two later, so
 * reading it on `pointerup` returns the word the long-press landed on rather
 * than what the reader then dragged out.
 */
const TOUCH_SETTLE_MS = 180;
/** How long after the last `selectionchange` the drag counts as over. */
const DRAG_SETTLE_MS = 300;
/** The *Comment* button's touch height (`min-h-11`), for the room it needs. */
const BUTTON_H = 44;
/**
 * How far under the passage the button sits on touch.
 *
 * Android's two selection handles hang below the line, so this cannot be the
 * mouse's 4px — but it was 30 first, and that read as a button floating loose
 * rather than one attached to the words it is about.
 */
const TOUCH_GAP = 12;

/** A selection somebody has written a note about. */
export interface SelectionResult {
  /**
   * The passage, as a live range in the box. Everything a caller needs beyond
   * the quote — offsets, a heading, a line number, which hunk of a diff — is
   * derived from this at save time, because only the caller knows which of
   * those its records are made of.
   */
  range: Range;
  /** The box itself, which is what offsets are measured against. */
  root: HTMLElement;
  /** What the reader selected, trimmed. */
  quote: string;
  /** What they wrote about it, trimmed. */
  text: string;
}

interface Pending {
  range: Range;
  quote: string;
  /** Offsets from the wrapper's own box, so they hold however the panel scrolls. */
  top: number;
  left: number;
  /**
   * Above the passage rather than below it — only where the window has no room
   * underneath, because above is where Android draws its own copy/share bar.
   */
  above: boolean;
  /** The wrapper's width, so the layer can be clamped inside it. */
  wrap: number;
}

/** Keeps a layer inside the wrapper however near the edge the selection ended. */
function clampLeft(pending: Pending, width: number): number {
  return Math.max(0, Math.min(pending.left, pending.wrap - width));
}

export function SelectionCommentLayer({
  boxRef,
  readOnly = false,
  className,
  placeholder = 'What should change here?',
  canComment,
  onAdd,
  children,
}: {
  /**
   * The box the selection is read from — held by the CALLER, because the same
   * node is what its own painting has to measure against.
   */
  boxRef: RefObject<HTMLDivElement | null>;
  /**
   * Content that is about to be rewritten — a plan Claude is still writing. It
   * is shown, and it is not commentable: a remark filed against it would point
   * at a passage that has moved.
   */
  readOnly?: boolean;
  /** Classes for the box itself, where it has to be a particular sort of box. */
  className?: string;
  placeholder?: string;
  /**
   * Whether this passage can be commented on at all — asked BEFORE the button
   * is offered, which is the only place it can be asked without costing
   * somebody their writing.
   *
   * A diff is the caller that needs it: a selection across two hunks is two
   * edits and cannot be quoted as one fragment. Without this the button
   * appeared anyway, the note was typed, and the refusal happened at save —
   * silently, with the draft cleared, which is the one outcome a panel holding
   * somebody's writing may not have.
   */
  canComment?: (range: Range) => boolean;
  onAdd: (selection: SelectionResult) => void;
  children: ReactNode;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  /**
   * What the reader is pointing with, remembered because `selectionchange`
   * does not say.
   *
   * It defaulted to touch there, and with a mouse that showed: `pointerup`
   * placed the button 4px under the selection and the settle pass moved it to
   * the touch gap a fraction of a second later, so it visibly jumped. The two
   * passes have to agree, and only the pointer event knows.
   */
  const touching = useRef(false);

  /**
   * A selection that has settled. While something is being written the box
   * stops listening: a tap meant to put the caret back in the textarea would
   * otherwise throw away the sentence half typed into it.
   */
  const read = (touch: boolean) => {
    if (writing || readOnly) return;
    const root = boxRef.current;
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
    /**
     * Put the grown selection back on screen — **with a mouse only**.
     *
     * What is highlighted should be what gets quoted, and replacing the range
     * is how that is done. On a touch device it is also how the selection gets
     * DESTROYED: Android draws its own handles and its copy/share bar against
     * the range the user made, and swapping that range out from under it
     * dismisses both. Reported from the phone as not being able to select more
     * than one word — the settle pass was pulling the handles away a third of a
     * second after every adjustment, so there was no way to drag them.
     *
     * The snap still happens; it just stops being written back. The quote and
     * the offsets are the grown ones, and what stays on screen is the reader's
     * own selection — which on Android is already word-wise anyway.
     */
    if (!touch) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const quote = range.toString().trim();
    if (!quote || (canComment && !canComment(range))) {
      setPending(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const wrap = root.getBoundingClientRect();
    /**
     * BELOW the passage, on touch as on a mouse — and above only where the
     * window has no room for it.
     *
     * It went above on touch for one draft, reasoning that Android parks its
     * selection handles under the end of the range. The handles are there, but
     * what actually lands on top of a selection is the system's own
     * copy/paste/share bar, which is what this button was hiding behind.
     *
     * The handles are still real, so a touch placement leaves `TOUCH_GAP`
     * rather than the mouse's 4px — enough that they do not take the tap,
     * close enough that the button still reads as belonging to the passage.
     */
    const gap = touch ? TOUCH_GAP : 4;
    // The room it actually needs, not a round number: a 160px threshold sent
    // the button back above the selection with 92px free below it — plenty for
    // a 44px control — which is the very placement this is here to avoid.
    const above = window.innerHeight - rect.bottom < gap + BUTTON_H + 8;
    setPending({
      range,
      quote,
      top: above ? rect.top - wrap.top - gap : rect.bottom - wrap.top + gap,
      left: Math.max(0, rect.left - wrap.left),
      above,
      wrap: wrap.width,
    });
  };

  /**
   * The two ways a selection ends, because they are genuinely different events.
   *
   * `pointerup` is the mouse's, and the touch's first half. The `selectionchange`
   * listener is what catches a reader dragging Android's handles afterwards:
   * that never produces another `pointerup` on this element, so without it the
   * button would stay anchored to the word the long-press happened to land on.
   */
  useEffect(() => {
    if (readOnly) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelectionChange = () => {
      const sel = window.getSelection();
      const root = boxRef.current;
      if (!root || !sel || sel.rangeCount === 0) return;
      if (!root.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      clearTimeout(timer);
      timer = setTimeout(() => read(touching.current), DRAG_SETTLE_MS);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
    // `read` closes over `writing`/`readOnly`, which is exactly what has to be
    // re-read; the listener is cheap to re-attach.
  }, [writing, readOnly]);

  const close = () => {
    setWriting(false);
    setDraft('');
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const save = () => {
    const text = draft.trim();
    const root = boxRef.current;
    if (!pending || !root || !text) return;
    onAdd({ range: pending.range, root, quote: pending.quote, text });
    close();
  };

  return (
    <div className="relative">
      <div
        ref={boxRef}
        className={className}
        onPointerUp={(e) => {
          touching.current = e.pointerType !== 'mouse';
          if (e.pointerType === 'mouse') read(false);
          // A touch settles a frame or two later; the `selectionchange`
          // listener above covers the drag that may follow.
          else setTimeout(() => read(true), TOUCH_SETTLE_MS);
        }}
      >
        {children}
      </div>
      {pending && !writing && (
        <button
          type="button"
          onClick={() => setWriting(true)}
          style={{ top: pending.top, left: clampLeft(pending, 112) }}
          className={`absolute z-10 min-h-11 rounded border border-[var(--accent-dim)] bg-[var(--bg-raised)] px-3 text-[11px] text-[var(--accent)] shadow-lg md:min-h-0 md:py-0.5 md:hover:bg-[var(--bg-hover)] ${
            pending.above ? '-translate-y-full' : ''
          }`}
        >
          ✎ Comment
        </button>
      )}
      {pending && writing && (
        <div
          style={{ top: pending.top, left: clampLeft(pending, 320) }}
          className={`absolute z-10 w-80 max-w-full rounded border border-[var(--accent-dim)] bg-[var(--bg-raised)] p-2 shadow-xl ${
            pending.above ? '-translate-y-full' : ''
          }`}
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
            placeholder={placeholder}
            className="w-full resize-none rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
          />
          <div className="mt-1 flex items-center gap-1.5">
            <span className="hidden text-[10px] text-[var(--text-dim)] md:inline">Enter to add · Esc to cancel</span>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={close}
              className="min-h-11 rounded border border-[var(--border)] px-3 text-[11px] text-[var(--text-dim)] md:min-h-0 md:py-0.5 md:hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!draft.trim()}
              className="min-h-11 rounded border border-[var(--accent-dim)] px-3 text-[11px] text-[var(--accent)] disabled:opacity-40 md:min-h-0 md:py-0.5 md:hover:bg-[var(--bg-hover)]"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Paint every commented passage, and say which ones could not be found.
 *
 * The other half of the reviewer, and it stays a hook rather than moving into
 * the layer because not every caller paints this way: a diff marks whole ROWS,
 * which is the unit a diff has, and needs none of this.
 *
 * `content` is whatever changes when the thing under the ranges is rewritten —
 * the plan's text, the file's. The effect has to run again then: going full
 * screen builds these nodes again, and the ranges of the old ones point at
 * nothing.
 */
export function useCommentHighlights<C extends { id: string }>(
  boxRef: RefObject<HTMLElement | null>,
  {
    comments,
    current,
    content,
    name,
    currentName,
    resolve,
  }: {
    comments: C[];
    /** Which comment the reader is standing on, painted in the solid colour. */
    current: string | null;
    content: unknown;
    /** Registered under its own name so the find bar's marks cannot delete these. */
    name: string;
    /** The one the reader is standing on, as `find-current` is to `find-match`. */
    currentName: string;
    resolve: (root: HTMLElement, comment: C) => Range | null;
  },
): string[] {
  /** Which comments could not be found in this rendering — listed, not painted. */
  const [unanchored, setUnanchored] = useState<string[]>([]);

  useEffect(() => {
    const root = boxRef.current;
    if (!root || typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    const ranges: Range[] = [];
    const currentRanges: Range[] = [];
    const missing: string[] = [];
    for (const c of comments) {
      const range = resolve(root, c);
      if (!range) {
        missing.push(c.id);
        continue;
      }
      (c.id === current ? currentRanges : ranges).push(range);
    }
    // Compared as a string rather than by identity: this effect runs on every
    // repaint and a fresh array each time would loop for ever.
    setUnanchored((prev) => (prev.join() === missing.join() ? prev : missing));
    if (ranges.length > 0) CSS.highlights.set(name, new Highlight(...ranges));
    else CSS.highlights.delete(name);
    if (currentRanges.length > 0) CSS.highlights.set(currentName, new Highlight(...currentRanges));
    else CSS.highlights.delete(currentName);
    return () => {
      CSS.highlights.delete(name);
      CSS.highlights.delete(currentName);
    };
    // `resolve` is a module-level function in both callers, so it is stable;
    // listing it would be honest and change nothing.
  }, [comments, current, content, name, currentName]);

  return unanchored;
}
