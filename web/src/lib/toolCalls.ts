import type { SubagentMeta, Turn } from '@claude-history/shared';

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
  /** The uuid of a notice item → the call it is the answer to. */
  callOfNotice: Map<string, string>;
  /**
   * A call → the uuid of the notice that answered it. The same pairing read
   * backwards, so the two buttons can never disagree about what is paired with
   * what.
   *
   * **One notice per call, 180 of 180 here.** A `<task-id>` may notify more than
   * once in principle — its own `<note>` says so, an agent can be resumed — and
   * the first is kept: it is the answer to THIS call, where a later one is the
   * answer to having been sent another message.
   */
  answerOfCall: Map<string, string>;
}

/**
 * The calls this parse drew, paired with the notices that reported back.
 *
 * **Deliberately not a by-product of `buildSubagentIndex`**, which is where the
 * `drawn` half used to live as its Agent-only `calls` set. A notice is the
 * answer to a `Bash` call as readily as to an `Agent` one — of the 175
 * notifications on this machine only 115 are an agent's against 56 background
 * commands (50 `Bash`, 6 `PowerShell`) — and **20 of the sessions holding one
 * have no subagents whatsoever**, which is exactly when that index returns early.
 *
 * **Three joins find the call, strongest first**, because a notice does not
 * always name its own:
 *
 * 1. its `<tool-use-id>` — 171 of the 175 here;
 * 2. the `toolUseId` on the agent's `meta.json`, when the `<task-id>` is an
 *    agent's. That is the case of an agent that was RESUMED: it files a second
 *    report naming no call. Exact rather than inferred — every one of the 31
 *    metas here finds the call that sent it out — and the same join the drawer
 *    header makes;
 * 3. the call that ANNOUNCED the `<task-id>` in its own result. Every producer
 *    says the id it just created — "Command running in background with ID: …",
 *    "Monitor started (task …", "moved to the background as task …" — so **the
 *    id is the join and the sentence around it is never read**. First mention in
 *    transcript order is the launch: a `TaskOutput` poll and a `TaskStop` name
 *    the same id later, and a `Read` of the task's `.output` file names it in its
 *    *input*, which is why only results are searched.
 *
 * **The third rule is falsifiable, and was falsified**: over the 177 notices
 * whose answer is already known — the ones that do name a `<tool-use-id>` — it
 * picks that same call 177 times and a different one never. It rescues the three
 * that named none, and only a `<fork-source>` line, which reports no task at all,
 * is left unpaired.
 *
 * An offloaded result is not searched (its text is on disk, not here), and a
 * launch whose notification never arrived — the session ended first, or it is
 * still out there: 10 calls in this corpus — pairs with nothing, which is why
 * neither button is drawn on faith.
 */
export function buildToolCallIndex(turns: Turn[], subagents: SubagentMeta[]): ToolCallIndex {
  const drawn = new Set<string>();
  const results: { toolUseId: string; text: string }[] = [];
  const notices: { uuid: string; taskId: string | null; toolUseId: string | null }[] = [];
  const announced = new Set<string>();

  for (const turn of turns) {
    for (const item of turn.items) {
      for (const block of item.blocks) {
        if (block.kind === 'tool') {
          if (!block.toolUseId) continue;
          drawn.add(block.toolUseId);
          // Kept rather than searched: there is nothing to search for until
          // every notice has been seen.
          const text = block.result?.text;
          if (text) results.push({ toolUseId: block.toolUseId, text });
        } else if (block.kind === 'notice') {
          notices.push({ uuid: item.uuid, taskId: block.taskId, toolUseId: block.toolUseId });
          if (block.taskId && !block.toolUseId) announced.add(block.taskId);
        }
      }
    }
  }

  const byTaskId = new Map<string, string>();
  if (announced.size > 0) {
    for (const { toolUseId, text } of results) {
      for (const taskId of announced) {
        if (!byTaskId.has(taskId) && text.includes(taskId)) byTaskId.set(taskId, toolUseId);
      }
      if (byTaskId.size === announced.size) break;
    }
  }

  const metaById = new Map(subagents.map((m) => [m.agentId, m]));
  const callOfNotice = new Map<string, string>();
  const answerOfCall = new Map<string, string>();
  for (const notice of notices) {
    const meta = notice.taskId ? metaById.get(notice.taskId) : undefined;
    const call =
      (notice.toolUseId && drawn.has(notice.toolUseId) && notice.toolUseId) ||
      (meta?.toolUseId && drawn.has(meta.toolUseId) && meta.toolUseId) ||
      (notice.taskId && byTaskId.get(notice.taskId)) ||
      null;
    if (!call) continue;
    callOfNotice.set(notice.uuid, call);
    if (!answerOfCall.has(call)) answerOfCall.set(call, notice.uuid);
  }

  return { drawn, callOfNotice, answerOfCall };
}
