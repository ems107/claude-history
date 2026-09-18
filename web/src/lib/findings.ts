import type { ContentBlock } from '@claude-history/shared';

type ToolBlockType = Extract<ContentBlock, { kind: 'tool' }>;

/** One thing a review found: where it is, what it is, and how it breaks. */
export interface Finding {
  /** As the review wrote it — repo-relative here, resolved against the session's cwd. */
  file: string;
  line: number | null;
  /** `correctness`, `simplification`, `documentation`… free-form by contract. */
  category: string | null;
  /** The compressed label. Capped at 60 characters by the tool's own schema. */
  shortSummary: string | null;
  summary: string;
  failureScenario: string;
  /** Only when a verify pass ran; absent on inline-only reviews. */
  verdict: string | null;
  /** Only when the findings were re-reported after applying fixes. */
  outcome: string | null;
}

export interface Findings {
  /**
   * In the order the call wrote them, which IS the ranking: the tool's contract
   * is "most-severe first", and there is no severity field to sort on.
   */
  findings: Finding[];
  /** The effort the review ran at (`low`…`max`), when it said. */
  level: string | null;
  /** The harness refused the report — it was never delivered. */
  rejected: boolean;
  /** Why, in one line, for the face of the card. */
  rejection: string | null;
  /** No result yet: a real state, not a missing one. */
  pending: boolean;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** The one line of a rejection worth putting on a chip's hover. */
function rejectionLine(text: string): string | null {
  const first = text
    .replace(/<\/?tool_use_error>/g, '')
    .trim()
    .split('\n')[0];
  // One class, not a sequence: the tail is `: [`, so the space between the two
  // has to be eaten along with them.
  return first.replace(/[\s[{:]+$/, '').trim() || null;
}

/**
 * The findings of a `ReportFindings` call, or null for every other tool.
 *
 * Pure and free of the DOM for the reason `parsePlan` is: the card and the
 * markdown export read a review the same way, and the two must never disagree
 * about what was found.
 *
 * Everything comes off the CALL. Unlike a question or a delivery, the result
 * carries nothing worth reading — `N findings reported.` and a `toolUseResult`
 * that is a normalised copy of the input — so nothing is joined and nothing new
 * reaches `ToolResultInfo` on the server. What the result decides is the STATE:
 * `is_error` means the harness rejected the report (a `short_summary` over its
 * 60-character cap is how that happens), and a call with two nearly identical
 * reports in a row is a review that was rejected once and retried. Drawing both
 * without saying which is which is how a reader counts 24 findings where there
 * were 12.
 */
export function parseFindings(block: ToolBlockType): Findings | null {
  if (block.toolName !== 'ReportFindings') return null;
  const input = block.input as { findings?: unknown; level?: unknown } | null;
  const raw = input?.findings;
  // The array is the call. Without one there is nothing to draw — and an EMPTY
  // one is not that case: the tool spells it "empty array if nothing survived
  // verification", which is a review that ran and cleared the diff.
  if (!Array.isArray(raw)) return null;

  const findings: Finding[] = [];
  for (const f of raw) {
    if (typeof f !== 'object' || f === null) continue;
    const r = f as Record<string, unknown>;
    const file = str(r.file);
    if (!file) continue;
    findings.push({
      file,
      line: typeof r.line === 'number' && Number.isFinite(r.line) ? r.line : null,
      category: str(r.category),
      shortSummary: str(r.short_summary),
      summary: str(r.summary) ?? '',
      failureScenario: str(r.failure_scenario) ?? '',
      // Absent in every finding of this corpus. Read as optional rather than
      // defaulted: a verdict nobody reached must not read as one that was.
      verdict: str(r.verdict),
      outcome: str(r.outcome),
    });
  }

  const result = block.result;
  const rejected = result?.isError === true;
  return {
    findings,
    level: str(input?.level),
    rejected,
    // The whole error is a Zod dump of up to 760 characters; the card wants the
    // sentence that names it. The first line of one ends where the JSON opens
    // (`InputValidationError: [`), so the opening bracket goes with it.
    rejection: rejected ? rejectionLine(result.text) : null,
    pending: !result,
  };
}
