import type { SearchQueryEcho, SearchSnippet } from '@claude-history/shared';
import { Link } from 'react-router';
import { formatDateTimeFull, formatDateTimeShort, relativeTime } from '../../lib/format.ts';
import { highlightSearchParams, TOOL_PARAM } from '../../lib/highlight.ts';

/**
 * One matched snippet, linking into the session at the message it came from.
 * Shared by the three snippets a hit shows on its own and by the full list
 * behind "+N more matches", so the two can never look like different things.
 *
 * The link carries the terms as well as the anchor: the viewer marks them there,
 * because arriving in the middle of a 300-message session with nothing pointed
 * at is barely better than arriving at the top. They travel already folded, as
 * the server echoed them, so what is marked is what was matched.
 *
 * A snippet with no uuid — every subagent one — links to the session without an
 * anchor: the viewer knows only the parent transcript, so an anchor there would
 * resolve nowhere. The exception is the row that IS an agent's id, which opens
 * that agent: the whole reason those ids are indexed is that the string was
 * otherwise a dead end.
 */
export function SnippetRow({
  sessionId,
  snippet,
  query,
  onSelect,
  active = false,
  when,
}: {
  sessionId: string;
  snippet: SearchSnippet;
  query: SearchQueryEcho;
  /**
   * The find bar's rows step the reader through a conversation already on
   * screen, so the click is handled here rather than navigated. The `<a>` and
   * its href stay: copy-link, middle click and ctrl+click keep working, and a
   * `<button>` would make the snippet unselectable.
   */
  onSelect?: () => void;
  /** The row the reader is standing on. A ring, never a filter. */
  active?: boolean;
  /**
   * When the message this came from was written. Only the find bar has it — the
   * server's snippets carry no clock — and it is what puts a row back into its
   * conversation: a hundred rows all reading TOOL are otherwise the same row a
   * hundred times.
   */
  when?: string | null;
}) {
  let to = `/session/${sessionId}`;
  if (snippet.agentId) {
    // Both: the drawer for the agent named, and the list behind it so it can be
    // seen where it sits among the others.
    to += `?agents=1&agent=${encodeURIComponent(snippet.agentId)}`;
  } else if (snippet.uuid || snippet.toolUseId) {
    const params = highlightSearchParams(query);
    if (snippet.uuid) params.set('msg', snippet.uuid);
    // A tool hit needs its run and its own block opened, and neither is
    // reachable from a line uuid — see the comment on the field.
    if (snippet.toolUseId) params.set(TOOL_PARAM, snippet.toolUseId);
    to += `?${params}`;
  }
  return (
    <Link
      to={to}
      onClick={
        onSelect &&
        ((e) => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onSelect();
        })
      }
      className={`block truncate rounded px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] ${
        active ? 'ring-1 ring-[var(--accent)] bg-[var(--bg-hover)]' : ''
      }`}
    >
      {/* When before who: the rows come out in reading order, so the clock is
          the column that lines up down the list and gives it its shape. Short
          here and full on the hover — the row is one line, and every character
          the clock takes is a character of the match itself. */}
      {when && (
        <span
          className="mr-2 inline-block shrink-0 font-mono text-[10px] text-[var(--text-dim)]/60"
          title={`${formatDateTimeFull(when)} · ${relativeTime(when)}`}
        >
          {formatDateTimeShort(when)}
        </span>
      )}
      <span className="mr-2 inline-block w-14 shrink-0 text-right font-semibold text-[var(--text-dim)]/70 uppercase">
        {snippet.role}
      </span>
      {snippet.parts.map((part, pi) =>
        part.hit ? (
          <mark key={pi} className="rounded-sm bg-[var(--accent)]/30 px-0.5 text-[var(--text)]">
            {part.text}
          </mark>
        ) : (
          <span key={pi}>{part.text}</span>
        ),
      )}
    </Link>
  );
}
