import type { StarEntry } from '@claude-history/shared';
import { foldText, STAR_TEXT_MAX } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.ts';
import { CopyTextButton } from '../components/list/CopyTextButton.tsx';
import { OrderBar } from '../components/list/OrderBar.tsx';
import { ProjectTag } from '../components/list/ProjectTag.tsx';
import { Markdown } from '../components/viewer/Markdown.tsx';
import { formatDateTime, formatDateTimeFull, relativeTime } from '../lib/format.ts';
import { groupBySession, sortByDate, useOrder } from '../lib/order.ts';

const FALLBACK_COLOR = 'hsl(0 0% 55%)';

/** Same colours the bubbles use, so a row says who spoke at a glance. */
const ROLE: Record<StarEntry['role'], { label: string; tone: string }> = {
  user: { label: 'user', tone: 'text-[var(--accent)]' },
  assistant: { label: 'assistant', tone: 'text-emerald-400/80' },
};

/**
 * The message, clamped to a readable height with the rest one click away.
 *
 * The overflow is measured rather than guessed from the length: a 300-character
 * answer holding a code block is taller than a 2,000-character paragraph, and a
 * length threshold either clips one with no way to open it or puts a pointless
 * button under the other. Measured only while collapsed — expanded, the box has
 * grown to fit and would report that it never overflowed.
 */
function Clamped({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || open) return;
    const check = () => setTall(el.scrollHeight > el.clientHeight + 4);
    check();
    // Markdown settles after the fact — highlighting, fonts — so one
    // measurement on mount is a race.
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  return (
    <>
      <div ref={box} className={`relative mt-1 ${open ? '' : 'max-h-56 overflow-hidden'}`}>
        {children}
        {!open && tall && (
          // The fade says the text continues, without hiding the last line
          // behind a solid block.
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--bg)] to-transparent"
          />
        )}
      </div>
      {(open || tall) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 cursor-pointer text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          {open ? '▴ less' : '… more ▾'}
        </button>
      )}
    </>
  );
}

