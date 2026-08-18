// Naming the `system` lines of a transcript.
//
// A system line's `subtype` is an internal identifier, and it was being printed
// raw on the chip beside the text — AWAY_SUMMARY, LOCAL_COMMAND. The most
// valuable of them was also the most cryptically labelled, which is the whole
// reason this file exists.
//
// The map is deliberately small. Only three of the subtypes in this corpus ever
// reach a reader: the other two carry no `content` at all (`stop_hook_summary`
// keeps its report in `hookInfos`, `api_error` in `error`), so `parser.ts` drops
// them before this is ever asked. See docs/AI_TRANSCRIPTS.md.

import { RECAP_SUBTYPE } from '@claude-history/shared';

/**
 * What to call each `system` subtype on screen. Anything absent keeps its raw
 * subtype: an honest identifier beats a label invented for a line nobody here
 * has ever seen.
 */
const SYSTEM_LABEL: Record<string, string> = {
  // Claude Code's own word for it — its config offers to "disable recaps", and
  // its logs call the job `ccr_recap_generate`. Never "away summary": the
  // setting behind it is `awaySummaryEnabled`, but nothing the user reads says
  // that. The identifier comes from `shared`, which is also where the rule that
  // a recap is drawn whole lives (`systemChars`).
  [RECAP_SUBTYPE]: 'Recap',
  local_command: 'Command',
  informational: 'Notice',
};

/**
 * Why a recap says what it says, and why there is not one per turn. Worth a
 * tooltip because both halves surprise a reader: it is written for someone who
 * walked away, and Claude Code skips it whenever it is busy or short of budget.
 */
const SYSTEM_TITLE: Record<string, string> = {
  [RECAP_SUBTYPE]:
    "Claude Code's own recap of where the work had got to, written at the end of a turn for whoever comes back to it. Not one per turn: it is skipped near a rate limit, while background work or a queued prompt is pending, and whenever the next turn has already started.",
};

export function systemLabel(subtype: string | null): string {
  if (!subtype) return 'system';
  return SYSTEM_LABEL[subtype] ?? subtype;
}

export function systemTitle(subtype: string | null): string | undefined {
  return subtype ? SYSTEM_TITLE[subtype] : undefined;
}
