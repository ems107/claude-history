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
   * The two halves of one pairing, and the two buttons that walk it — `↑ the
   * call` on a notice panel, `↓ the answer` on the call it came from. Null means
   * this parse does not hold the other end, and then neither button is drawn.
   *
   * Read off the SAME map in both directions (`buildToolCallIndex`, where the
   * three joins that find a call are explained), so the round trip cannot
   * disagree with itself: whatever `↑ the call` reaches is what offers the `↓`
   * back to where you were.
   */
  callOf(noticeUuid: string): string | null;
  answerTo(toolUseId: string): string | null;
}

export const SubagentContext = createContext<SubagentContextValue | null>(null);

export function useSubagents(): SubagentContextValue | null {
  return useContext(SubagentContext);
}
