import type { LiveInfo, SessionSummary } from '@claude-history/shared';
import { LIVE_BUSY, LIVE_STOPPED, LIVE_WAITING } from '@claude-history/shared';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { formatClock, formatDateTime } from '../../lib/format.ts';

export function Badge({ label, className, title }: { label: string; className: string; title?: string }) {
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

  // "In this state since": what the idle and waiting clocks count from — the
  // flip, which is exactly what those two states mean. NOT the last activity:
  // a resumed session is idle for seconds over a transcript last written days
  // ago, and a menu pulled up writes `waiting` without a byte of transcript.
  const stateSince = liveInfo ? (liveInfo.statusUpdatedAt ?? liveInfo.updatedAt) : null;
  // The working clock is the turn's own: `busySince` holds across the
  // waiting↔busy flips a dialog causes, where the flip restarts on every
  // answered permission.
  const workingSince = liveInfo ? (liveInfo.busySince ?? stateSince) : null;

  // The clocks have to move on their own: nothing refetches a list whose
  // sessions are merely getting older. Mounted only when there is one to move.
  const [, tick] = useState(0);
  const hasClock = liveInfo != null && (liveInfo.startedAt != null || stateSince != null);
  useEffect(() => {
    if (!hasClock) return;
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [hasClock]);

  if (session.pinned && !omitPinned) {
    badges.push(
      <Badge key="pinned" label="★" title="Pinned (local)" className="bg-amber-500/15 text-amber-400" />,
    );
  }

  if (liveInfo) {
    // Two badges for two facts. LIVE says "there is a process", in every state
    // alike, and carries how long that process has been there; the state badge
    // says what the process is doing NOW, and only when the CLI actually said
    // — a `--print` run writes no status, so "unknown" draws no state at all.
    badges.push(
      <span
        key="live"
        title={`A Claude Code process has this session open${
          liveInfo.startedAt !== null ? ` — since ${formatDateTime(liveInfo.startedAt)}` : ''
        }`}
        className="inline-flex items-center gap-1 rounded bg-green-500/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-green-400 uppercase"
      >
        <span className="size-1.5 rounded-full bg-green-400" />
        live
        {/* Lowercase units inside an uppercase pill, tabular digits so the
            ticking seconds don't wobble the badge. */}
        {liveInfo.startedAt !== null && (
          <span className="tabular-nums normal-case">{formatClock(Date.now() - liveInfo.startedAt)}</span>
        )}
      </span>,
    );
    if (liveInfo.status === LIVE_BUSY) {
      badges.push(
        <span
          key="state"
          title={`Answering right now${
            workingSince !== null ? `\nThis turn began ${formatDateTime(workingSince)}` : ''
          }`}
          className="inline-flex items-center gap-1 rounded bg-[var(--accent)]/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-[var(--accent)] uppercase"
        >
          <span className="size-2 animate-spin rounded-full border-[1.5px] border-[var(--accent)]/35 border-t-[var(--accent)]" />
          working
          {workingSince !== null && (
            <span className="tabular-nums normal-case">{formatClock(Date.now() - workingSince)}</span>
          )}
        </span>,
      );
    } else if (liveInfo.status === LIVE_WAITING) {
      // A dialog is on screen: a permission, a question, a plan to approve. It
      // is NOT green — green means "there is a process", and this one is stuck
      // until somebody answers it. Amber for the same reason `BlockedBar` is
      // amber, and the pulse lives here: movement means "it wants you".
      badges.push(
        <span
          key="state"
          title={`Waiting for you${liveInfo.waitingFor ? ` — ${liveInfo.waitingFor}` : ''}${
            stateSince !== null ? `\nSince ${formatDateTime(stateSince)}` : ''
          }`}
          className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-amber-400 uppercase"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
          waiting
          {stateSince !== null && (
            <span className="tabular-nums normal-case">{formatClock(Date.now() - stateSince)}</span>
          )}
        </span>,
      );
    } else if (LIVE_STOPPED.includes(liveInfo.status)) {
      badges.push(
        <span
          key="state"
          title={`Open and idle${stateSince !== null ? `\nSince ${formatDateTime(stateSince)}` : ''}`}
          className="inline-flex items-center gap-1 rounded bg-zinc-500/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-zinc-400 uppercase"
        >
          {/* A hollow dot: a process at rest, not absent. */}
          <span className="size-1.5 rounded-full border-[1.5px] border-zinc-400" />
          idle
          {stateSince !== null && (
            <span className="tabular-nums normal-case">{formatClock(Date.now() - stateSince)}</span>
          )}
        </span>,
      );
    }
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
