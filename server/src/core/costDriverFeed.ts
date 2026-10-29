import type { CostDriverTracker } from '@claude-history/shared';
import { isRec, str, type RawLine } from './jsonl.ts';

/** A tool result's text, the way the parser measures one (`ToolResultInfo.totalChars`). */
function resultChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  const texts = content.filter((c) => isRec(c) && c.type === 'text' && typeof c.text === 'string');
  return texts.reduce((n, c) => n + (c.text as string).length, 0) + Math.max(0, texts.length - 1);
}

/**
 * Everything a cost-driver tracker needs from a line that is not a request:
 * the tool results that came back, and the text sent before the first request.
 * The parser and the enricher both call this on every line they keep, and the
 * request itself where each counts a `message.id` — so the two read the same
 * lines the same way, and the session's panel and the Stats page agree.
 *
 * The preamble is what `/usage` subtracts from the first context to estimate the
 * always-on part: the files attached before the first request, by line length,
 * and — here also — the typed prompt itself, which is no more "always on" than
 * a file is.
 */
export function feedCostDrivers(tracker: CostDriverTracker, o: RawLine, line: string): void {
  const type = str(o.type);
  if (type === 'user' && isRec(o.message)) {
    const content = o.message.content;
    if (typeof content === 'string') {
      if (o.isMeta !== true) tracker.preamble(content.length);
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (isRec(c) && c.type === 'tool_result') tracker.toolResult(str(c.tool_use_id) ?? '', resultChars(c.content));
      }
    }
  } else if (type === 'attachment' && isRec(o.attachment) && o.attachment.type === 'file') {
    tracker.preamble(line.length);
  }
}
