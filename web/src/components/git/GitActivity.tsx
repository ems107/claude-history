import { useEffect, useState, type ReactNode } from 'react';
import { formatClock } from '../../lib/format.ts';
import { actionClass } from '../controlClass.ts';
import type { useGitAction } from './useGitAction.ts';

/**
 * What the app is doing to this repository, and what happened when it stopped.
 *
 * The bar above this used to answer all three of "is it working", "what is it
 * doing" and "did it fail" with the same gesture: the button it was pressed on
 * turned into `…`. That is the least one can say, in the place where it costs
 * the most — the toolbar reflows, and the answer is still only "something".
 *
 * So the buttons stay exactly as they were (`BusyBar`) and everything that has
 * to be READ moves here, where there is a line's worth of room for it:
 *
 * - **running**, once it has been going long enough to wonder about: the verb,
 *   the exact command, a counter, and a way to stop it. The counter is not
 *   decoration. A fetch against an unreachable remote takes two minutes to time
 *   out, holding the repository's lock the whole time, and "it has been going
 *   for 1m 40s" is the difference between waiting and wondering whether
 *   anything was sent at all. Anything quicker than that gets the button's own
 *   `BusyBar` and no row — see `WONDER_MS`.
 * - **failed**: the server's sentence, which was written to be read by a
 *   person, and under it — folded — what git ACTUALLY printed. The second one
 *   used to be thrown away by the API client on the one occasion anybody wants
 *   it.
 * - **done**: what git said, expandable, because a fetch or a push answers in
 *   several lines and only the first was ever shown.
 */
/** How long something has to run before it earns a row of its own. */
const WONDER_MS = 700;

export function GitActivity({
  action,
  extra,
  onOpenLog,
}: {
  action: ReturnType<typeof useGitAction>;
  /** The ways out of a specific failure, decided by whoever owns the action. */
  extra?: ReactNode;
  /** Take me to the command this came from. */
  onOpenLog?: () => void;
}) {
  const { activity, error, gitStderr, note } = action;
  const [showStderr, setShowStderr] = useState(false);

  /**
   * **A row appears when something has run long enough to wonder about it, and
   * not before.**
   *
   * Every button in this tab goes through the same hook, so without a floor
   * this strip opened and shut on every stage, unstage and commit: measured,
   * staging the bench's 403 files put `Working · 0s` on screen for 525ms and
   * took it away again — a line of chrome arriving and leaving under the file
   * list, saying nothing anybody needed, with no command to read and no Stop
   * to press. Below the floor the instant feedback is the button's own
   * `BusyBar`, which takes no space and cannot shift anything.
   *
   * 700ms rather than a round half-second because the heaviest local operation
   * the bench has measures 525, and the strip is for the two-minute fetch, not
   * for a busy half-second.
   */
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!activity) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), WONDER_MS);
    return () => clearTimeout(timer);
  }, [activity]);

  // One tick a second, and only once the row is on screen to be ticked.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!activity || !slow) return;
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [activity, slow]);

  if (activity && slow) {
    return (
      <div className="w-full rounded border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-2 py-1.5 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          {/* The app's own spinner, the same ring the update button and the
              working row draw. It lives here rather than in the button because
              here it can widen a row that has room to be widened. */}
          <span
            aria-hidden
            className="size-3 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
          />
          <span className="shrink-0 text-[var(--text)]">{activity.what}</span>
          {activity.command && (
            <span className="min-w-0 flex-1 truncate font-mono text-[var(--text-dim)]" title={activity.command}>
              {activity.command}
            </span>
          )}
          <span className="shrink-0 tabular-nums text-[var(--text-dim)]">
            {formatClock(Date.now() - activity.startedAt)}
          </span>
          {activity.cancellable && (
            <button
              type="button"
              className={`${actionClass} shrink-0`}
              onClick={action.cancel}
              title="End the git process and everything it started"
            >
              Stop
            </button>
          )}
        </div>
        {/* Said only where it is true. Stopping a fetch can lose nothing — it
            writes remote-tracking refs and nothing else — while stopping a pull
            can leave a merge half-applied, which is a different offer and has
            to read like one. */}
        {activity.risky && (
          <p className="mt-1 text-amber-400">
            Stopping this one mid-way can leave the repository part-finished; what that is will be shown above the
            files, with the way out of it.
          </p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
        <p className="whitespace-pre-wrap">{error}</p>
        {/* git's own words, folded. The sentence above says what to DO; this is
            the evidence, and it is what you paste into a search engine. */}
        {gitStderr && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowStderr((v) => !v)}
              aria-expanded={showStderr}
              className="cursor-pointer text-[10px] text-red-300/80 underline decoration-dotted underline-offset-2 hover:text-red-200 max-md:min-h-10"
            >
              {showStderr ? 'hide what git printed' : 'what git printed'}
            </button>
            {showStderr && (
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] leading-[1.45] whitespace-pre-wrap text-red-200/80 select-text">
                {gitStderr}
              </pre>
            )}
          </div>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {extra}
          {onOpenLog && (
            <button type="button" className={actionClass} onClick={onOpenLog} title="Every git command this app runs">
              Open the log
            </button>
          )}
          <button type="button" className={actionClass} onClick={action.clear}>
            Dismiss
          </button>
        </span>
      </div>
    );
  }

  // Its own component, because it owns a timer and a fold and neither may be
  // declared behind an `if` in this one. Keyed on the note so a second result
  // arrives as a fresh strip — an unfolded one and a running clock are both
  // about the note that is there NOW.
  if (note) return <NoteStrip key={note} note={note} clear={action.clear} />;

  return null;
}

