import type { ContextCategory, ContextSnapshot } from '@claude-history/shared';

/**
 * Recover a `/context` run from the transcript.
 *
 * Claude Code prints the window as an ANSI grid AND re-injects the same figures
 * into the conversation as an isMeta `user` line in clean markdown — which is
 * what this reads. That line is the only record of the context window size, of
 * the `[1m]` model marker (`message.model` never carries it) and of the
 * per-category split; and it only exists where the user actually ran the
 * command, so everything here is a snapshot of one instant, never a series.
 *
 * The heading looks like:
 *   ## Context Usage
 *   **Model:** claude-fable-5
 *   **Tokens:** 469.1k / 1m (47%)
 *   ### Estimated usage by category
 *   | Category | Tokens | Percentage |
 *   | System prompt | 3.9k | 0.4% |
 *   ### MCP Tools
 *   | Tool | Server | Tokens |
 *   | mcp__jira-pccom__get_issue | jira-pccom | 286 |
 *
 * Figures are rounded to 0.1k by Claude Code, so they are display values: the
 * exact prompt size of any request is `usage.input + cache_read + cache_create`,
 * which agrees with the reported total to within that rounding (12-35 tokens
 * over four snapshots).
 */

export const CONTEXT_USAGE_HEADING = '## Context Usage';

/** "469.1k" -> 469100, "1m" -> 1000000, "286" -> 286. */
function parseTokenAmount(raw: string): number | null {
  const m = /^([\d,]+(?:\.\d+)?)\s*([kmKM])?$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = m[2]?.toLowerCase();
  return Math.round(unit === 'k' ? n * 1000 : unit === 'm' ? n * 1_000_000 : n);
}

/** Deferred rows are potential tools, not loaded ones — they inflate the sum. */
function isDeferred(label: string): boolean {
  return /\(deferred\)/i.test(label);
}

export function parseContextSnapshot(markdown: string): ContextSnapshot | null {
  if (!markdown.startsWith(CONTEXT_USAGE_HEADING)) return null;

  const header = /\*\*Tokens:\*\*\s*([\d.,]+[kmKM]?)\s*\/\s*([\d.,]+[kmKM]?)\s*(?:\((\d+)%\))?/.exec(markdown);
  const categories: ContextCategory[] = [];
  for (const row of markdown.matchAll(/^\|\s*([A-Za-z][^|]*?)\s*\|\s*([\d.,]+[kmKM]?)\s*\|\s*([\d.]+)%\s*\|\s*$/gm)) {
    const label = row[1].trim();
    if (/^category$/i.test(label)) continue; // header row
    const tokens = parseTokenAmount(row[2]);
    if (tokens === null) continue;
    categories.push({ label, tokens, pct: Number(row[3]), deferred: isDeferred(label) });
  }

  const mcpTools: ContextSnapshot['mcpTools'] = [];
  for (const row of markdown.matchAll(/^\|\s*(mcp__[^|\s]+)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*$/gm)) {
    mcpTools.push({ tool: row[1], server: row[2].trim(), tokens: Number(row[3]) });
  }

  // A snapshot with neither a total nor a single category is not one — better to
  // leave the raw line alone than to render an empty panel.
  const reportedTokens = header ? parseTokenAmount(header[1]) : null;
  if (reportedTokens === null && categories.length === 0) return null;

  return {
    model: /\*\*Model:\*\*\s*(\S+)/.exec(markdown)?.[1] ?? null,
    reportedTokens,
    limitTokens: header ? parseTokenAmount(header[2]) : null,
    reportedPct: header?.[3] ? Number(header[3]) : null,
    categories,
    mcpTools,
  };
}

/**
 * Is this the ANSI grid `/context` also writes to stdout? It carries the same
 * figures as the markdown line, in escape codes the viewer can only render as
 * noise, so it is dropped once the markdown parses. ESC is built with
 * String.fromCharCode(27) and never typed as a literal control character: this
 * repo has already shipped a stray NUL byte in a source file once.
 */
export function isContextUsageAnsi(text: string): boolean {
  const esc = String.fromCharCode(27);
  return text.includes('Context Usage') && text.includes(esc + '[');
}
