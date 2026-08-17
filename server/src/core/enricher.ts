import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  CacheState,
  DailyUsage,
  MessageUsage,
  PlanRecord,
  PrLink,
  SearchBlock,
  SessionEnrichment,
  UsageTotals,
} from '@claude-history/shared';
import { recacheOf } from '@claude-history/shared';
import { isRec, num, replayFilter, safeParse, str, streamLines } from './jsonl.ts';
import { planFeedback, planTitle, toMessageUsage } from './parser.ts';
import { PLAN_ROLE } from './searchText.ts';
import { extractPrompt, injectedOrigin, queuedPrompt } from './summarizer.ts';

// It moved to `shared` when the viewer grew a search of its own over a corpus
// this file never produces; re-exported so the modules written against it here
// need not care where it lives.
export type { SearchBlock };

export interface EnrichData {
  enrichment: SessionEnrichment;
  searchBlocks: SearchBlock[];
}

function zeroUsage(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
}

function addUsage(totals: UsageTotals, usage: Record<string, unknown>): void {
  totals.input += num(usage.input_tokens) ?? 0;
  totals.output += num(usage.output_tokens) ?? 0;
  totals.cacheRead += num(usage.cache_read_input_tokens) ?? 0;
  totals.cacheCreate += num(usage.cache_creation_input_tokens) ?? 0;
}

function zeroMessageUsage(): MessageUsage {
  return { ...zeroUsage(), cacheCreate1h: 0, cacheCreate5m: 0 };
}

function addMessageUsage(totals: MessageUsage, u: MessageUsage): void {
  totals.input += u.input;
  totals.output += u.output;
  totals.cacheRead += u.cacheRead;
  totals.cacheCreate += u.cacheCreate;
  totals.cacheCreate1h += u.cacheCreate1h;
  totals.cacheCreate5m += u.cacheCreate5m;
}

/** How much of a plan the Plans page needs to show to make it recognisable. */
const PLAN_PREVIEW_CHARS = 300;

/**
 * Fill in a plan's text, and index it.
 *
 * This is the ONE deliberate exception to "tool calls are never indexed", and
 * it is worth stating why: that rule exists because tool OUTPUT is 34% of the
 * bytes in this corpus and indexing it would take the cache from 6.5 MB to
 * ~250 MB. Plans are 16 documents and a quarter of a megabyte — and they are
 * the highest-value prose a session holds, the design decision every answer
 * after it rests on. Leaving them findable only behind the deep-scan button was
 * the wrong trade in both directions.
 *
 * The anchor is the CALL, not the message: one assistant message can hold
 * several calls, and `?tool=` is what opens the right plan.
 */
function fillPlanText(record: PlanRecord, text: string, searchBlocks: SearchBlock[]): void {
  record.chars = text.length;
  record.title = planTitle(text);
  record.preview = text.slice(0, PLAN_PREVIEW_CHARS);
  searchBlocks.push({ uuid: record.uuid, role: PLAN_ROLE, text, toolUseId: record.toolUseId });
}

/** The UTC day a line belongs to — the key of the stats buckets. */
function dayOf(o: Record<string, unknown>): string | null {
  const ts = str(o.timestamp);
  return ts && ts.length >= 10 ? ts.slice(0, 10) : null;
}

/** What the agents of one session spent, ready to be stored beside its own usage. */
export interface SubagentSpend {
  usage: MessageUsage;
  byModel: Record<string, MessageUsage>;
  /** day (UTC) → model → usage, to be merged into the session's daily buckets. */
  daily: Record<string, Record<string, MessageUsage>>;
  /** The agents themselves, so their ids can be searched for like a session's. */
  ids: string[];
}

function emptySpend(): SubagentSpend {
  return { usage: zeroMessageUsage(), byModel: {}, daily: {}, ids: [] };
}

/**
 * Every `subagents/agent-*.jsonl` of a session, totalled.
 *
 * These are separate API conversations that appear nowhere in the parent
 * transcript, so this is the only way the session's real cost can be known —
 * and it is not a rounding error: one session here shows $1.49 of its own and
 * spent $10.53 through 11 agents.
 *
 * The rules are the parser's, because the drawer prices the same messages from
 * the parsed turns and the two figures are compared: one usage per `message.id`
 * (streamed chunks repeat it verbatim), taken from the FIRST line carrying it,
 * `<synthetic>` excluded, replayed lines dropped. `toMessageUsage` is shared
 * with the parser outright so the TTL split cannot drift.
 */
