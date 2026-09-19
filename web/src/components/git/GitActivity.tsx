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
 * - **running**: the verb, the exact command, a counter, and a way to stop it.
 *   The counter is not decoration. A fetch against an unreachable remote takes
 *   two minutes to time out, holding the repository's lock the whole time, and
 *   "it has been going for 1m 40s" is the difference between waiting and
 *   wondering whether anything was sent at all.
 * - **failed**: the server's sentence, which was written to be read by a
 *   person, and under it — folded — what git ACTUALLY printed. The second one
 *   used to be thrown away by the API client on the one occasion anybody wants
 *   it.
 * - **done**: what git said, expandable, because a fetch or a push answers in
 *   several lines and only the first was ever shown.
 */
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
  const [showAll, setShowAll] = useState(false);

  // One tick a second, and only while something is running.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!activity) return;
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [activity]);

  if (activity) {
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
              ⌘ Open the log
            </button>
          )}
          <button type="button" className={actionClass} onClick={action.clear}>
            Dismiss
          </button>
        </span>
      </div>
    );
  }

  if (note) {
    const lines = note.split('\n');
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
            onClick={action.clear}
            aria-label="Dismiss"
            className="shrink-0 cursor-pointer px-1 text-[var(--text-dim)] hover:text-[var(--text)] max-md:min-h-10 max-md:px-2"
          >
            ✕
          </button>
        </span>
      </div>
    );
  }

  return null;
}
