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
  /** Its own transcript, in the drawer (`?agent=`). */
  openAgent(agentId: string): void;
  /** The call that started it (`?tool=`), opening every fold on the way. */
  goToCall(toolUseId: string): void;
  /** A message (`?msg=`) — the report, from the panel. */
  goToMessage(uuid: string): void;
  /** Whether that call is in this parse at all: a fork copies none of them. */
  hasCall(toolUseId: string): boolean;
}

export const SubagentContext = createContext<SubagentContextValue | null>(null);

export function useSubagents(): SubagentContextValue | null {
  return useContext(SubagentContext);
}
