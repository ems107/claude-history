import type { LiveInfo, SessionSummary } from '@claude-history/shared';
import { LIVE_BUSY, LIVE_STOPPED, LIVE_WAITING } from '@claude-history/shared';
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

export function SessionBadges({
  session,
  omitPr = false,
  omitPinned = false,
  omitAgents = false,
  live,
  onSubagentsClick,
}: {
  session: SessionSummary;
  omitPr?: boolean;
  /**
   * The session page draws the pin as the ★ beside the title and the subagent
   * count in the inspector rail, so repeating either here would be the same
   * fact twice in one header. The list, which has neither, omits neither.
   */
  omitPinned?: boolean;
  omitAgents?: boolean;
  /**
   * Makes the ⑂ badge the way IN to the subagents, instead of a number with
   * nothing behind it. Absent where there is nowhere to go.
   */
  onSubagentsClick?: (e: import('react').MouseEvent) => void;
  /**
   * Live state from a fresher source than the summary, when the caller has one.
   * The session page does: its summary comes from `['session', id]`, which is
   * only refetched when the transcript grows — so on that page the badge would
   * describe a turn that started before the last write and miss the one running
   * now. Undefined means "use the summary"; null means "nothing is running".
   */
  live?: LiveInfo | null;
}) {
  const badges: ReactNode[] = [];
  const liveInfo = live === undefined ? session.live : live;

  if (session.pinned && !omitPinned) {
    badges.push(
      <Badge key="pinned" label="★" title="Pinned (local)" className="bg-amber-500/15 text-amber-400" />,
    );
  }

  if (liveInfo) {
    // Claude Code writes no status for a `--print` run, so a session being
    // answered from the app reads "unknown" here — which tells the user
    // nothing. Only the states that mean something get named.
    const busy = liveInfo.status === LIVE_BUSY;
    // A dialog is on screen: a permission, a question, a plan to approve. It is
    // NOT green — green here means "there is a process", and this one is stuck
    // until somebody answers it. Amber for the same reason `BlockedBar` is
    // amber: a state to resolve, not a failure.
    const waiting = liveInfo.status === LIVE_WAITING;
    const stopped = LIVE_STOPPED.includes(liveInfo.status);
    badges.push(
      <span
        key="live"
        title={
          busy
            ? 'Answering right now'
            : waiting
              ? `Waiting for you${liveInfo.waitingFor ? ` — ${liveInfo.waitingFor}` : ''}`
              : stopped
                ? 'Open and idle'
                : 'A Claude Code process has this session open'
        }
        className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ${
          waiting ? 'bg-amber-500/15 text-amber-400' : 'bg-green-500/15 text-green-400'
        }`}
      >
        <span
          className={`size-1.5 rounded-full ${waiting ? 'bg-amber-400' : 'bg-green-400'} ${
            busy ? 'animate-pulse' : ''
          }`}
        />
        {busy ? 'busy' : waiting ? 'waiting' : 'live'}
      </span>,
    );
  }
  if (session.subagentCount > 0 && !omitAgents) {
    const label = `⑂ ${session.subagentCount}`;
    const className = 'bg-sky-500/15 text-sky-400';
    const title = `${session.subagentCount} subagent${session.subagentCount === 1 ? '' : 's'}${
      onSubagentsClick ? ' — open the list' : ''
    }`;
    badges.push(
      onSubagentsClick ? (
        <button
          key="agents"
          type="button"
          onClick={onSubagentsClick}
          title={title}
          className={`inline-flex cursor-pointer items-center rounded px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase hover:bg-sky-500/30 ${className}`}
        >
          {label}
        </button>
      ) : (
        <Badge key="agents" label={label} title={title} className={className} />
      ),
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
