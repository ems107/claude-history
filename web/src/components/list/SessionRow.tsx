import type { SessionSummary } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { formatUsd, sessionCostParts } from '../../lib/cost.ts';
import { entrypointLabel, formatBytes, formatDateTime, relativeTime, shortModel } from '../../lib/format.ts';
import { SessionBadges } from './Badges.tsx';
import { ProjectTag } from './ProjectTag.tsx';

function RowDates({ session }: { session: SessionSummary }) {
  const last = session.lastActivityAt ?? session.mtimeMs;
  return (
    <div
      className="shrink-0 text-right"
      title={`Last activity: ${formatDateTime(last)}\nCreated: ${formatDateTime(session.createdAt)}`}
    >
      <div className="text-sm leading-tight max-md:text-xs">{relativeTime(last)}</div>
      <div className="text-xs leading-tight text-[var(--text-dim)] max-md:hidden">
        last activity {formatDateTime(last)}
      </div>
      <div className="text-xs leading-tight text-[var(--text-dim)] opacity-70 max-md:hidden">
        created {formatDateTime(session.createdAt)}
      </div>
    </div>
  );
}

function RowContent({
  session,
  color,
  onProjectClick,
  onStartEdit,
  onTogglePin,
}: {
  session: SessionSummary;
  color: string;
  onProjectClick?: (projectKey: string) => void;
  onStartEdit: () => void;
  onTogglePin: () => void;
}) {
  // One shared query across every visible row: same key, one request.
  const prices = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  const cost = sessionCostParts(session, prices.data?.prices ?? {});

  // "Prompts" = user-typed messages (from enrichment) — the same metric the
  // Prompts sort uses. Fallback: Claude Code's internal context-entry count
  // (includes tool results and streamed chunks), shown as approximate.
  //
  // Agents and compactions are neighbours because they are the same kind of
  // fact — what this conversation turned out to contain — and neither is a
  // state of right now. That is what took the subagent count out of the badge
  // cluster beside LIVE and working: there it read as something happening,
  // and it was the only thing inside a row that is entirely a link that could
  // be clicked on its own.
  // Each item carries its own key rather than its position: three of the seven
  // are conditional, and keying on the index makes every item after one of them
  // a different element the moment it appears.
  const meta: Array<[key: string, text: string | null]> = [
    ['entrypoint', entrypointLabel(session.entrypoint)],
    ['model', shortModel(session.model)],
    ['branch', session.gitBranch ? `⎇ ${session.gitBranch}` : null],
    [
      'prompts',
      session.enrichment
        ? `${session.enrichment.userMessageCount} prompts`
        : session.messageCount !== null
          ? `~${session.messageCount} msgs`
          : null,
    ],
    // Only when it happened: every session would otherwise carry a "0".
    [
      'subagents',
      session.subagentCount > 0
        ? `${session.subagentCount} subagent${session.subagentCount === 1 ? '' : 's'}`
        : null,
    ],
    [
      'compactions',
      session.enrichment && session.enrichment.compactionCount > 0
        ? `${session.enrichment.compactionCount} compaction${session.enrichment.compactionCount === 1 ? '' : 's'}`
        : null,
    ],
    ['size', formatBytes(session.sizeBytes)],
  ];

  return (
    <>
      {/* Clipped, so nothing in here can be painted over the dates on
          its right. A project whose name is a temp-folder path is 700px of
          unshrinkable tag, and without this it simply ran across them. */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="contents max-md:hidden">
            <ProjectTag
              name={session.projectName}
              path={session.projectPath}
              color={color}
              onClick={onProjectClick ? () => onProjectClick(session.projectKey) : undefined}
            />
          </span>
          <span className="min-w-0 truncate text-sm font-medium" title={session.title}>
            {session.title}
          </span>
          {session.titleSource === 'local' && (
            <span
              className="shrink-0 text-xs text-amber-400"
              title={`Renamed locally — original title: “${session.originalTitle ?? ''}”`}
            >
              ✎
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onStartEdit();
            }}
            className="shrink-0 cursor-pointer rounded px-1 text-xs text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] max-md:px-2 max-md:py-1 max-md:text-sm max-md:opacity-100"
            title="Rename locally (never writes to ~/.claude)"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTogglePin();
            }}
            className={`shrink-0 cursor-pointer rounded px-1 text-sm max-md:px-2 max-md:py-1 max-md:text-base ${
              session.pinned
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-amber-400 max-md:opacity-100'
            }`}
            title={session.pinned ? 'Unpin' : 'Pin (stored locally, filter via ★ Pinned)'}
          >
            {session.pinned ? '★' : '☆'}
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-dim)] max-md:gap-x-2">
          <span className="hidden max-md:contents">
            <ProjectTag
              name={session.projectName}
              path={session.projectPath}
              color={color}
              shrink
              onClick={onProjectClick ? () => onProjectClick(session.projectKey) : undefined}
            />
          </span>
          {meta.map(([key, text]) =>
            text === null ? null : (
              <span key={key} className="shrink-0">
                {text}
              </span>
            ),
          )}
          {/* Right after the size, and only when it can be priced: a missing
              cost stays blank instead of claiming the session was free. It is
              the whole of what the session spent, subagents included — they can
              be 88% of it — with the split in the tooltip. Nothing marks that
              here: `N subagents` on the same line already says there are
              agents, and saying it twice is noise around the one figure being
              read. */}
          {cost.total !== null && (
            <span
              className="shrink-0"
              title={
                cost.subagents !== null
                  ? `${formatUsd(cost.own)} in this conversation + ${formatUsd(cost.subagents)} in ${
                      session.subagentCount
                    } subagent${session.subagentCount === 1 ? '' : 's'} — API-equivalent value at the configured prices`
                  : 'API-equivalent value at the configured prices — not actual subscription spend (see Stats)'
              }
            >
              {formatUsd(cost.total)}
            </span>
          )}
          {/* Nothing in here is interactive: the row is a <Link> and every badge
              is a <span>. The rename and pin buttons above are the only things
              that have to swallow a click of their own. */}
          <SessionBadges session={session} />
        </div>
      </div>
      <RowDates session={session} />
    </>
  );
}

