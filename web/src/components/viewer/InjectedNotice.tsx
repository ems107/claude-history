import type { ContentBlock, MessageItem } from '@claude-history/shared';
import { type ReactNode, useState } from 'react';
import { formatTokens } from '../../lib/cost.ts';
import { formatDateTime, formatDateTimeFull, relativeTime } from '../../lib/format.ts';
import { hasSelection } from '../../lib/selection.ts';
import { FoldHeader } from './FoldHeader.tsx';
import { Markdown } from './Markdown.tsx';
import { useSubagents } from './SubagentContext.ts';

type Notice = Extract<ContentBlock, { kind: 'notice' }>;

/**
 * Something Claude Code put in the conversation on its own — a background
 * command or an Agent reporting back.
 *
 * It arrives as a `user` line with plain string content (or, when it was queued
 * behind a turn, as an attachment), so it used to draw a prompt bubble nobody
 * wrote. It is not a prompt, but it is not a footnote either: an exchange
 * follows it, so it OPENS a turn, and it is drawn as the event that opened it.
 * Which is also why it carries the turn's badge and its own timestamp — left as
 * a bare muted line, the turn's cost pill floated above it with nothing to
 * belong to, and the date turned up again on the fold strip below.
 *
 * When the task was an Agent, the block also holds the whole report it handed
 * back. That report exists nowhere else in this transcript, so it is shown
 * here, folded — and the row leads with the agent instead of with the word
 * "task notification", which says nothing about which of five agents this is.
 */
export function InjectedNotice({
  item,
  notice,
  badge,
  onClick,
}: {
  item: MessageItem;
  notice: Notice;
  badge?: ReactNode;
  /** Prompts-only mode: clicking it expands the turn, like a prompt bubble. */
  onClick?: () => void;
}) {
  const subagents = useSubagents();
  const [showReport, setShowReport] = useState(false);
  // A `<task-id>` is an agent's only if the session has that transcript: a
  // background command notifies through the same channel with an id of its own.
  const agent = notice.taskId ? (subagents?.byId.get(notice.taskId) ?? null) : null;
  const failed = notice.status === 'failed';

  return (
    <div
      id={item.uuid}
      title={onClick ? 'Click to show or hide what followed it' : undefined}
      // Same contract as `Bubble`: never fold on a click that ended a selection,
      // and feedback through a ring — a filter would re-anchor the badge's
      // fixed hover card to this box.
      onClick={
        onClick &&
        (() => {
          if (hasSelection()) return;
          onClick();
        })
      }
      className={`my-2 rounded border px-3 py-2 text-xs ${
        failed ? 'border-red-500/30 bg-red-500/5' : 'border-zinc-500/25 bg-zinc-500/5'
      } ${onClick ? 'cursor-pointer hover:ring-1 hover:ring-[var(--text-dim)]/40' : ''}`}
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
        <span className="flex-1" />
        {badge}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-[var(--text)]">{notice.text}</div>
      {/* Everything below is interactive inside a box that folds the turn on a
          click, so the whole region stops the event here — otherwise reading a
          report would collapse the conversation around it. */}
      {(notice.result || agent) && (
        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
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
            {notice.toolUseId && subagents?.hasCall(notice.toolUseId) && (
              <button
                type="button"
                onClick={() => subagents.goToCall(notice.toolUseId!)}
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
  );
}