/** How long a bare confirmation stays before taking its row back. */
const FLEETING_MS = 6_000;

function NoteStrip({
  note,
  clear,
}: {
  note: string;
  clear: () => void;
}) {
  const lines = note.split('\n');
  /**
   * A short report opens READ, and that is not a preference either.
   *
   * git leads a fetch and a push with `From <url>` / `To <url>` and puts the
   * refs it moved on the lines after it — so the one line a collapsed
   * two-line note showed was the path, and the thing that actually happened
   * was behind a click. Showing the LAST line instead would be reading git's
   * English, which this tab does not do anywhere else. Three lines cost
   * nothing to show; a fetch that moved thirty branches still folds.
   */
  const [showAll, setShowAll] = useState(lines.length <= 3);
  /**
   * **A result you have to act on stays; one that only confirms goes.**
   *
   * `Already up to date.` is the whole of what a fetch that moved nothing has
   * to say, and it is worth saying — it is the only evidence the command ran at
   * all, and silence after a click is the thing this strip exists to end. It is
   * not worth a permanent row in a toolbar that wraps, though, so a note with
   * nothing in it beyond the confirmation takes its row back after a few
   * seconds. A failure never does: that one is a decision waiting to be made.
   *
   * A note with more than one line has something to READ — a fetch prints one
   * line per ref it moved — so it waits to be dismissed. Either way the full
   * text is in the command log afterwards, which is the panel's whole job.
   */
  const fleeting = lines.length === 1;
  useEffect(() => {
    if (!fleeting) return;
    const timer = setTimeout(clear, FLEETING_MS);
    return () => clearTimeout(timer);
  }, [fleeting, note, clear]);

  return (
    <div className="w-full text-[11px] text-emerald-400">
      <span className="flex items-start gap-2">
        <span className={`min-w-0 flex-1 ${showAll ? 'whitespace-pre-wrap' : 'truncate'}`} title={note}>
          {showAll ? note : lines[0]}
        </span>
        {/* A fetch answers in one line per ref it moved and a push in four.
            Only the first was ever drawn, which is how "3 refs updated" and
            "everything up to date" came to look identical. */}
        {lines.length > 1 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            className="shrink-0 cursor-pointer text-[10px] text-emerald-400/80 underline decoration-dotted underline-offset-2 hover:text-emerald-300 max-md:min-h-10"
          >
            {showAll ? 'less' : `${lines.length - 1} more line${lines.length === 2 ? '' : 's'}`}
          </button>
        )}
        <button
          type="button"
          onClick={clear}
          aria-label="Dismiss"
          className="shrink-0 cursor-pointer px-1 text-[var(--text-dim)] hover:text-[var(--text)] max-md:min-h-10 max-md:px-2"
        >
          ✕
        </button>
      </span>
    </div>
  );
}
