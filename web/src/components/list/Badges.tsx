import type { SessionSummary } from '@claude-history/shared';
import type { ReactNode } from 'react';

function Badge({ label, className, title }: { label: string; className: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ${className}`}
    >
      {label}
    </span>
  );
}

export function SessionBadges({ session, omitPr = false }: { session: SessionSummary; omitPr?: boolean }) {
  const badges: ReactNode[] = [];

  if (session.pinned) {
    badges.push(
      <Badge key="pinned" label="★" title="Pinned (local)" className="bg-amber-500/15 text-amber-400" />,
    );
  }

  if (session.live) {
    badges.push(
      <span
        key="live"
        title={`Running now (${session.live.status})`}
        className="inline-flex items-center gap-1 rounded bg-green-500/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-green-400 uppercase"
      >
        <span
          className={`size-1.5 rounded-full bg-green-400 ${session.live.status === 'busy' ? 'animate-pulse' : ''}`}
        />
        {session.live.status === 'busy' ? 'busy' : 'live'}
      </span>,
    );
  }
  if (session.subagentCount > 0) {
    badges.push(
      <Badge
        key="agents"
        label={`⑂ ${session.subagentCount}`}
        title={`${session.subagentCount} subagent transcript(s)`}
        className="bg-sky-500/15 text-sky-400"
      />,
    );
  }
  if (!omitPr && session.enrichment && session.enrichment.prLinks.length > 0) {
    badges.push(
      <Badge
        key="pr"
        label={`PR #${session.enrichment.prLinks[0].prNumber}`}
        title={session.enrichment.prLinks[0].prUrl}
        className="bg-purple-500/15 text-purple-400"
      />,
    );
  }
  if (session.enrichment?.forkedFrom) {
    badges.push(
      <Badge
        key="fork"
        label="fork"
        title={`Branched off session ${session.enrichment.forkedFrom}`}
        className="bg-amber-500/15 text-amber-400"
      />,
    );
  }
  if (session.isBackground) {
    badges.push(<Badge key="bg" label="bg" title="Background session" className="bg-zinc-500/15 text-zinc-400" />);
  }
  if (session.isEmpty) {
    badges.push(<Badge key="empty" label="empty" title="Throwaway session stub" className="bg-zinc-600/15 text-zinc-500" />);
  }

  if (badges.length === 0) return null;
  return <span className="inline-flex items-center gap-1">{badges}</span>;
}
