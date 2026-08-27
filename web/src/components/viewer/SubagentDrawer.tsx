import type { PriceTable, Turn } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../api/client.ts';
import { costEntries } from '../../lib/cost.ts';
import { useFoldState } from '../../lib/folding.ts';
import { turnActivity } from '../../lib/turnActivity.ts';
import { ZOOM_DEFAULT } from '../../lib/viewPrefs.ts';
import { CostPill } from './CostPill.tsx';
import { FollowBottomButton, useFollowBottom } from './FollowBottom.tsx';
import { useSubagents } from './SubagentContext.ts';
import { TurnList } from './TurnList.tsx';
import { WorkingIndicator } from './WorkingIndicator.tsx';
import { RAIL_PX } from '../../lib/inspector.ts';

const NO_PRICES: PriceTable = {};
/** Stable identity while the transcript loads. */
const EMPTY_TURNS: Turn[] = [];

export function SubagentDrawer({
  sessionId,
  agentId,
  showThinking,
  zoom,
  scrollToTool,
  scrollToUuid,
  jumpNonce,
  running,
  onClose,
}: {
  sessionId: string;
  agentId: string;
  showThinking: boolean;
  /** The thread zoom, passed down rather than read again: this is a thread too. */
  zoom: number;
  /**
   * Anchors inside THIS transcript, which is where a nested agent's call and
   * report live — the agent that spawned it made the call and received the
   * report, so neither is in the conversation underneath.
   */
  scrollToTool?: string | null;
  scrollToUuid?: string | null;
  jumpNonce?: number;
  /**
   * This agent is still working. The page's reading, because only the page holds
   * the session's live state and the report this agent would have filed — see
   * `subagentStatus` for the three facts it takes and the two it will not guess.
   * Deliberately NOT "the session is mid-turn": an agent is launched
   * asynchronously and outlives the turn that launched it. It draws the row and
   * arms the follow, which is the same statement twice.
   */
  running: boolean;
  onClose: () => void;
}) {
  // Refetched off the `agents` list of `sessions-changed`, which is what makes
  // this a window on a running agent instead of a photograph of one.
  const query = useQuery({
    queryKey: ['subagent', sessionId, agentId],
    queryFn: () => api.subagent(sessionId, agentId),
  });
  const pricesQ = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  const prices = pricesQ.data?.prices ?? NO_PRICES;
  const turns = query.data?.turns ?? EMPTY_TURNS;
  // Priced here from the parsed turns, and the enricher totals the same messages
  // from the same file for the session total — the two are checked against each
  // other (worst delta 2.7e-15 across every session with agents). What this cost
  // is NOT part of is the conversation's own row: none of it is in that file.
  const entries = useMemo(
    () => costEntries(turns.flatMap((t) => t.items), prices),
    [turns, prices],
  );
  // Its own fold state: the drawer has no header buttons, but its turns fold
  // exactly like the conversation's. Keyed on the agent and not on the turns, so
  // the transcript arriving again with a line more leaves open what is open.
  const fold = useFoldState(turns, showThinking, agentId);

  /**
   * The three clocks, read off this transcript rather than off `['live']`: a
   * subagent shares its parent's process and has no file in `~/.claude/sessions`,
   * so its own first line is the only thing that can say when it was sent out.
   */
  const activity = useMemo(() => turnActivity(turns), [turns]);
  // Memoised because it is a prop of a memoised `TurnList`, like the
  // conversation's own footer: a fresh identity would redraw every bubble.
  const workingFooter = useMemo(
    () =>
      running ? <WorkingIndicator since={activity.startedAt} activity={activity} startHint="Sent out" /> : undefined,
    [running, activity],
  );

  /**
   * Follow the end while it is being written, exactly as the conversation does —
   * an agent's transcript is opened to watch it work. Keyed on the agent, so
   * stepping to the next one starts unfollowed unless that one is working too.
   */
  const messageCount = useMemo(() => turns.reduce((n, t) => n + t.items.length, 0), [turns]);
  const follow = useFollowBottom(agentId, { autoFollow: running, messageCount });

  // Where this one sits among the session's agents, so a drawer is not a dead
  // end: five agents sent out together are read one after another, and closing
  // and hunting for the next call in the conversation is the long way round.
  const subagents = useSubagents();
  const order = subagents ? [...subagents.byId.keys()] : [];
  const at = order.indexOf(agentId);
  const step = (delta: number): (() => void) | undefined => {
    const next = order[at + delta];
    return at >= 0 && next ? () => subagents?.openAgent(next) : undefined;
  };
  const previous = step(-1);
  const next = step(1);
  const call = subagents?.byId.get(agentId)?.toolUseId;

  return (
    <div
      style={{ right: RAIL_PX }}
      className="fixed inset-y-0 z-20 flex w-[44rem] max-w-[90vw] flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs font-semibold text-sky-400">
          ⑂ {query.data?.meta.agentType ?? 'subagent'}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" title={query.data?.meta.description}>
          {query.data?.meta.description ?? agentId}
        </span>
        {/* Written down because it is what the URL carries and what a
            notification calls this agent — searchable now, and until it was on
            screen there was no way to go from the string back to the thing. */}
        <span className="shrink-0 font-mono text-[10px] text-[var(--text-dim)] opacity-60 select-text" title="Subagent id — paste it into the search to come back here">
          {agentId}
        </span>
        <CostPill entries={entries} prices={prices} label="agent" variant="badge" />
        {call && subagents?.hasCall(call) && (
          <button
            type="button"
            onClick={() => subagents.goToCall(call)}
            className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
            title="Go to the call that sent it out"
          >
            ↑ the call
          </button>
        )}
        {at >= 0 && order.length > 1 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--text-dim)]">
            <button
              type="button"
              disabled={!previous}
              onClick={previous}
              className={previous ? 'cursor-pointer px-1 hover:text-[var(--text)]' : 'px-1 opacity-30'}
              title="Previous subagent"
            >
              ‹
            </button>
            {at + 1} of {order.length}
            <button
              type="button"
              disabled={!next}
              onClick={next}
              className={next ? 'cursor-pointer px-1 hover:text-[var(--text)]' : 'px-1 opacity-30'}
              title="Next subagent"
            >
              ›
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded px-2 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>
      {/* The pill is a SIBLING of the scroller and never a child of it: inside,
          it would scroll away with the transcript. And the scroller gives up the
          band the pill floats in (16 px off the foot plus its own 30) as bottom
          padding, so nothing — the last bubble's corner, the working row, a fold
          strip — can end up underneath it. The conversation's foot buys the same
          corner with arithmetic over its column width, which only works for a
          column centred in the window; this one is a panel pinned to the right
          edge, and emptying the band is the same fix with no arithmetic in it. */}
      <div className="relative min-h-0 flex-1">
        <div ref={follow.scrollRef} className="h-full overflow-y-auto px-4 pt-4 pb-14">
          <div ref={follow.contentRef}>
            {query.isLoading && <div className="text-[var(--text-dim)]">Loading subagent transcript…</div>}
            {query.isError && <div className="text-red-400">Failed: {String(query.error)}</div>}
            {query.data && (
              <div style={zoom === ZOOM_DEFAULT ? undefined : { zoom: `${zoom}%` }}>
                <TurnList
                  key={agentId}
                  turns={query.data.turns}
                  showThinking={showThinking}
                  fold={fold}
                  scrollToTool={scrollToTool}
                  scrollToUuid={scrollToUuid}
                  jumpNonce={jumpNonce}
                  footer={workingFooter}
                  lastTurnInFlight={running}
                />
              </div>
            )}
          </div>
        </div>
        <FollowBottomButton
          following={follow.following}
          toggle={follow.toggle}
          unseen={follow.unseen}
          working={running}
          workingWhat="This subagent is working"
        />
      </div>
    </div>
  );
}
