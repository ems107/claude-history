import type { SubagentMeta, Turn } from '@claude-history/shared';

/** A report an agent filed back into the conversation. */
export interface SubagentReport {
  /** The item carrying it — what `?msg=` needs to land on it. */
  uuid: string;
  timestamp: string | null;
  /** `completed` / `failed`, verbatim; null on a notification that recorded none. */
  status: string | null;
  /** The whole report. Null on a failure, which files a summary and nothing else. */
  result: string | null;
  /** The notification's own one-line summary of itself. */
  text: string;
}

/** Where an agent was started from, when that call is in this transcript. */
export interface SubagentCall {
  toolUseId: string;
  /** The assistant message that made it. */
  messageUuid: string;
  timestamp: string | null;
  /** The brief it was given (`input.prompt`), which the three-word description is not. */
  prompt: string | null;
}

export interface SubagentRow {
  meta: SubagentMeta;
  /**
   * Null when the call is not in this parse: a `/branch` fork does not copy the
   * subagents dir's calls, and a transcript can hold a `meta.json` whose call
   * was compacted out of the file. Then there is nothing to jump to, and the
   * panel says so rather than offering a dead button.
   */
  call: SubagentCall | null;
  /**
   * Every report it filed. Normally one, but a task-id may notify more than
   * once — its own `<note>` says so, since the agent can be resumed.
   */
  reports: SubagentReport[];
}

export interface SubagentIndex {
  rows: SubagentRow[];
  byId: Map<string, SubagentMeta>;
  byToolUse: Map<string, SubagentMeta>;
  /** The `tool_use` ids of every Agent call actually rendered by this parse. */
  calls: Set<string>;
}

const EMPTY: SubagentIndex = { rows: [], byId: new Map(), byToolUse: new Map(), calls: new Set() };

/**
 * The subagents of a session joined to the conversation they came out of: the
 * call that started each one, and the report it handed back.
 *
 * Both halves live in the parent transcript and neither is reachable from the
 * `meta.json`, which holds four fields and no timestamps. The join key is the
 * `toolUseId` for the call and the `taskId` (= the agentId) for the report —
 * never the description, which is three words and repeats across retries.
 *
 * Ordering is the launch order the metas are read in (the directory sorted),
 * not the order the reports arrive: agents run in parallel and finish out of
 * order, and the list is about who was sent, not who came back first.
 */
export function buildSubagentIndex(turns: Turn[], subagents: SubagentMeta[]): SubagentIndex {
  if (subagents.length === 0) return EMPTY;

  const byId = new Map(subagents.map((m) => [m.agentId, m]));
  const byToolUse = new Map(subagents.filter((m) => m.toolUseId).map((m) => [m.toolUseId, m]));
  const calls = new Map<string, SubagentCall>();
  const reports = new Map<string, SubagentReport[]>();

  for (const turn of turns) {
    for (const item of turn.items) {
      for (const block of item.blocks) {
        if (block.kind === 'tool') {
          if (!block.agentId || calls.has(block.agentId)) continue;
          const input = block.input;
          const prompt =
            input !== null && typeof input === 'object' && typeof (input as { prompt?: unknown }).prompt === 'string'
              ? ((input as { prompt: string }).prompt)
              : null;
          calls.set(block.agentId, {
            toolUseId: block.toolUseId,
            messageUuid: item.uuid,
            timestamp: item.timestamp,
            prompt,
          });
        } else if (block.kind === 'notice') {
          // A background command notifies through the very same channel, with an
          // id that matches no transcript — so a notice counts as an agent's
          // only if its task-id is one of ours.
          if (!block.taskId || !byId.has(block.taskId)) continue;
          const list = reports.get(block.taskId) ?? [];
          list.push({
            uuid: item.uuid,
            timestamp: item.timestamp,
            status: block.status,
            result: block.result,
            text: block.text,
          });
          reports.set(block.taskId, list);
        }
      }
    }
  }

  return {
    rows: subagents.map((meta) => ({
      meta,
      call: calls.get(meta.agentId) ?? null,
      reports: reports.get(meta.agentId) ?? [],
    })),
    byId,
    byToolUse,
    calls: new Set([...calls.values()].map((c) => c.toolUseId)),
  };
}

/** `failed` on any of its reports is what the row leads with — a retry files a second one. */
export function rowStatus(row: SubagentRow): 'completed' | 'failed' | 'unknown' {
  if (row.reports.some((r) => r.status === 'failed')) return 'failed';
  if (row.reports.some((r) => r.status === 'completed')) return 'completed';
  return 'unknown';
}
