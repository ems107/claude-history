import type { SubagentMeta } from '@claude-history/shared';
import { createContext, useContext } from 'react';

/**
 * The session's subagents, and the three ways of moving between them and the
 * conversation. A context for the same reason `FileRefContext` is one: the
 * things that need it are a notice panel, a tool block and a drawer, all of
 * them several components below the page that knows the session — and
 * `onOpenAgent` already travels that far by hand.
 *
 * Absent means there is nothing to resolve against: a subagent's own transcript
 * rendered outside a session view, or a test rendering a turn on its own. Every
 * consumer then draws exactly what it drew before any of this.
 */
export interface SubagentContextValue {
  /** By agentId — which is what a notification's `<task-id>` is, when it is an agent's at all. */
  byId: Map<string, SubagentMeta>;
  /** By the `tool_use` that spawned it. */
  byToolUse: Map<string, SubagentMeta>;
  /**
   * Its own transcript, in the drawer (`?agent=`) — optionally landing on
   * something inside it, which is how a nested agent's call and report are
   * reached: both live in the transcript of the agent that spawned it, and the
   * drawer needs anchors of its own because `?tool=`/`?msg=` belong to the
   * conversation underneath.
   */
  openAgent(agentId: string, anchor?: { tool?: string; msg?: string }): void;
  /** The call that started it (`?tool=`), opening every fold on the way. */
  goToCall(toolUseId: string): void;
  /** A message (`?msg=`) — the report, from the panel. */
  goToMessage(uuid: string): void;
  /**
   * Whether that call is in this parse at all: a fork copies none of them, and a
   * compaction can swallow the message that made it. **Any** call, not only an
   * Agent one — the two agent-only callers pass ids that are a subset of the
   * same set (`buildToolCallIndex`).
   */
  hasCall(toolUseId: string): boolean;
  /**
   * The call a task notification is the answer to, or null when this parse does
   * not hold it. Three joins, strongest first, because a notice does not always
   * name its own call:
   *
   * 1. its `<tool-use-id>` — 171 of the 175 here;
   * 2. the `toolUseId` on the agent's `meta.json`, when the `<task-id>` is an
   *    agent's, which is the same join the drawer header makes;
   * 3. the call that ANNOUNCED the `<task-id>` in its own result — see
   *    `ToolCallIndex.byTaskId` for why that is exact rather than a guess.
   *
   * One accessor and not three, because the order between them is the answer:
   * asked separately, a caller would have to know it.
   */
  callOf(notice: { taskId: string | null; toolUseId: string | null }): string | null;
}

export const SubagentContext = createContext<SubagentContextValue | null>(null);

export function useSubagents(): SubagentContextValue | null {
  return useContext(SubagentContext);
}
