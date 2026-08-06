import type { SessionSummary } from '@claude-history/shared';
import { Link } from 'react-router';
import {
  entrypointLabel,
  formatBytes,
  formatDateTime,
  formatDateTimeFull,
  relativeTime,
  shortModel,
} from '../../lib/format.ts';
import { SessionBadges } from './Badges.tsx';
import { ProjectTag } from './ProjectTag.tsx';

export function SessionRow({
  session,
  color,
  onProjectClick,
}: {
  session: SessionSummary;
  color: string;
  onProjectClick?: (projectKey: string) => void;
}) {
  // "Prompts" = user-typed messages (from enrichment) — the same metric the
  // Prompts sort uses. Fallback: Claude Code's internal context-entry count
  // (includes tool results and streamed chunks), shown as approximate.
  const meta: Array<string | null> = [
    entrypointLabel(session.entrypoint),
    shortModel(session.model),
    session.gitBranch ? `⎇ ${session.gitBranch}` : null,
    session.enrichment
      ? `${session.enrichment.userMessageCount} prompts`
      : session.messageCount !== null
        ? `~${session.messageCount} msgs`
        : null,
    formatBytes(session.sizeBytes),
  ];

  return (
    <Link
      to={`/session/${session.id}`}
      className="flex h-full items-center gap-3 border-b border-[var(--border)] px-4 hover:bg-[var(--bg-hover)]"
    >
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
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-[var(--text-dim)]">
          {meta.filter(Boolean).map((m, i) => (
            <span key={i} className="shrink-0">
              {m}
            </span>
          ))}
          <SessionBadges session={session} />
        </div>
      </div>
      <div
        className="shrink-0 text-right"
        title={`Created: ${formatDateTimeFull(session.createdAt)}\nLast activity: ${formatDateTimeFull(session.lastActivityAt ?? session.mtimeMs)}`}
      >
        <div className="text-sm">{relativeTime(session.lastActivityAt ?? session.mtimeMs)}</div>
        <div className="mt-0.5 text-xs text-[var(--text-dim)]">
          {formatDateTime(session.lastActivityAt ?? session.mtimeMs)}
        </div>
      </div>
    </Link>
  );
}
