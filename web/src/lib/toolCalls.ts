import type { Turn } from '@claude-history/shared';

export interface ToolCallIndex {
  /**
   * Every `tool_use` this parse actually drew, by id.
   *
   * It is what a jump has to be checked against before it is OFFERED. A task
   * notification names the call it is the answer to (`<tool-use-id>`), but that
   * call need not be in this transcript at all: a `/branch` fork copies none of
   * them, and a compaction can swallow the message that made it. A button that
   * scrolls nowhere is worse than no button.
   */
  drawn: Set<string>;
  /**
   * `<task-id>` → the call that ANNOUNCED it, for the notices that name no
   * `<tool-use-id>` of their own.
   *
   * Every producer of a background task says the id it just created in its own
   * result — "Command running in background with ID: …", "Monitor started (task
   * …", "moved to the background as task …", "agentId: …" — so the id is the
   * join and the sentence around it is never read. First mention in transcript
   * order wins, which is what makes it the LAUNCH: a `TaskOutput` poll and a
   * `TaskStop` name the same id later, and a `Read` of the task's `.output` file
   * names it in its input, which is why only results are searched.
   *
   * **Checked against the 177 notices whose answer is already known** (the ones
   * that do name a `<tool-use-id>`): this picks the same call 177 times and a
   * different one never. It rescues the 3 that named none — a `Monitor` event, an
   * MCP task that outstayed its 120 s, and an Agent that was resumed — and only a
   * `<fork-source>` line, which reports no task at all, is left with nothing.
   *
   * An offloaded result is not searched (its text is on disk, not here); such a
   * notice keeps the no-button behaviour it has always had.
   */
  byTaskId: Map<string, string>;
}

/**
 * The calls this parse drew, and which of them announced a task.
 *
 * **Deliberately not a by-product of `buildSubagentIndex`**, which is where the
 * `drawn` half used to live as its Agent-only `calls` set. A notice is the
 * answer to a `Bash` call as readily as to an `Agent` one — of the 175
 * notifications on this machine only 115 are an agent's against 56 background
 * commands (50 `Bash`, 6 `PowerShell`) — and **20 of the sessions holding one
 * have no subagents whatsoever**, which is exactly when that index returns early.
 */
export function buildToolCallIndex(turns: Turn[]): ToolCallIndex {
  const drawn = new Set<string>();
  const results: { toolUseId: string; text: string }[] = [];
  const wanted = new Set<string>();

  for (const turn of turns) {
    for (const item of turn.items) {
      for (const block of item.blocks) {
        if (block.kind === 'tool') {
          if (!block.toolUseId) continue;
          drawn.add(block.toolUseId);
          // Only a notice that names no call of its own will be looked up, so
          // the texts are kept rather than searched — there is nothing to search
          // for until every notice has been seen.
          const text = block.result?.text;
          if (text) results.push({ toolUseId: block.toolUseId, text });
        } else if (block.kind === 'notice' && block.taskId && !block.toolUseId) {
          wanted.add(block.taskId);
        }
      }
    }
  }

  const byTaskId = new Map<string, string>();
  if (wanted.size > 0) {
    for (const { toolUseId, text } of results) {
      for (const taskId of wanted) {
        if (!byTaskId.has(taskId) && text.includes(taskId)) byTaskId.set(taskId, toolUseId);
      }
      if (byTaskId.size === wanted.size) break;
    }
  }

  return { drawn, byTaskId };
}
