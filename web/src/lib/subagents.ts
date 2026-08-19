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
 * The brief an Agent call was given (`input.prompt`), which the three-word
 * description is not. One implementation, because the same call is read from
 * the session's transcript here and from another agent's in the panel.
 */
export function promptOf(input: unknown): string | null {
  if (input === null || typeof input !== 'object') return null;
  const prompt = (input as { prompt?: unknown }).prompt;
  return typeof prompt === 'string' ? prompt : null;
}

/**
 * The subagents of a session joined to the conversation they came out of: the
 * call that started each one, and the report it handed back.
 *
 * Both halves live in the parent transcript and neither is reachable from the
 * `meta.json`, which holds four fields and no timestamps. The join key is the
 * `toolUseId` for the call and the `taskId` (= the agentId) for the report —
 * never the description, which is three words and repeats across retries.
 *
 * Ordered by when each one was SENT OUT, not by the directory the metas are
 * read from — that one sorts by agentId, which is random hex, so a retry sent
 * ten minutes later came out above the four failures that caused it. Nor by
 * when the reports arrive: agents run in parallel and finish out of order, and
 * the list is about who was sent. An agent whose call is not in this transcript
 * has no time to sort by and keeps its place at the end.
 */
export function buildSubagentIndex(turns: Turn[], subagents: SubagentMeta[]): SubagentIndex {
  if (subagents.length === 0) return EMPTY;

  const byToolUse = new Map(subagents.filter((m) => m.toolUseId).map((m) => [m.toolUseId, m]));
  const known = new Set(subagents.map((m) => m.agentId));
  const calls = new Map<string, SubagentCall>();
  const reports = new Map<string, SubagentReport[]>();

  for (const turn of turns) {
    for (const item of turn.items) {
      for (const block of item.blocks) {
        if (block.kind === 'tool') {
          if (!block.agentId || calls.has(block.agentId)) continue;
          calls.set(block.agentId, {
            toolUseId: block.toolUseId,
            messageUuid: item.uuid,
            timestamp: item.timestamp,
            prompt: promptOf(block.input),
          });
        } else if (block.kind === 'notice') {
          // A background command notifies through the very same channel, with an
          // id that matches no transcript — so a notice counts as an agent's
          // only if its task-id is one of ours.
          if (!block.taskId || !known.has(block.taskId)) continue;
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

  const rows: SubagentRow[] = subagents.map((meta) => ({
    meta,
    call: calls.get(meta.agentId) ?? null,
    reports: reports.get(meta.agentId) ?? [],
  }));
  // ISO-8601 UTC sorts as text, and `sort` is stable, so agents sent out in the
  // same message keep the order the directory gave them. A missing time sinks
  // instead of floating to the top, which is what an empty string would do.
  const sentAt = (r: SubagentRow): string => r.call?.timestamp ?? '~';
  rows.sort((a, b) => (sentAt(a) < sentAt(b) ? -1 : sentAt(a) > sentAt(b) ? 1 : 0));

  return {
    rows,
    // Built from the sorted rows, because the drawer walks it with ‹ n of N ›
    // and has to agree with the list the reader is looking at.
    byId: new Map(rows.map((r) => [r.meta.agentId, r.meta])),
    byToolUse,
    calls: new Set([...calls.values()].map((c) => c.toolUseId)),
  };
}

export type SubagentStatus = 'completed' | 'failed' | 'running' | 'unknown';

/**
 * How long an agent may say nothing and still be called running.
 *
 * **The number is there to stop claiming, not to catch a working agent out**, so
 * it is far above anything one has been measured doing: across the 75 agent
 * transcripts on this machine, 5,748 gaps between consecutive lines run p50
 * 0.6 s, p90 5 s, p99 52.5 s and a longest silence of **358 s** — one slow tool
 * call, and the whole point of the figure. Fifteen minutes is 2.5x that.
 *
 * What it bounds is the other direction: an agent whose report never arrives at
 * all (killed mid-run, or a notification a compaction swallowed) would otherwise
 * wear the indicator for as long as its session stayed open.
 */
export const AGENT_SILENCE_MS = 15 * 60_000;

/**
 * What a row says about itself. `failed` on any of its reports is what it leads
 * with — a retry files a second one.
 *
 * **`running` is a claim about NOW and it takes three facts**, because a
 * subagent has no status anywhere. It runs inside its parent's process, so
 * nothing writes `busy` for it and the parent going idle says nothing: an agent
 * is launched asynchronously and the turn that launched it ENDS while it works,
 * which is the whole reason the parent has to be woken by the report. So:
 *
 * 1. **No report.** The only thing that says an agent has finished is the report
 *    it hands back — and the absence only means "not yet" where we hold the
 *    transcript that report would land in (`reportKnowable`). A nested agent
 *    reports inside the agent that spawned it and a `/branch` fork copies no
 *    calls at all; there the silence says nothing.
 * 2. **The process that would be running it is still alive.** Nothing survives
 *    the CLI it lived in, so a session that is not live has no agent working.
 *    Alive, not busy: that is the fix this rule exists for.
 * 3. **It has written something recently** — see `AGENT_SILENCE_MS`.
 */
export function subagentStatus(opts: {
  /** The status on every report we can see from it; empty means none. */
  reports: (string | null)[];
  /** Whether the transcript a report would land in is one we hold. */
  reportKnowable: boolean;
  /** The session's CLI process still exists (`['live']`, which checks the pid). */
  sessionAlive: boolean;
  /** The mtime of its own transcript. */
  lastWriteMs: number | null;
  now: number;
}): SubagentStatus {
  if (opts.reports.includes('failed')) return 'failed';
  if (opts.reports.includes('completed')) return 'completed';
  // It came back, and the notification recorded no status to read.
  if (opts.reports.length > 0) return 'unknown';
  if (!opts.reportKnowable) return 'unknown';
  const fresh = opts.lastWriteMs !== null && opts.now - opts.lastWriteMs < AGENT_SILENCE_MS;
  return opts.sessionAlive && fresh ? 'running' : 'unknown';
}

/** A row's status, for the two places that read one straight off the conversation. */
export function rowStatus(row: SubagentRow, live: { sessionAlive: boolean; now: number }): SubagentStatus {
  return subagentStatus({
    reports: row.reports.map((r) => r.status),
    reportKnowable: row.call !== null,
    sessionAlive: live.sessionAlive,
    lastWriteMs: row.meta.lastWriteMs,
    now: live.now,
  });
}

/**
 * The agents of this session that are still out there.
 *
 * Only the ones the CONVERSATION sent out can be counted — a nested agent's
 * report is in its parent's transcript, which this does not hold — and that is
 * also the honest count: a nested agent runs inside one of these, so the row it
 * would add is already represented by the one that spawned it.
 */
export interface RunningAgents {
  count: number;
  /** Their ids, joined: a dependency that only changes when the SET does, for a
   *  value recomputed on a clock. */
  ids: string;
  /** When the first of them was sent out (epoch ms) — the only clock this row can honestly show. */
  since: number | null;
}

export function runningAgents(rows: SubagentRow[], live: { sessionAlive: boolean; now: number }): RunningAgents {
  const out = rows.filter((r) => rowStatus(r, live) === 'running');
  let since: number | null = null;
  for (const r of out) {
    const at = r.call?.timestamp ? Date.parse(r.call.timestamp) : NaN;
    if (!Number.isNaN(at) && (since === null || at < since)) since = at;
  }
  return { count: out.length, ids: out.map((r) => r.meta.agentId).join(','), since };
}
