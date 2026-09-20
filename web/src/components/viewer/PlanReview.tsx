import { useRef, useState } from 'react';
import { headingOf, offsetsOf, resolveAnchor } from '../../lib/planAnchors.ts';
import { Markdown } from './Markdown.tsx';
import { SelectionCommentLayer, useCommentHighlights } from './SelectionCommentLayer.tsx';

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

/**
 * The plan, with a passage of it commentable.
 *
 * Select text and a *Comment* button appears; what you write is filed against
 * that passage. There is no gutter and no line numbers: the plan is prose, the
 * reader is pointing at a sentence, and a sentence is what Claude can be told
 * about. Same affordance as the IDE panel — which is a webview doing exactly
 * this over `window.getSelection()`, not the editor's comment API.
 *
 * The gesture itself is `SelectionCommentLayer`, shared with the file viewer;
 * what stays here is everything that knows this is a PLAN — the heading a
 * passage sits under, the recovery that uses it, and the list.
 *
 * `readOnly` is for a plan Claude is still WRITING: that text is about to be
 * rewritten, so a remark filed against it would point at a passage that has
 * moved. It is shown, and it is not commentable. A plan being put in front of
 * you is not that state — the CLI is blocked on its own dialog.
 */
export function PlanReview({
  plan,
  comments,
  onAdd,
  onRemove,
  onEdit,
  onClearAll,
  readOnly = false,
}: {
  plan: string;
  comments: PlanComment[];
  onAdd: (comment: Omit<PlanComment, 'id'>) => void;
  onRemove: (id: string) => void;
  /** Absent where a comment cannot be changed after the fact. */
  onEdit?: (id: string, text: string) => void;
  /** Empties the stack. Drawn with the list, which is the only place it is about. */
  onClearAll?: () => void;
  readOnly?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  /** Which comment the reader is standing on, painted in the solid colour. */
  const [current, setCurrent] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const unanchored = useCommentHighlights(box, {
    comments,
    current,
    content: plan,
    name: HIGHLIGHT_NAME,
    currentName: CURRENT_NAME,
    resolve: resolveAnchor,
  });

  return (
    <>
      <SelectionCommentLayer
        boxRef={box}
        readOnly={readOnly}
        onAdd={({ range, root, quote, text }) => {
          const off = offsetsOf(root, range);
          onAdd({
            quote,
            heading: headingOf(range.startContainer),
            text,
            start: off?.start ?? -1,
            end: off?.end ?? -1,
          });
        }}
      >
        <Markdown text={plan} />
      </SelectionCommentLayer>
      {/* The list is inside the plan rather than under the buttons so a comment
          sits near what it is about; the strip above the footer says how many
          there are while the decision is being taken. */}
      {comments.length > 0 && (
        <div className="mt-3 border-t border-[var(--border)] pt-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
              {comments.length} comment{comments.length === 1 ? '' : 's'} on this plan
            </span>
            {onClearAll && (
              <button
                type="button"
                onClick={onClearAll}
                className="ml-auto rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-dim)] md:hover:bg-[var(--bg-hover)] md:hover:text-[var(--text)]"
              >
                Clear all
              </button>
            )}
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
    </>
  );
}
