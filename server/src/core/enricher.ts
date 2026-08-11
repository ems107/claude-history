import type { DailyUsage, PrLink, SessionEnrichment, UsageTotals } from '@claude-history/shared';
import { isRec, num, safeParse, str, streamLines } from './jsonl.ts';
import { extractPrompt } from './summarizer.ts';

export interface SearchBlock {
  uuid: string | null;
  role: string;
  text: string;
}

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

/**
 * Full single-pass parse of one transcript: exact counts, token totals
 * (assistant lines deduped by message.id — streamed turns repeat the usage
 * object), PR links, resume ancestry and extracted text for full-text search.
 */
export async function enrichSession(filePath: string, sessionId: string): Promise<EnrichData> {
  const usage = zeroUsage();
  const usageByModel: Record<string, UsageTotals> = {};
  const models = new Set<string>();
  const prLinks: PrLink[] = [];
  const originSessionIds = new Set<string>();
  const seenMessageIds = new Set<string>();
  const promptIds = new Set<string>();
  const searchBlocks: SearchBlock[] = [];
  const prSeen = new Set<string>();
  const daily: Record<string, DailyUsage> = {};
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolUseCount = 0;
  let compactionCount = 0;

  const dayOf = (o: Record<string, unknown>): string | null => {
    const ts = str(o.timestamp);
    return ts && ts.length >= 10 ? ts.slice(0, 10) : null;
  };
  const dayBucket = (day: string): DailyUsage => (daily[day] ??= { prompts: 0, byModel: {} });

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

    const originId = str(o.session_id);
    if (originId) originSessionIds.add(originId);
    const promptId = str(o.promptId);
    if (promptId) promptIds.add(promptId);

    if (type === 'user') {
      if (o.isMeta !== true && isRec(o.message) && typeof o.message.content === 'string') {
        const prompt = extractPrompt(o.message.content);
        if (prompt) {
          userMessageCount++;
          const day = dayOf(o);
          if (day) dayBucket(day).prompts++;
          searchBlocks.push({ uuid: str(o.uuid), role: 'user', text: prompt.text });
        }
      }
    } else if (type === 'assistant' && isRec(o.message)) {
      const model = str(o.message.model);
      const messageId = str(o.message.id);
      if (model && model !== '<synthetic>') models.add(model);
      if (messageId && !seenMessageIds.has(messageId)) {
        seenMessageIds.add(messageId);
        assistantMessageCount++;
        if (model && model !== '<synthetic>' && isRec(o.message.usage)) {
          addUsage(usage, o.message.usage);
          addUsage((usageByModel[model] ??= zeroUsage()), o.message.usage);
          const day = dayOf(o);
          if (day) {
            const bucket = dayBucket(day);
            addUsage((bucket.byModel[model] ??= zeroUsage()), o.message.usage);
          }
        }
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
          }
        }
      }
    } else if (type === 'system' && str(o.subtype) === 'compact_boundary') {
      compactionCount++;
    }
  }

  originSessionIds.delete(sessionId);

  return {
    enrichment: {
      userMessageCount,
      assistantMessageCount,
      toolUseCount,
      turnCount: promptIds.size,
      compactionCount,
      usage,
      usageByModel,
      daily,
      models: [...models].sort(),
      prLinks,
      resumedFrom: [...originSessionIds],
    },
    searchBlocks,
  };
}
