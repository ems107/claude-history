import type { SearchQueryEcho, SearchSnippet } from '@claude-history/shared';
import { Link } from 'react-router';
import { highlightSearchParams } from '../../lib/highlight.ts';

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
 * resolve nowhere.
 */
export function SnippetRow({
  sessionId,
  snippet,
  query,
}: {
  sessionId: string;
  snippet: SearchSnippet;
  query: SearchQueryEcho;
}) {
  let to = `/session/${sessionId}`;
  if (snippet.uuid) {
    const params = highlightSearchParams(query);
    params.set('msg', snippet.uuid);
    to += `?${params}`;
  }
  return (
    <Link
      to={to}
      className="block truncate rounded px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
    >
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
