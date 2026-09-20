import { useEffect, useRef, useState } from 'react';
import { headingOf, offsetsOf, resolveAnchor, snapToWords } from '../../lib/planAnchors.ts';
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
 *
 * The stored form (`PlanCommentRecord`) is this plus its clocks, and the two
 * are assignable on purpose — the panel hands records straight in.
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
/** The one the reader is standing on, as `find-current` is to `find-match`. */
const CURRENT_NAME = 'plan-comment-current';

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

/**
 * What a comment is ABOUT, in words rather than in furniture.
 *
 * A number, a quoted fragment, a chip and a sentence in a box are four
 * unlabelled things: the first draft drew exactly that, and the chip in
 * particular could have been anything — a tag, a file, a status. So the row
 * reads as one sentence instead, and it says its own name first: **`Comment 1 on
 * “…”, under “…”`**. Three things were tried and dropped on the way. The chip,
 * because a chip cannot say "heading". The word "passage" (`on the passage “…”`),
 * because a reader has to stop and translate it — asked about, by the only reader
 * this app has — while the quotation marks already say the words are lifted from
 * somewhere. And the `·` before "under", which is how this app separates chips
 * and reads inside a sentence as two things standing side by side.
 *
 * Same component on both sides of the feature: the composer's list while the
 * comment is being written and the transcript card long after, so a reader who
 * learns it once has learnt it in both places.
 */
export function PlanCommentRef({
  index,
  quote,
  heading,
}: {
  index: number;
  quote: string;
  /** The nearest heading above the passage, when the plan had one. */
  heading: string | null;
}) {
  return (
    // Two lines of quote, not one: a passage cut at 40 characters stops being
    // the thing it is quoting. The cap on what was SENT is `QUOTE_MAX`.
    <div className="line-clamp-2 text-[11px] text-[var(--text-dim)]">
      Comment {index} on <span className="text-[var(--text)] italic">“{quote}”</span>
      {heading && (
        <>
          {/* A comma, not the `·` this app separates chips with: the row is one
              sentence, and a middle dot in it reads as two things side by side. */}
          {', under '}
          <span className="italic">“{heading}”</span>
        </>
      )}
    </div>
  );
}

interface Pending {
  quote: string;
  heading: string;
  start: number;
  end: number;
  /** Offsets from the wrapper's own box, so they hold however the panel scrolls. */
  top: number;
  left: number;
  /**
   * Above the passage rather than below it. The default on touch, because
   * Android parks its selection handles exactly where the button would go.
   */
  above: boolean;
  /** The wrapper's width, so the layer can be clamped inside it. */
  wrap: number;
}

/** Keeps a layer inside the wrapper however near the edge the selection ended. */
function clampLeft(pending: Pending, width: number): number {
  return Math.max(0, Math.min(pending.left, pending.wrap - width));
}

/**
 * The plan, with a passage of it commentable.
 *
 * Select text and a *Comment* button appears; what you write is filed against
 * that passage. There is no gutter and no line numbers: the plan is prose, the
 * reader is pointing at a sentence, and a sentence is what Claude can be told
 * about. Same affordance as the IDE panel — which is a webview doing exactly
 * this over `window.getSelection()`, not the editor's comment API.
 *
 * The passages are painted through the CSS Custom Highlight API, never with
 * `<mark>` nodes: the markdown belongs to React ([AI_VIEWER.md]).
 *
 * `readOnly` is the draft's mode. A plan Claude has not submitted yet lives in
 * a file it keeps rewriting, so a remark filed against it would be a remark
 * pointing at text that has since moved — it is shown, and it is not
 * commentable.
 */