export async function enrichSubagents(sessionDir: string | null): Promise<SubagentSpend> {
  const spend = emptySpend();
  if (!sessionDir) return spend;
  let files: string[];
  try {
    files = (await fsp.readdir(path.join(sessionDir, 'subagents'))).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return spend; // no subagents dir: the usual case
  }

  for (const file of files) {
    spend.ids.push(file.slice('agent-'.length, -'.jsonl'.length));
    const isReplay = replayFilter();
    const seenMessageIds = new Set<string>();
    try {
      for await (const line of streamLines(path.join(sessionDir, 'subagents', file))) {
        const o = safeParse(line);
        if (!o || isReplay(o)) continue;
        if (str(o.type) !== 'assistant' || !isRec(o.message)) continue;
        const model = str(o.message.model);
        const messageId = str(o.message.id);
        if (!model || model === '<synthetic>' || !messageId || seenMessageIds.has(messageId)) continue;
        if (!isRec(o.message.usage)) continue;
        seenMessageIds.add(messageId);
        const usage = toMessageUsage(o.message.usage);
        addMessageUsage(spend.usage, usage);
        addMessageUsage((spend.byModel[model] ??= zeroMessageUsage()), usage);
        const day = dayOf(o);
        if (day) addMessageUsage(((spend.daily[day] ??= {})[model] ??= zeroMessageUsage()), usage);
      }
    } catch {
      // An agent's transcript being written while we read it is not a reason to
      // lose the rest of them; the next enrich picks the file up again.
    }
  }
  return spend;
}

/**
 * Full single-pass parse of one transcript: exact counts, token totals
 * (assistant lines deduped by message.id — streamed turns repeat the usage
 * object), PR links, fork ancestry and extracted text for full-text search.
 */
