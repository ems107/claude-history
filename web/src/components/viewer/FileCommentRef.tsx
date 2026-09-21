/**
 * What a remark on a file is ABOUT, in one sentence.
 *
 * `PlanCommentRef`'s twin, and the differences are the two the record has: the
 * line it sits on instead of the heading above it, and no file name — the rows
 * are already grouped under one, and repeating it in every sentence is how a
 * list of nine remarks on one file becomes unreadable.
 */
export function FileCommentRef({
  index,
  quote,
  line,
  endLine,
}: {
  index: number;
  quote: string;
  line: number;
  endLine: number;
}) {
  return (
    // Two lines of quote, not one: a passage cut at 40 characters stops being
    // the thing it is quoting. The cap on what is COPIED is the record's own.
    <div className="line-clamp-2 text-[11px] text-[var(--text-dim)]">
      Comment {index} on <span className="text-[var(--text)] italic">“{quote}”</span>
      {', '}
      {line === endLine ? `line ${String(line)}` : `lines ${String(line)}-${String(endLine)}`}
    </div>
  );
}
