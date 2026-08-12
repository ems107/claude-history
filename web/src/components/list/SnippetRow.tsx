import type { SearchSnippet } from '@claude-history/shared';
import { Link } from 'react-router';

/**
 * One matched snippet, linking into the session at the message it came from.
 * Shared by the three snippets a hit shows on its own and by the full list
 * behind "+N more matches", so the two can never look like different things.
 *
 * A snippet with no uuid — every subagent one — links to the session without an
 * anchor: the viewer knows only the parent transcript, so an anchor there would
 * resolve nowhere.
 */
export function SnippetRow({ sessionId, snippet }: { sessionId: string; snippet: SearchSnippet }) {
  return (
    <Link
      to={`/session/${sessionId}${snippet.uuid ? `?msg=${snippet.uuid}` : ''}`}
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
