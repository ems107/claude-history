import type { Turn } from '@claude-history/shared';

/**
 * Every `tool_use` this parse actually drew, by id.
 *
 * It is what a jump has to be checked against before it is OFFERED. A task
 * notification names the call it is the answer to (`<tool-use-id>`), but that
 * call need not be in this transcript at all: a `/branch` fork copies none of
 * them, and a compaction can swallow the message that made it. A button that
 * scrolls nowhere is worse than no button.
 *
 * **Deliberately not a by-product of `buildSubagentIndex`**, which is where this
 * used to live as the Agent-only `calls` set. A notice is the answer to a `Bash`
 * call as readily as to an `Agent` one — of the 175 notifications on this
 * machine, 171 name a `<tool-use-id>` and all 171 resolve, but only 115 of those
 * are an agent's against 56 background commands (50 `Bash`, 6 `PowerShell`).
 * **20 of the sessions holding one have no subagents whatsoever**, and the
 * subagent index returns early for exactly those, so half the corpus could never
 * have been offered the jump.
 */
export function toolCallIds(turns: Turn[]): Set<string> {
  const ids = new Set<string>();
  for (const turn of turns) {
    for (const item of turn.items) {
      for (const block of item.blocks) {
        if (block.kind === 'tool' && block.toolUseId) ids.add(block.toolUseId);
      }
    }
  }
  return ids;
}
