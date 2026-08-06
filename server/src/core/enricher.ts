import type { PrLink, SessionEnrichment, UsageTotals } from '@claude-history/shared';
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
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for await (const line of streamLines(filePath)) {
    const o = safeParse(line);
    if (!o) continue;
    const type = str(o.type);

    if (type === 'pr-link') {
      const prNumber = num(o.prNumber);
      const prUrl = str(o.prUrl);
      if (prNumber !== null && prUrl) {
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
        }
      }
      // Streamed chunks of one message land on separate lines, each carrying
      // distinct content blocks — collect text from every line.
      if (Array.isArray(o.message.content)) {
        for (const block of o.message.content) {
          if (isRec(block) && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            searchBlocks.push({ uuid: str(o.uuid), role: 'assistant', text: block.text });
          }
        }
      }
    }
  }

  originSessionIds.delete(sessionId);

  return {
    enrichment: {
      userMessageCount,
      assistantMessageCount,
      turnCount: promptIds.size,
      usage,
      usageByModel,
      models: [...models].sort(),
      prLinks,
      resumedFrom: [...originSessionIds],
    },
    searchBlocks,
  };
}
