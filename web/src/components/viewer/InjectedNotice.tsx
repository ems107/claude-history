import type { ContentBlock, MessageItem } from '@claude-history/shared';
import type { ReactNode } from 'react';
import { formatTokens } from '../../lib/cost.ts';
import { formatDateTime, formatDateTimeFull, relativeTime } from '../../lib/format.ts';
import { FoldHeader } from './FoldHeader.tsx';
import { Markdown } from './Markdown.tsx';
import { useFoldable } from './RevealContext.ts';
import { useSubagents } from './SubagentContext.ts';

type Notice = Extract<ContentBlock, { kind: 'notice' }>;

/**
 * Something Claude Code put in the conversation on its own — a background
 * command or an Agent reporting back.
 *
 * It arrives as a `user` line with plain string content, so it used to draw a
 * prompt bubble nobody wrote. It is not a prompt, but it is not a footnote
 * either: an exchange follows it, so it OPENS a turn, and it is drawn as the
 * event that opened it. Which is also why it carries the turn's badge and its
 * own timestamp — left as a bare muted line, the turn's cost pill floated above
 * it with nothing to belong to, and the date turned up again on the fold strip
 * below.
 *
 * **Unless it was queued** (`notice.queued`), which means the task finished
 * while Claude was still working: that one joins the turn already open and is
 * drawn on the answers' rail, with a chip for the clock that reads backwards.
 * The badge expression is the same either way and needs no case of its own — by
 * the time a mid-turn notice is reached, the prompt that opened the turn has
 * already taken it.
 *
 * When the task was an Agent, the block also holds the whole report it handed
 * back. That report exists nowhere else in this transcript, so it is shown
 * here, folded — and the row leads with the agent instead of with the word
 * "task notification", which says nothing about which of five agents this is.
 *
 * **The row of buttons under it is not an agent's, though**, and reading it as
 * one is what used to hide `↑ the call` from every background command: the whole
 * row was drawn only when there was a report or an agent to draw it for. A
 * notification names the call it answers whoever produced it — 171 of the 175 on
 * this machine do, and 56 of those are a `Bash` or `PowerShell` command, not an
 * agent at all.
 */
export function InjectedNotice({
  item,
  notice,
  badge,
}: {
  item: MessageItem;
  notice: Notice;
  badge?: ReactNode;
}) {
  const subagents = useSubagents();
  // The report is the only copy of what an agent handed back — 22.5 KB at the
  // median, and reachable by no server-side search — so a jump has to be able to
  // open it. Same key as the notice itself: `?msg=` is what points here.
  const [showReport, setShowReport] = useFoldable(`msg:${item.uuid}`);
  // A `<task-id>` is an agent's only if the session has that transcript: a
  // background command notifies through the same channel with an id of its own.
  const agent = notice.taskId ? (subagents?.byId.get(notice.taskId) ?? null) : null;
  // The call this is the answer to, when this parse drew it at all — and no
  // privilege of an agent's: a background command names its `Bash` call in the
  // very same tag, and 56 of the notices on this machine are one. Which of the
  // three joins found it is `callOf`'s business, not this panel's.
  const call = subagents?.callOf(item.uuid) ?? null;
  const failed = notice.status === 'failed';

  return (
    <div
      id={item.uuid}
      // No `onClick`, the same contract as `Bubble` and for the same reason it
      // was written: this used to fold the turn in prompts-only mode, so an
      // accidental click hid what you were reading. It outlived the bubble's
      // version by an oversight, and a click on a message now means something
      // else entirely — it selects it.
      className={`my-2 rounded border px-3 py-2 text-xs ${
        failed ? 'border-red-500/30 bg-red-500/5' : 'border-zinc-500/25 bg-zinc-500/5'
      }`}
    >
      {item.aliasUuids.map((u) => (
        <span key={u} id={u} />
      ))}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {agent ? (
          <span
            className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-sky-400 uppercase"
            title={`Subagent — ${agent.description}`}
          >
            ⑂ {agent.agentType}
          </span>
        ) : (
          <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-zinc-300 uppercase">
            {notice.origin.replace(/-/g, ' ')}
          </span>
        )}
        {notice.status && (
          <span className={`text-[10px] font-semibold tracking-wider uppercase ${failed ? 'text-red-400' : 'text-emerald-400/80'}`}>
            {notice.status}
          </span>
        )}
        {item.timestamp && (
          <span className="text-[var(--text-dim)]" title={formatDateTimeFull(item.timestamp)}>
            {formatDateTime(item.timestamp)} · {relativeTime(item.timestamp)}
          </span>
        )}
        {/* The task finished while Claude was still working, so the news waited
            in the queue until the turn's current stretch of work ended — which
            is why the clock above reads EARLIER than the answer this sits under.
            Without the chip that looks like a parsing error, the same reason a
            queued prompt wears one. */}
        {notice.queued && (
          <span
            className="rounded border border-[var(--border)] px-1 py-px text-[10px] text-[var(--text-dim)]"
            title="The task finished while Claude was working, so this waited in the queue and was delivered when the current stretch of work ended. The time shown is when the task finished."
          >
            queued
          </span>
        )}
        <span className="flex-1" />
        {badge}
      </div>
      {/* The searchable half, and only that: `data-bubble-body` is where marks
          are allowed, so the origin chip, the status and the clock above stay
          out of them — the same split a bubble makes. One element and not two,
          because a box is the unit the find bar counts in. */}
      <div data-bubble-body>
        <div className="mt-1 whitespace-pre-wrap text-[var(--text)]">{notice.text}</div>
        {/* This whole region used to stop the click event, because the box it
            sits in folded the turn: reading a report collapsed the conversation
            around it. The box takes no click at all now, so there is nothing
            left to stop. */}
        {(notice.result || agent || call) && (
          <div className="mt-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {notice.result && (
                <FoldHeader
                  open={showReport}
                  onToggle={() => setShowReport((v) => !v)}
                  className="rounded px-1 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                >
                  {showReport ? '▾' : '▸'} report · {formatTokens(notice.result.length)} chars
                </FoldHeader>
              )}
              {agent && subagents && (
                <button
                  type="button"
                  onClick={() => subagents.openAgent(agent.agentId)}
                  className="cursor-pointer rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-400 hover:bg-sky-500/25"
                  title="Open the subagent's own transcript"
                >
                  ⑂ transcript
                </button>
              )}
              {call && subagents && (
                <button
                  type="button"
                  onClick={() => subagents.goToCall(call)}
                  className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
                  title="Go to the call that started it"
                >
                  ↑ the call
                </button>
              )}
            </div>
            {showReport && notice.result && (
              <div className="mt-1.5 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                <Markdown text={notice.result} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