export function PlanReview({
  plan,
  comments,
  onAdd,
  onRemove,
  onEdit,
  readOnly = false,
}: {
  plan: string;
  comments: PlanComment[];
  onAdd: (comment: Omit<PlanComment, 'id'>) => void;
  onRemove: (id: string) => void;
  /** Absent where a comment cannot be changed after the fact. */
  onEdit?: (id: string, text: string) => void;
  readOnly?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  /** Which comment the reader is standing on, painted in the solid colour. */
  const [current, setCurrent] = useState<string | null>(null);
  /** Which comments could not be found in this rendering — listed, not painted. */
  const [unanchored, setUnanchored] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  // Paint every commented passage, and repaint after a remount: going full
  // screen builds these nodes again, and the ranges of the old ones point at
  // nothing. Keyed on the plan too, for the same reason.
  useEffect(() => {
    const root = box.current;
    if (!root || typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    const ranges: Range[] = [];
    const currentRanges: Range[] = [];
    const missing: string[] = [];
    for (const c of comments) {
      const range = resolveAnchor(root, c);
      if (!range) {
        missing.push(c.id);
        continue;
      }
      (c.id === current ? currentRanges : ranges).push(range);
    }
    // Compared as a string rather than by identity: this effect runs on every
    // repaint and a fresh array each time would loop for ever.
    setUnanchored((prev) => (prev.join() === missing.join() ? prev : missing));
    if (ranges.length > 0) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    else CSS.highlights.delete(HIGHLIGHT_NAME);
    if (currentRanges.length > 0) CSS.highlights.set(CURRENT_NAME, new Highlight(...currentRanges));
    else CSS.highlights.delete(CURRENT_NAME);
    return () => {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      CSS.highlights.delete(CURRENT_NAME);
    };
  }, [comments, plan, current]);

  /**
   * A selection that has settled. While something is being written the plan
   * stops listening: a tap meant to put the caret back in the textarea would
   * otherwise throw away the sentence half typed into it.
   */
  const read = (touch: boolean) => {
    if (writing || readOnly) return;
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
    // Above on touch, because Android's selection handles sit directly under
    // the end of the range and would take the tap meant for this button. With
    // a mouse it goes below, as it always has, unless the window has no room.
    const above = touch || window.innerHeight - rect.bottom < 160;
    setPending({
      quote,
      heading: headingOf(range.startContainer),
      start: off?.start ?? -1,
      end: off?.end ?? -1,
      top: above ? rect.top - wrap.top - 4 : rect.bottom - wrap.top + 4,
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
      const root = box.current;
      if (!root || !sel || sel.rangeCount === 0) return;
      if (!root.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      clearTimeout(timer);
      timer = setTimeout(() => read(true), DRAG_SETTLE_MS);
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
    if (!pending || !text) return;
    onAdd({ quote: pending.quote, heading: pending.heading, text, start: pending.start, end: pending.end });
    close();
  };

  return (
    <div className="relative">
      <div
        ref={box}
        onPointerUp={(e) => {
          if (e.pointerType === 'mouse') read(false);
          // A touch settles a frame or two later; the `selectionchange`
          // listener above covers the drag that may follow.
          else setTimeout(() => read(true), TOUCH_SETTLE_MS);
        }}
      >
        <Markdown text={plan} />
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
            placeholder="What should change here?"
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
              <div
                key={c.id}
                onClick={() => setCurrent((prev) => (prev === c.id ? null : c.id))}
                className={`flex items-start gap-2 rounded border px-2 py-1 text-xs ${
                  current === c.id ? 'border-[var(--accent-dim)] bg-[var(--accent)]/5' : 'border-[var(--border)]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <PlanCommentRef index={i + 1} quote={c.quote} heading={c.heading || null} />
                  {editing?.id === c.id ? (
                    <textarea
                      autoFocus
                      rows={2}
                      value={editing.text}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          const text = editing.text.trim();
                          if (text) onEdit?.(c.id, text);
                          setEditing(null);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                      onBlur={() => {
                        const text = editing.text.trim();
                        if (text && text !== c.text) onEdit?.(c.id, text);
                        setEditing(null);
                      }}
                      className="mt-0.5 w-full resize-none rounded border border-[var(--accent-dim)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] outline-none"
                    />
                  ) : (
                    <div className="whitespace-pre-wrap text-[var(--text)]">{c.text}</div>
                  )}
                  {/* Said out loud rather than silently unpainted: the remark is
                      still what somebody wrote, and it still names its passage. */}
                  {unanchored.includes(c.id) && (
                    <div className="mt-0.5 text-[10px] text-amber-400/80">
                      this passage is no longer in the plan — the comment still stands
                    </div>
                  )}
                </div>
                {onEdit && editing?.id !== c.id && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ id: c.id, text: c.text });
                    }}
                    title="Edit this comment"
                    className="min-h-11 shrink-0 rounded px-2 text-[var(--text-dim)] md:min-h-0 md:px-1 md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
                  >
                    ✎
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(c.id);
                  }}
                  title="Remove this comment"
                  className="min-h-11 shrink-0 rounded px-2 text-[var(--text-dim)] md:min-h-0 md:px-1 md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
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
