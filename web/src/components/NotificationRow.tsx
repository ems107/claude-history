import type { StopPreview, StoppedSessionEntry } from '@claude-history/shared';
import { Link, useNavigate } from 'react-router';
import { formatDateTime, relativeTime } from '../lib/format.ts';
import { hasSelection } from '../lib/selection.ts';
import { ProjectTag } from './list/ProjectTag.tsx';

/** A project with no colour of its own yet — the same grey the other lists use. */
export const FALLBACK_COLOR = 'hsl(0 0% 55%)';

/**
 * One stopped session, as both the bell's panel and the toast draw it.
 *
 * Extracted the moment there were two of them. Everything in here is a decision
 * that has to be the same in both places — that the title outweighs its own
 * metadata, that `waitingFor` is shown in the CLI's words, that the quote is
 * the same quote — and a second copy is how those quietly stop matching.
 *
 * **The name and its metadata are the link; the quote is not.** The whole row
 * used to be one `<a>`, and it could not stay one: the quote is the biggest
 * thing in the row now, and a quote you cannot drag across to copy a command
 * out of is a quote that has to be read twice — once here and once in the
 * session. So it is a sibling that navigates on a plain click and stands out of
 * the way of a selection (`hasSelection`, the same test five other things in
 * this app already ask). The link above it is still the real one: it is what a
 * keyboard reaches, and the only half that can be opened in a new tab.
 *
 * The cross — or the tick — is never inside either: a `button` in an `a` is
 * invalid HTML, and nesting it would make dismissing a row open it.
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
  quoteLines = 3,
}: {
  stop: StoppedSessionEntry;
  color?: string;
  /**
   * Run on the way out, for whatever holds this and should not outlive the
   * click: the panel closes itself, a toast takes itself down. The navigation
   * happens either way, from the `Link` or from the quote.
   */
  onNavigate?: () => void;
  /** The toast says the title louder than the panel does. */
  titleClass?: string;
  /** The padding of the whole row — it is the box's now, not the link's. */
  className?: string;
  /**
   * How many lines of the quote are drawn. Three in the panel, two on a card
   * that has ten seconds of somebody's attention and a stack to share.
   */
  quoteLines?: 2 | 3;
}) {
  const name = stop.title ?? stop.sessionId;
  return (
    <div className={`min-w-0 flex-1 ${className}`}>
      <Link to={`/session/${stop.sessionId}`} onClick={onNavigate} className="block cursor-pointer" title={name}>
        {/* The line worth reading first, and dressed like it: bigger and semibold
            against the 10 px dim row under it, so a glance lands on WHICH session
            before anything else. */}
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
      {stop.preview && (
        <StopQuote preview={stop.preview} sessionId={stop.sessionId} lines={quoteLines} onNavigate={onNavigate} />
      )}
    </div>
  );
}

/**
 * What the session said as it stopped.
 *
 * **Dressed by what it IS, not by where it is drawn.** A command and a path are
 * monospaced because that is how they are written everywhere else in this app;
 * a plan, a question and an answer are prose. The `label` leads the same line
 * rather than sitting on its own, so the clamp counts the whole thing and a
 * three-line row is three lines whatever kind it holds.
 *
 * **The hover carries the rest**, which is the whole reason the server keeps
 * more than the three lines: `STOP_PREVIEW_MAX` is 600 and this shows what
 * fits, so the tooltip is where the other five hundred live. It says when it
 * was cut, and out of how much — a quote that stops mid-word without saying so
 * reads as a bug in the app rather than as a long answer.
 */
function StopQuote({
  preview,
  sessionId,
  lines,
  onNavigate,
}: {
  preview: StopPreview;
  sessionId: string;
  lines: 2 | 3;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const mono = preview.kind === 'tool' || preview.kind === 'error';
  const full = [preview.label, preview.text].filter((s) => s).join('\n\n');
  const title = preview.truncated
    ? `${full}\n\n— cut at ${String(preview.text.length)} of ${String(preview.chars)} characters. Open the session for the rest.`
    : full;
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      onClick={() => {
        // A drag that ended in here was somebody copying a command out, not
        // asking to go anywhere.
        if (hasSelection()) return;
        onNavigate?.();
        void navigate(`/session/${sessionId}`);
      }}
      title={title}
      className={`mt-1 cursor-pointer border-l-2 pl-2 text-[11px] leading-snug text-[var(--text-dim)] ${
        lines === 2 ? 'line-clamp-2' : 'line-clamp-3'
      } ${preview.kind === 'error' ? 'border-rose-500/50' : 'border-[var(--border)]'}`}
    >
      {preview.label && (
        <span className={`font-medium text-[var(--text)] ${mono ? 'font-mono' : ''}`}>{preview.label}</span>
      )}
      {preview.label && preview.text && <span className="text-[var(--text-dim)]"> — </span>}
      <span className={mono ? 'font-mono' : ''}>{preview.text}</span>
    </div>
  );
}

/**
 * The cross that goes beside a CARD. Always in the layout, so a card does not
 * shift when the pointer lands on it — only the ink appears.
 *
 * It says `Close`, and only ever `Close`: closing a card leaves the bell's row
 * exactly where it was. The panel's own control is `MarkRead`, which is the
 * other thing entirely.
 */
export function DismissCross({
  label,
  onClick,
  title = 'Close',
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

/**
 * The panel's own control: this row has been seen, and can go.
 *
 * **It is visible before the pointer arrives**, unlike the card's cross, and
 * that is the point of it rather than a difference in taste. The ghost ✕ was
 * discoverable only by hovering a row you had already decided to read, and it
 * never said what it did — "dismiss" is what the code calls it, while what a
 * person is doing is marking it read. A tick that is on screen and named is
 * both halves of that.
 *
 * The act underneath is unchanged, and so is its endpoint: the row goes, which
 * is the same thing opening the session already does.
 */
export function MarkRead({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Mark as read"
      aria-label={`Mark as read: ${label}`}
      className="shrink-0 cursor-pointer self-start rounded px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)] focus-visible:text-[var(--text)]"
    >
      ✓
    </button>
  );
}
