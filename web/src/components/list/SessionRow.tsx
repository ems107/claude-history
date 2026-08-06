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
  const meta: Array<string | null> = [
    entrypointLabel(session.entrypoint),
    shortModel(session.model),
    session.gitBranch ? `⎇ ${session.gitBranch}` : null,
    session.messageCount !== null ? `${session.messageCount} msgs` : null,
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
      <div className="shrink-0 text-right">
        <div className="text-sm" title={formatDateTimeFull(session.lastActivityAt ?? session.mtimeMs)}>
          {relativeTime(session.lastActivityAt ?? session.mtimeMs)}
        </div>
        <div className="mt-0.5 text-xs text-[var(--text-dim)]" title="Created">
          {formatDateTime(session.createdAt)}
        </div>
      </div>
    </Link>
  );
}
