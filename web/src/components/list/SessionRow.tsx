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
      <div className="text-sm leading-tight">{relativeTime(last)}</div>
      <div className="text-xs leading-tight text-[var(--text-dim)]">last activity {formatDateTime(last)}</div>
      <div className="text-xs leading-tight text-[var(--text-dim)] opacity-70">
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
  const meta: Array<string | null> = [
    entrypointLabel(session.entrypoint),
    shortModel(session.model),
    session.gitBranch ? `⎇ ${session.gitBranch}` : null,
    session.enrichment
      ? `${session.enrichment.userMessageCount} prompts`
      : session.messageCount !== null
        ? `~${session.messageCount} msgs`
        : null,
    // Only when it happened: every session would otherwise carry a "0".
    session.subagentCount > 0
      ? `${session.subagentCount} subagent${session.subagentCount === 1 ? '' : 's'}`
      : null,
    session.enrichment && session.enrichment.compactionCount > 0
      ? `${session.enrichment.compactionCount} compaction${session.enrichment.compactionCount === 1 ? '' : 's'}`
      : null,
    formatBytes(session.sizeBytes),
  ];

  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ProjectTag
            name={session.projectName}
            path={session.projectPath}
            color={color}
            onClick={onProjectClick ? () => onProjectClick(session.projectKey) : undefined}
          />
          <span className="truncate text-sm font-medium" title={session.title}>
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
            className="shrink-0 cursor-pointer rounded px-1 text-xs text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
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
            className={`shrink-0 cursor-pointer rounded px-1 text-sm ${
              session.pinned
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-amber-400'
            }`}
            title={session.pinned ? 'Unpin' : 'Pin (stored locally, filter via ★ Pinned)'}
          >
            {session.pinned ? '★' : '☆'}
          </button>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-[var(--text-dim)]">
          {meta.filter(Boolean).map((m, i) => (
            <span key={i} className="shrink-0">
              {m}
            </span>
          ))}
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
          {/* The whole row is a <Link>, so this cannot be one too — same reason
              the rename and pin buttons swallow their click here. */}
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
      <div className="flex h-full items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-hover)] px-4">
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
          className="min-w-0 flex-1 rounded border border-[var(--accent-dim)] bg-[var(--bg-raised)] px-2 py-1 text-sm focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="cursor-pointer text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <Link
      to={`/session/${session.id}`}
      className="group flex h-full items-center gap-3 border-b border-[var(--border)] px-4 hover:bg-[var(--bg-hover)]"
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