function StarRow({ star, onUnstar, busy }: { star: StarEntry; onUnstar: () => void; busy: boolean }) {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const color = projects.data?.find((p) => p.key === star.projectKey)?.color ?? FALLBACK_COLOR;
  const role = ROLE[star.role];
  return (
    <div className="border-b border-[var(--border)] px-4 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-dim)]">
        <ProjectTag name={star.projectName} path={star.project} color={color} />
        <span className={`font-semibold tracking-wider uppercase ${role.tone}`}>{role.label}</span>
        {star.timestamp && (
          <span title={formatDateTimeFull(star.timestamp)}>
            {formatDateTime(star.timestamp)} · {relativeTime(star.timestamp)}
          </span>
        )}
        {!star.sessionExists && (
          <span
            className="rounded bg-zinc-500/15 px-1.5 py-px text-[10px]"
            title="The session's transcript is gone, so there is nowhere to open. The copy kept here is all that is left of it."
          >
            the transcript no longer exists
          </span>
        )}
        {star.truncated && (
          <span
            className="text-[10px] opacity-70"
            title={`This message is ${star.chars.toLocaleString()} characters; the copy kept here stops at ${STAR_TEXT_MAX.toLocaleString()}. Open it in the conversation to read the whole of it.`}
          >
            copy cut at {STAR_TEXT_MAX.toLocaleString()} chars
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onUnstar}
            className={`shrink-0 rounded px-1.5 py-0.5 text-sm text-amber-400 ${
              busy ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-[var(--bg-hover)] hover:text-amber-300'
            }`}
            title="Remove from Starred"
            aria-pressed="true"
          >
            ★
          </button>
          <CopyTextButton text={star.text} title="Copy this message to the clipboard" />
          {star.sessionExists && (
            // Straight to the message, not merely to the session: the viewer
            // unfolds the segment, the branch and the turn, scrolls to it and
            // flashes it.
            <Link
              to={`/session/${star.sessionId}?msg=${encodeURIComponent(star.uuid)}`}
              className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
            >
              Open in the conversation →
            </Link>
          )}
        </span>
      </div>
      <Clamped>
        {star.role === 'assistant' ? (
          // An answer is markdown, and this is the same renderer the viewer
          // uses. With no `FileRefContext` above it a path stays plain text,
          // exactly as it does in the release notes.
          <Markdown text={star.text} />
        ) : (
          <div className="text-sm whitespace-pre-wrap">{star.text}</div>
        )}
      </Clamped>
      {/* Which session this belongs to, by name AND by id — the same pair, and
          the same mono chip, as the Plans page and the session header. */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-dim)]/80">
        <span>starred {relativeTime(star.starredAt)}</span>
        <span className="opacity-50">·</span>
        <span>in</span>
        {star.sessionExists ? (
          <>
            <Link to={`/session/${star.sessionId}`} className="hover:text-[var(--text)] hover:underline">
              {star.sessionTitle}
            </Link>
            <Link
              to={`/session/${star.sessionId}`}
              title={star.sessionId}
              className="rounded bg-amber-500/10 px-1.5 py-px font-mono text-amber-400 hover:bg-amber-500/20"
            >
              {star.sessionId.slice(0, 8)}
            </Link>
          </>
        ) : (
          <>
            <span className="italic">{star.sessionTitle}</span>
            <span title={star.sessionId} className="rounded bg-zinc-500/10 px-1.5 py-px font-mono opacity-70">
              {star.sessionId.slice(0, 8)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function StarredPage() {
  const queryClient = useQueryClient();
  // The same query key the viewer uses, so arriving from a session costs nothing.
  const stars = useQuery({ queryKey: ['stars'], queryFn: api.stars });
  const [q, setQ] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [role, setRole] = useState('');
  const [order, setOrder] = useOrder('starredOrder');
  const [busy, setBusy] = useState<string | null>(null);

  const unstar = (star: StarEntry) => {
    setBusy(star.uuid);
    void api
      .starMessage(star.sessionId, star.uuid, false)
      .then(() => queryClient.invalidateQueries({ queryKey: ['stars'] }))
      .finally(() => setBusy(null));
  };

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of stars.data ?? []) if (!seen.has(s.projectKey)) seen.set(s.projectKey, s.projectName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }));
  }, [stars.data]);

  const rows = useMemo(() => {
    let list = stars.data ?? [];
    if (projectFilter) list = list.filter((s) => s.projectKey === projectFilter);
    if (role) list = list.filter((s) => s.role === role);
    const needle = foldText(q.trim());
    if (needle.length >= 2) list = list.filter((s) => foldText(`${s.text} ${s.sessionTitle}`).includes(needle));
    return list;
  }, [stars.data, q, projectFilter, role]);

  // The message's own clock is what the page orders by, falling back to when it
  // was starred for a message the transcript gave no timestamp.
  const at = (s: StarEntry) => s.timestamp ?? s.starredAt;
  const flat = useMemo(() => sortByDate(rows, at, order.dir), [rows, order.dir]);
  const groups = useMemo(
    () =>
      groupBySession(rows, at, (s) => ({ sessionId: s.sessionId, sessionTitle: s.sessionTitle }), order.dir),
    [rows, order.dir],
  );

  if (stars.isLoading) return <div className="p-8 text-[var(--text-dim)]">Loading starred messages…</div>;
  if (stars.isError) return <div className="p-8 text-red-400">Failed: {String(stars.error)}</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-sm">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search everything you starred…"
          className="max-w-md min-w-48 flex-1 rounded border border-[var(--border)] bg-[var(--bg-raised)] px-2.5 py-1 text-sm placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)] focus:outline-none"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-1 text-xs text-[var(--text-dim)]"
        >
          <option value="">Prompts and answers</option>
          <option value="user">My prompts</option>
          <option value="assistant">Claude's answers</option>
        </select>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-1 text-xs text-[var(--text-dim)]"
        >
          <option value="">All projects</option>
          {projectOptions.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <span className="text-[var(--text-dim)]">
          {rows.length} starred{order.group === 'session' && ` in ${groups.length} session${groups.length === 1 ? '' : 's'}`}
        </span>
        <span className="ml-auto">
          <OrderBar
            order={order}
            onChange={setOrder}
            field="Message date"
            groupHint="Group the messages by the session they were starred in, newest session first"
          />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {order.group === 'session'
          ? groups.map((group) => (
              <div key={group.sessionId}>
                <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-raised)] px-4 py-1 text-xs text-[var(--text-dim)]">
                  <Link
                    to={`/session/${group.sessionId}`}
                    className="min-w-0 truncate font-semibold text-[var(--text)] hover:underline"
                  >
                    {group.sessionTitle}
                  </Link>
                  <Link
                    to={`/session/${group.sessionId}`}
                    title={group.sessionId}
                    className="shrink-0 rounded bg-amber-500/10 px-1.5 py-px font-mono text-amber-400 hover:bg-amber-500/20"
                  >
                    {group.sessionId.slice(0, 8)}
                  </Link>
                  <span className="ml-auto shrink-0">
                    {group.items.length} message{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                {group.items.map((star) => (
                  <StarRow
                    key={`${star.sessionId}-${star.uuid}`}
                    star={star}
                    busy={busy === star.uuid}
                    onUnstar={() => unstar(star)}
                  />
                ))}
              </div>
            ))
          : flat.map((star) => (
              <StarRow
                key={`${star.sessionId}-${star.uuid}`}
                star={star}
                busy={busy === star.uuid}
                onUnstar={() => unstar(star)}
              />
            ))}
        {rows.length === 0 && (
          <div className="p-8 text-center text-[var(--text-dim)]">
            {(stars.data ?? []).length === 0
              ? 'Nothing starred yet. The ★ sits in the top-right corner of any prompt or answer in a conversation.'
              : 'No starred message matches.'}
          </div>
        )}
      </div>
    </div>
  );
}
