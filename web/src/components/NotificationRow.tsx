import type { StoppedSessionEntry } from '@claude-history/shared';
import { Link } from 'react-router';
import { formatDateTime, relativeTime } from '../lib/format.ts';
import { ProjectTag } from './list/ProjectTag.tsx';

/** A project with no colour of its own yet — the same grey the other lists use. */
export const FALLBACK_COLOR = 'hsl(0 0% 55%)';

/**
 * One stopped session, as both the bell's panel and the toast draw it.
 *
 * Extracted the moment there were two of them. Everything in here is a decision
 * that has to be the same in both places — that the whole area is the link, that
 * the title outweighs its own metadata, that `waitingFor` is shown in the CLI's
 * words — and a second copy is how those quietly stop matching.
 *
 * **The whole area is the link, not just the title.** A row means one thing and
 * goes to one place, and a 12 px line of text was a target you had to aim at: the
 * project tag and the clock beside it read as part of the same item and now
 * behave like it. The cross is never inside this — a `button` in an `a` is
 * invalid HTML, and nesting it would make dismissing a row open it — so the
 * caller draws that as a SIBLING, which is also what keeps the one part of the
 * row that is not a way in from being one.
 *
 * The caller owns the box: this fills whatever it is put in, and its hover
 * colours are driven by a `group` on that box.
 */
export function NotificationRow({
  stop,
  color = FALLBACK_COLOR,
  onNavigate,
  titleClass = 'text-sm font-semibold',
  className = 'px-1.5 py-1',
}: {
  stop: StoppedSessionEntry;
  color?: string;
  /**
   * Run on the way out, for whatever holds this and should not outlive the
   * click: the panel closes itself, a toast takes itself down. The navigation is
   * the `Link`'s and happens either way.
   */
  onNavigate?: () => void;
  /** The toast says the title louder than the panel does. */
  titleClass?: string;
  className?: string;
}) {
  const name = stop.title ?? stop.sessionId;
  return (
    <Link
      to={`/session/${stop.sessionId}`}
      onClick={onNavigate}
      className={`block min-w-0 flex-1 cursor-pointer ${className}`}
      title={name}
    >
      {/* The line worth reading first, and dressed like it: bigger and semibold
          against the 10 px dim row under it, so a glance lands on WHICH session
          before anything else. It was `text-xs` at normal weight once, which made
          the title and its metadata one grey block read a word at a time. */}
      <div className={`truncate text-[var(--text)] group-hover:text-[var(--accent)] ${titleClass}`}>{name}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-dim)]">
        {stop.projectName && <ProjectTag name={stop.projectName} path={stop.cwd ?? ''} color={color} />}
        {/* The CLI's own words. Nothing is translated: "permission prompt" is
            what the process wrote about itself, and inventing a friendlier phrase
            would be this app claiming to know which dialog it was. */}
        {stop.waitingFor && <span className="text-amber-400/90">{stop.waitingFor}</span>}
        <span title={formatDateTime(stop.at)}>{relativeTime(stop.at)}</span>
        {/* Only ever false for a composer row: a CLI's own notification goes when
            the CLI does. Worth saying, because "resume" is not on offer. */}
        {!stop.stillOpen && <span title="No Claude Code process has this session open any more">closed</span>}
      </div>
    </Link>
  );
}

/**
 * The cross that goes beside it. Always in the layout, so a row does not shift
 * when the pointer lands on it — only the ink appears.
 */
export function DismissCross({
  label,
  onClick,
  title = 'Dismiss',
}: {
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={`${title} ${label}`}
      className="shrink-0 cursor-pointer rounded px-1.5 text-[11px] text-transparent group-hover:text-[var(--text-dim)] hover:!text-[var(--text)] focus-visible:text-[var(--text-dim)]"
    >
      ✕
    </button>
  );
}