export async function enrichSession(
  filePath: string,
  sessionId: string,
  /** `<projectDir>/<sessionUuid>`, when the session has one: where its agents' transcripts live. */
  sessionDir: string | null = null,
): Promise<EnrichData> {
  const usage = zeroUsage();
  const carriedOverUsage = zeroUsage();
  const usageByModel: Record<string, UsageTotals> = {};
  const models = new Set<string>();
  const prLinks: PrLink[] = [];
  const runIds = new Set<string>();
  let forkedFrom: string | null = null;
  const seenMessageIds = new Set<string>();
  const promptIds = new Set<string>();
  const searchBlocks: SearchBlock[] = [];
  /** `ExitPlanMode` calls by tool_use id, so a later result line can answer them. */
  const plans = new Map<string, PlanRecord>();
  const prSeen = new Set<string>();
  const daily: Record<string, DailyUsage> = {};
  const isReplay = replayFilter();
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolUseCount = 0;
  let compactionCount = 0;
  // The previous REQUEST, for the cache arithmetic — see `shared/src/recache.ts`.
  // It must stay in step with `buildContextIndex` in the viewer: both take a
  // request to be the first line of a `message.id` that carries usage, both let
  // a carried-over line be the predecessor of the next one, and neither counts
  // an event on a carried-over line itself.
  let previous: (CacheState & { messageId: string; model: string; runId: string | null; ts: number | null }) | null =
    null;
  let compactedSinceLastRequest = false;

  const dayBucket = (day: string): DailyUsage =>
    (daily[day] ??= { prompts: 0, byModel: {}, recachedByModel: {}, recacheEvents: 0, subagentByModel: {} });

  for await (const line of streamLines(filePath)) {
    const o = safeParse(line);
    if (!o) continue;
    const type = str(o.type);

    if (type === 'pr-link') {
      // Sidecar lines are re-appended over the session's life — dedupe.
      const prNumber = num(o.prNumber);
      const prUrl = str(o.prUrl);
      if (prNumber !== null && prUrl && !prSeen.has(prUrl)) {
        prSeen.add(prUrl);
        prLinks.push({ prNumber, prUrl, prRepository: str(o.prRepository) ?? '' });
      }
      continue;
    }

    // A line already counted, re-appended by a compaction (see `replayFilter`).
    // The token totals survived it by luck — they dedupe by `message.id` — but
    // the prompts, the tool calls, the compactions and the daily buckets did
    // not, and neither did the indexed text.
    if (isReplay(o)) continue;

    // `session_id` names the RUN that wrote the line, NOT an ancestor: resuming
    // from a fresh CLI stamps that CLI's id on everything it appends here. The
    // real ancestry is `forkedFrom`, and only a fork has one.
    const runId = str(o.session_id);
    if (runId && runId !== sessionId) runIds.add(runId);
    const fork = isRec(o.forkedFrom) ? str(o.forkedFrom.sessionId) : null;
    if (fork && fork !== sessionId) forkedFrom ??= fork;
    // A line `/branch` copied from the parent. It counts as content — it is
    // rendered and searchable — but every AGGREGATE belongs to the parent, which
    // already billed it and already counted its prompt on its own day.
    const carried = fork !== null;
    const promptId = str(o.promptId);
    if (promptId) promptIds.add(promptId);

    if (type === 'user') {
      // A line Claude Code injected (a background command reporting back) is not
      // a prompt and is not indexed: it is tool output wearing the user role, and
      // tool output never enters the corpus — see docs/AI_SEARCH.md.
      if (
        o.isMeta !== true &&
        isRec(o.message) &&
        typeof o.message.content === 'string' &&
        injectedOrigin(o) === null
      ) {
        const prompt = extractPrompt(o.message.content);
        if (prompt) {
          userMessageCount++;
          const day = dayOf(o);
          if (day && !carried) dayBucket(day).prompts++;
          searchBlocks.push({ uuid: str(o.uuid), role: 'user', text: prompt.text });
        }
      }
      // The verdict on a plan comes back on the result line, which is a `user`
      // line carrying an array. Both flavours are read the way `toPlanOutcome`
      // reads them: the TYPE of `toolUseResult` is the answer.
      if (isRec(o.message) && Array.isArray(o.message.content)) {
        for (const block of o.message.content) {
          if (!isRec(block) || block.type !== 'tool_result') continue;
          const plan = plans.get(str(block.tool_use_id) ?? '');
          if (!plan) continue;
          plan.decidedAt = str(o.timestamp);
          if (isRec(o.toolUseResult)) {
            plan.status = 'approved';
            plan.filePath = str(o.toolUseResult.filePath);
            // A newer CLI sends no `input.plan`, so the approved result may be
            // the only copy of the text there is.
            const text = str(o.toolUseResult.plan);
            if (text && !plan.chars) fillPlanText(plan, text, searchBlocks);
          } else if (typeof o.toolUseResult === 'string') {
            plan.status = 'rejected';
            plan.feedback = planFeedback(o.toolUseResult, o);
          }
        }
      }
    } else if (type === 'attachment') {
      // A prompt typed while Claude was working arrives in its own envelope and
      // nowhere else (see `queuedPrompt`), so it has to be counted and indexed
      // from here or it is a prompt no search can reach: 4 in this corpus, one
      // of which the Prompts page listed — `history.jsonl` keeps them — while
      // its own session showed nothing.
      const typed = queuedPrompt(o);
      const prompt = typed ? extractPrompt(typed) : null;
      if (prompt) {
        userMessageCount++;
        const day = dayOf(o);
        if (day && !carried) dayBucket(day).prompts++;
        searchBlocks.push({ uuid: str(o.uuid), role: 'user', text: prompt.text });
      }
    } else if (type === 'assistant' && isRec(o.message)) {
      const model = str(o.message.model);
      const messageId = str(o.message.id);
      if (model && model !== '<synthetic>') models.add(model);
      const lineTime = str(o.timestamp) ? Date.parse(str(o.timestamp) as string) : null;
      if (messageId && !seenMessageIds.has(messageId)) {
        seenMessageIds.add(messageId);
        assistantMessageCount++;
        if (model && model !== '<synthetic>' && isRec(o.message.usage)) {
          if (carried) {
            addUsage(carriedOverUsage, o.message.usage);
          } else {
            addUsage(usage, o.message.usage);
            addUsage((usageByModel[model] ??= zeroUsage()), o.message.usage);
            const day = dayOf(o);
            if (day) {
              const bucket = dayBucket(day);
              addUsage((bucket.byModel[model] ??= zeroUsage()), o.message.usage);
            }
          }

          const current: CacheState = {
            read: num(o.message.usage.cache_read_input_tokens) ?? 0,
            write: num(o.message.usage.cache_creation_input_tokens) ?? 0,
          };
          // A fork's copies were billed in the parent, so what they re-wrote is
          // the parent's story — but they still describe the cache the next
          // request met, which is why they stay eligible as a predecessor.
          const event =
            previous && !carried
              ? recacheOf(previous, current, {
                  compactedBetween: compactedSinceLastRequest,
                  modelChanged: previous.model !== model,
                  // Only a change between two KNOWN runs is a change: a line
                  // written before any request went out carries no `session_id`.
                  runChanged: previous.runId !== null && runId !== null && previous.runId !== runId,
                  gapMs:
                    previous.ts !== null && lineTime !== null && !Number.isNaN(lineTime)
                      ? Math.max(0, lineTime - previous.ts)
                      : null,
                })
              : null;
          if (event) {
            const day = dayOf(o);
            if (day) {
              const bucket = dayBucket(day);
              bucket.recachedByModel[model] = (bucket.recachedByModel[model] ?? 0) + event.tokens;
              bucket.recacheEvents++;
            }
          }
          previous = { ...current, messageId, model, runId, ts: Number.isNaN(lineTime) ? null : lineTime };
          compactedSinceLastRequest = false;
        }
      } else if (previous && messageId === previous.messageId && lineTime !== null && !Number.isNaN(lineTime)) {
        // A later chunk of the same answer: the gap to the NEXT request starts
        // when this one finished, not when its first line was written. Same as
        // the viewer, which measures from `endTimestamp`.
        previous.ts = lineTime;
      }
      // Streamed chunks of one message land on separate lines, each carrying
      // distinct content blocks — collect from every line (blocks never repeat).
      if (Array.isArray(o.message.content)) {
        for (const block of o.message.content) {
          if (!isRec(block)) continue;
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            searchBlocks.push({ uuid: str(o.uuid), role: 'assistant', text: block.text });
          } else if (block.type === 'tool_use') {
            toolUseCount++;
            if (block.name === 'ExitPlanMode') {
              const toolUseId = str(block.id);
              if (toolUseId && !plans.has(toolUseId)) {
                const record: PlanRecord = {
                  toolUseId,
                  uuid: str(o.uuid),
                  askedAt: str(o.timestamp),
                  decidedAt: null,
                  status: 'pending',
                  title: null,
                  preview: '',
                  chars: 0,
                  filePath: null,
                  feedback: null,
                };
                const text = isRec(block.input) ? str(block.input.plan) : null;
                if (text) fillPlanText(record, text, searchBlocks);
                plans.set(toolUseId, record);
              }
            }
          }
        }
      }
    } else if (type === 'system' && str(o.subtype) === 'compact_boundary') {
      compactionCount++;
      // The context after a boundary is new and smaller, not the old one written
      // twice — charging it as a re-cache would bill the user for a saving.
      compactedSinceLastRequest = true;
    }
  }

  // The agents' own conversations, which this file records nowhere. Their days
  // are their own — an agent can still be working when midnight passes — so they
  // land in the bucket their timestamps name, creating it if this session wrote
  // nothing that day.
  const subagents = await enrichSubagents(sessionDir);
  for (const [day, byModel] of Object.entries(subagents.daily)) {
    dayBucket(day).subagentByModel = byModel;
  }

  return {
    enrichment: {
      userMessageCount,
      assistantMessageCount,
      toolUseCount,
      turnCount: promptIds.size,
      compactionCount,
      usage,
      usageByModel,
      subagentUsage: subagents.usage,
      subagentUsageByModel: subagents.byModel,
      subagentIds: subagents.ids,
      daily,
      models: [...models].sort(),
      plans: [...plans.values()],
      prLinks,
      forkedFrom,
      carriedOverUsage,
      runIds: [...runIds],
    },
    searchBlocks,
  };
}