export function SessionRow({
  session,
  color,
  onProjectClick,
}: {
  session: SessionSummary;
  color: string;
  onProjectClick?: (projectKey: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const save = (title: string) => {
    setSaving(true);
    api
      .renameSession(session.id, title)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        void queryClient.invalidateQueries({ queryKey: ['session', session.id] });
        setEditing(false);
      })
      .finally(() => setSaving(false));
  };

  if (editing) {
    return (
      <div className="flex min-h-16 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-hover)] px-4 max-md:min-h-20 max-md:flex-wrap max-md:content-center max-md:gap-2 max-md:px-3 max-md:py-2">
        <ProjectTag name={session.projectName} path={session.projectPath} color={color} />
        <input
          autoFocus
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save(value.trim());
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder={
            session.titleSource === 'local'
              ? 'New local title — leave empty to restore the original (Enter saves, Esc cancels)'
              : 'New local title (Enter saves, Esc cancels)'
          }
          className="min-w-0 flex-1 rounded border border-[var(--accent-dim)] bg-[var(--bg-raised)] px-2 py-1 text-sm focus:outline-none max-md:min-h-10 max-md:basis-full"
        />
        {/* Enter saves and Escape cancels, and on a desktop that is the whole
            of it. A phone has no Escape and its Enter key is a "Go" the user
            has to trust, so the two get buttons — the only thing here that is
            drawn rather than restyled. */}
        <button
          type="button"
          onClick={() => save(value.trim())}
          disabled={saving}
          className="hidden cursor-pointer rounded border border-[var(--accent-dim)] px-3 py-2 text-sm text-[var(--accent)] disabled:opacity-40 max-md:inline-block"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="cursor-pointer text-xs text-[var(--text-dim)] hover:text-[var(--text)] max-md:min-h-9 max-md:px-2 max-md:text-sm"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <Link
      to={`/session/${session.id}`}
      // `min-h` rather than `h-full`: the virtualizer measures these rather
      // than telling them a height, so there is no longer a box for a
      // percentage to resolve against. 64 is the height the desktop list has
      // always drawn, and it is now the floor rather than the ceiling — which
      // is what lets a row that has to wrap say so.
      className="group flex min-h-16 items-center gap-3 border-b border-[var(--border)] px-4 hover:bg-[var(--bg-hover)] max-md:min-h-20 max-md:gap-2 max-md:px-3 max-md:py-2"
    >
      <RowContent
        session={session}
        color={color}
        onProjectClick={onProjectClick}
        onStartEdit={() => {
          setValue(session.title);
          setEditing(true);
        }}
        onTogglePin={() => {
          void api.pinSession(session.id, !session.pinned).then(() => {
            void queryClient.invalidateQueries({ queryKey: ['sessions'] });
            void queryClient.invalidateQueries({ queryKey: ['session', session.id] });
          });
        }}
      />
    </Link>
  );
}
