import type { SessionDetail } from '@claude-history/shared';
import { Link } from 'react-router';
import { entrypointLabel, formatDateTimeFull, shortModel } from '../../lib/format.ts';
import { SessionBadges } from '../list/Badges.tsx';
import { ProjectTag } from '../list/ProjectTag.tsx';

function AncestryChips({ label, ids }: { label: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[var(--text-dim)]">{label}</span>
      {ids.map((id) => (
        <Link
          key={id}
          to={`/session/${id}`}
          className="rounded bg-amber-500/10 px-1.5 py-px font-mono text-amber-400 hover:bg-amber-500/20"
          title={id}
        >
          {id.slice(0, 8)}
        </Link>
      ))}
    </span>
  );
}

export function SessionHeader({
  detail,
  color,
  showThinking,
  onToggleThinking,
  showTokens,
  onToggleTokens,
  actions,
}: {
  detail: SessionDetail;
  color: string;
  showThinking: boolean;
  onToggleThinking: () => void;
  showTokens: boolean;
  onToggleTokens: () => void;
  actions?: import('react').ReactNode;
}) {
  const s = detail.summary;
  const toggleClass = (active: boolean) =>
    `cursor-pointer rounded border px-2 py-0.5 text-xs ${
      active
        ? 'border-[var(--accent)] text-[var(--accent)]'
        : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
    }`;

  return (
    <div className="border-b border-[var(--border)] px-4 py-3">
      <div className="flex items-center gap-2">
        <Link to="/" className="mr-1 text-[var(--text-dim)] hover:text-[var(--text)]" title="Back to list">
          ←
        </Link>
        <ProjectTag name={s.projectName} path={s.projectPath} color={color} />
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold" title={s.title}>
          {s.title}
        </h1>
        <button type="button" onClick={onToggleThinking} className={toggleClass(showThinking)}>
          Thinking
        </button>
        <button type="button" onClick={onToggleTokens} className={toggleClass(showTokens)}>
          Tokens
        </button>
        {actions}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-dim)]">
        <span title="Created">{formatDateTimeFull(s.createdAt)}</span>
        <span title="Last activity">→ {formatDateTimeFull(s.lastActivityAt)}</span>
        {s.gitBranch && <span>⎇ {s.gitBranch}</span>}
        {s.model && <span className="font-mono">{shortModel(s.model)}</span>}
        {s.entrypoint && <span>{entrypointLabel(s.entrypoint)}</span>}
        {s.slug && <span className="font-mono opacity-70">{s.slug}</span>}
        {s.claudeVersion && <span className="opacity-70">cc {s.claudeVersion}</span>}
        <SessionBadges session={s} />
        <AncestryChips label="resumed from" ids={detail.ancestry.resumedFrom} />
        <AncestryChips label="continued in" ids={detail.ancestry.descendants} />
        {detail.prLinks.map((pr) => (
          <a
            key={pr.prUrl}
            href={pr.prUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-purple-500/10 px-1.5 py-px text-purple-400 hover:bg-purple-500/20"
          >
            PR #{pr.prNumber} ↗
          </a>
        ))}
        <span className="font-mono opacity-50" title="Session id">
          {s.id}
        </span>
      </div>
    </div>
  );
}
