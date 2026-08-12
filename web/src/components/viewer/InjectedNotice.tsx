import type { MessageItem } from '@claude-history/shared';
import type { ReactNode } from 'react';
import { formatDateTime, formatDateTimeFull, relativeTime } from '../../lib/format.ts';
import { hasSelection } from '../../lib/selection.ts';

/**
 * Something Claude Code put in the conversation on its own — a background
 * command or an Agent reporting back.
 *
 * It arrives as a `user` line with plain string content, so it used to draw a
 * prompt bubble nobody wrote. It is not a prompt, but it is not a footnote
 * either: an exchange follows it, so it OPENS a turn, and it is drawn as the
 * event that opened it. Which is also why it carries the turn's badge and its
 * own timestamp — left as a bare muted line, the turn's cost pill floated above
 * it with nothing to belong to, and the date turned up again on the fold strip
 * below.
 */
export function InjectedNotice({
  item,
  origin,
  text,
  badge,
  onClick,
}: {
  item: MessageItem;
  /** `origin.kind` verbatim, e.g. "task-notification" — the transcript's own word for it. */
  origin: string;
  text: string;
  badge?: ReactNode;
  /** Prompts-only mode: clicking it expands the turn, like a prompt bubble. */
  onClick?: () => void;
}) {
  return (
    <div
      id={item.uuid}
      title={onClick ? 'Click to show or hide what followed it' : undefined}
      // Same contract as `Bubble`: never fold on a click that ended a selection,
      // and feedback through a ring — a filter would re-anchor the badge's
      // fixed hover card to this box.
      onClick={
        onClick &&
        (() => {
          if (hasSelection()) return;
          onClick();
        })
      }
      className={`my-2 rounded border border-zinc-500/25 bg-zinc-500/5 px-3 py-2 text-xs ${
        onClick ? 'cursor-pointer hover:ring-1 hover:ring-[var(--text-dim)]/40' : ''
      }`}
    >
      {item.aliasUuids.map((u) => (
        <span key={u} id={u} />
      ))}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-zinc-300 uppercase">
          {origin.replace(/-/g, ' ')}
        </span>
        {item.timestamp && (
          <span className="text-[var(--text-dim)]" title={formatDateTimeFull(item.timestamp)}>
            {formatDateTime(item.timestamp)} · {relativeTime(item.timestamp)}
          </span>
        )}
        <span className="flex-1" />
        {badge}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-[var(--text)]">{text}</div>
    </div>
  );
}
