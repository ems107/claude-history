import {
  occurrences,
  type SearchMode,
  type SearchWordScope,
  SNIPPET_AFTER,
  SNIPPET_BEFORE,
} from '@claude-history/shared';

// Finding a term is shared with the web (the viewer marks the words a search
// landed on, and its find bar scans a corpus of its own), so it lives in
// `@claude-history/shared` and is re-exported here — the server's search paths
// were written against this module.
export {
  buildSnippet,
  hasTerm,
  occurrences,
  oneLine,
  parseTerms,
  type SearchBlock,
  RECAP_SUBTYPE,
  SNIPPET_AFTER,
  SNIPPET_BEFORE,
  systemChars,
} from '@claude-history/shared';

export interface SearchOptions {
  /** Restricts where to look: any subset of 'title' | 'user' | 'assistant'. */
  roles?: Set<string>;
  mode?: SearchMode;
  scope?: SearchWordScope;
  wholeWord?: boolean;
}

/** The role of the block holding a session's own id — see `matchesSessionIds`. */
export const ID_ROLE = 'id';

/**
 * The role of a plan submitted with `ExitPlanMode` — one of the two pieces of
 * tool traffic that ARE indexed, see `fillPlanText`.
 *
 * It needs no rule of its own here: a request restricting the search to titles,
 * prompts or responses names those roles explicitly, so `skipBlock` already
 * leaves a plan out of `in=user` — which is right, since a plan is not
 * something the user wrote.
 */
export const PLAN_ROLE = 'plan';

/**
 * The other one: what the model said it was doing when it made a call
 * (`toolIntent`) — the `description` of every Bash and PowerShell call and the
 * `activeForm` of a task.
 *
 * Same argument as the plan, and the same escape from the size rule that keeps
 * tool traffic out: this is ~5,000 short lines of prose across the corpus, not
 * the 34% of the bytes that tool OUTPUT is. It carries the call's `toolUseId`,
 * so a hit opens the call it describes and not merely the session; and like a
 * plan it stays out of `in=user`, being nothing the user wrote.
 */
export const INTENT_ROLE = 'intent';

/**
 * And the role of a recap: the `away_summary` system line Claude Code writes at
 * the end of a turn, for whoever comes back to the session
 * ([AI_TRANSCRIPTS.md](../../../docs/AI_TRANSCRIPTS.md)).
 *
 * Not tool traffic at all — the rule this escapes is a different one, that a
 * `system` line is plumbing. A recap is the opposite: 148 of them here, 38 KB,
 * and each is the one paragraph in a session that says what the session was
 * FOR. It carries no `toolUseId`, only the line's own uuid, which is what
 * `SystemItem` puts on its `id` and `locate` already holds.
 *
 * **Indexed as far as `systemChars` allows, which for a recap is all of it.**
 * The cut still governs every other subtype, and the rule behind it is the one
 * that matters: never index past where the viewer will DRAW it. A recap escapes
 * by being drawn whole, not by being searched further than it is shown.
 */
export const RECAP_ROLE = 'recap';

/**
 * Whether this query may look at session ids at all. The app writes ids as
 * their first eight characters (fork chips, lineage, the log), so pasting one
 * back has to find the session — but a uuid is 32 hex characters, and an
 * ordinary word made of a-f and digits ("cafe", "cada", "added") would drag in
 * whatever session happens to carry those letters somewhere inside its id, in a
 * row nobody was looking for. So: hex only, dashes allowed (they are part of a
 * pasted uuid) and four characters at the least.
 */
export function matchesSessionIds(terms: string[]): boolean {
  return terms.some((t) => /^[0-9a-f-]+$/.test(t) && t.replace(/-/g, '').length >= 4);
}

/**
 * Whether a scan must skip this block: the role restriction the request asked
 * for, plus the id rule above. One predicate for all four scan loops — the
 * search, the deep scan and the two paged match lists — because they have to
 * agree to the unit: a hit counting an id that its own "+N more matches" page
 * cannot find is a count that never reaches zero.
 */
export function skipBlock(role: string, roles: Set<string> | undefined, ids: boolean): boolean {
  if (roles && !roles.has(role)) return true;
  return role === ID_ROLE && !ids;
}

/** One place a query matched, as folded offsets, with the occurrences it accounts for. */
export interface MatchWindow {
  from: number;
  to: number;
  /** Occurrences assigned to this window; every one belongs to exactly one. */
  matches: number;
}

/**
 * EVERY place `terms` matched inside one folded block, in order — what the
 * search itself deliberately does not enumerate (it takes three anchors and
 * counts the rest) and what paging through a hit's matches needs.
 *
 * An occurrence is assigned to the first window that fully covers it, so the
 * windows' figures add up to the block's match count exactly. That is the whole
 * point: without it "showing 20 of 51 matches" could never reach 51, and the
 * fold would keep offering more of something already shown.
 *
 * Only the last window is tested for coverage, not all of them: the anchors
 * arrive sorted, so an earlier window can only reach further right when a long
 * term preceded a short one. Missing that case costs one extra window, never a
 * double count — and it keeps this linear on a block with thousands of matches.
 */
export function matchWindows(folded: string, terms: string[], wholeWord: boolean): MatchWindow[] {
  const found: Array<{ idx: number; len: number }> = [];
  for (const term of terms) {
    for (const idx of occurrences(folded, term, wholeWord)) found.push({ idx, len: term.length });
  }
  found.sort((a, b) => a.idx - b.idx || a.len - b.len);

  const windows: MatchWindow[] = [];
  for (const { idx, len } of found) {
    const last = windows[windows.length - 1];
    // Covered means "buildSnippet would mark it inside that window": the whole
    // occurrence has to fit, or it is a match the reader cannot see.
    if (last && idx >= last.from && idx + len <= last.to) {
      last.matches++;
      continue;
    }
    windows.push({
      from: Math.max(0, idx - SNIPPET_BEFORE),
      to: Math.min(folded.length, idx + len + SNIPPET_AFTER),
      matches: 1,
    });
  }
  return windows;
}
