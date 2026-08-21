// Searching the conversation the browser already holds.
//
// The find bar cannot scan the DOM, because the DOM is the half of the
// conversation that happens to be unfolded — which is exactly the complaint
// Ctrl+F earns. So it scans the data instead, and the rule that keeps the two
// honest is:
//
//   what the bar counts is what unfolding can put inside a marking box.
//
// A marking box is `[data-bubble-body]` or `[data-tool-id]`: the two elements
// `markMatches` knows how to paint, and the two that keep marks off headers,
// clocks and cost pills. One unit here IS one box there, so a hit always has
// somewhere to land, and anything drawn outside a box (a /context table, a
// compaction's arithmetic, a plan-mode marker) is neither scanned nor counted.
//
// Everything below the fold is `@claude-history/shared`, so the bar's idea of a
// match cannot drift from the server's.

import {
  buildSnippet,
  foldText,
  foldWithMap,
  occurrences,
  type ContentBlock,
  type MessageItem,
  type SearchSnippet,
  SNIPPET_AFTER,
  SNIPPET_BEFORE,
  systemChars,
  type Turn,
} from '@claude-history/shared';
import type { MatchHighlight } from './highlight.ts';

/**
 * What kind of text a match sits in. It is NOT the server's set of roles: this
 * corpus is the page's memory, not the index, so it holds thinking and tool
 * output — which the index never carries — and no session or agent ids, which
 * mean nothing here.
 */
export type FindRole = 'user' | 'assistant' | 'thinking' | 'tool' | 'plan' | 'notice' | 'system';

/** In the order the filter chips are drawn. */
export const FIND_ROLES: readonly FindRole[] = [
  'user',
  'assistant',
  'thinking',
  'tool',
  'plan',
  'notice',
  'system',
];

export const ROLE_LABEL: Record<FindRole, string> = {
  user: 'Prompts',
  assistant: 'Answers',
  thinking: 'Thinking',
  tool: 'Tools',
  plan: 'Plans',
  notice: 'Notices',
  system: 'System',
};

/**
 * How much of a `system` line is drawn, and therefore how much of it this
 * corpus holds — counting a match nothing can show is the one thing this whole
 * feature exists to stop. It moved to `shared` when the SERVER grew a reason to
 * know it (a recap is indexed, and the index must not claim more of one than
 * `SystemItem` will draw); re-exported because this module is where `SystemItem`
 * and the bar were written to read it from.
 */
export { systemChars };
/**
 * A one-character phrase matches a hundred thousand times in a big session, and
 * `parseTerms` applies no minimum length in phrase mode. The scan stops here and
 * the bar says it did — a partial answer must never read as a complete one.
 */
export const MAX_FIND_HITS = 5000;

/** Why a unit's text is not all of what the tool really produced. */
export type ShortText = 'truncated' | 'offloaded';

/** One marking box, and the text it will hold once everything inside it is open. */
export interface FindUnit {
  /** `?msg=` — always the canonical uuid, the one `Bubble` puts on its `id`. */
  uuid: string;
  /** `?tool=` when the box is a tool block; null when it is a bubble body. */
  toolUseId: string | null;
  /** The pieces, joined by a newline and trimmed, in the order they are drawn. */
  raw: string;
  /** `foldText(raw)`, kept; the map is not — see `hitSnippet`. */
  folded: string;
  /** Where each piece ends in `folded`, and what kind of text it was. */
  segments: { end: number; role: FindRole }[];
  short: ShortText | null;
  /**
   * When the message this box belongs to was written. A row in the match list
   * is a line of text out of its conversation, and the two things that put it
   * back are who said it and when — the role alone leaves eight hundred rows
   * looking like the same row.
   */
  timestamp: string | null;
}

export interface FindHit {
  /** Index into the units array. */
  unit: number;
  /** Folded offset inside that unit. */
  offset: number;
  length: number;
  /**
   * Which occurrence of the box this is, counted BEFORE any role filter — so it
   * still names the right DOM range when the reader has turned a chip off.
   */
  ordinal: number;
  role: FindRole;
}

export interface FindIndex {
  hits: FindHit[];
  /** Every occurrence by role, filtered or not: what the chips count. */
  byRole: Record<FindRole, number>;
  /** The scan hit MAX_FIND_HITS and stopped. */
  capped: boolean;
}

interface Piece {
  text: string;
  role: FindRole;
}

/**
 * One unit from the pieces a box draws.
 *
 * The pieces are trimmed and joined by a newline, and each is folded on its own
 * and joined by a single space — which is the same string `foldText` gives for
 * the join, because a run of whitespace folds to one space and a trimmed piece
 * ends in none. That equality is what lets `hitSnippet` recover the map later
 * instead of carrying 8 bytes per folded character for the life of the session.
 */
function unitOf(
  owner: Pick<MessageItem, 'uuid' | 'timestamp'>,
  toolUseId: string | null,
  pieces: Piece[],
  short: ShortText | null,
): FindUnit | null {
  const kept: { raw: string; folded: string; role: FindRole }[] = [];
  for (const piece of pieces) {
    const raw = piece.text.trim();
    if (!raw) continue;
    const folded = foldText(raw);
    // A piece of nothing but accents folds away entirely, and joining it would
    // put two spaces where foldText puts one.
    if (!folded) continue;
    kept.push({ raw, folded, role: piece.role });
  }
  if (kept.length === 0) return null;

  let folded = '';
  const segments: FindUnit['segments'] = [];
  for (const piece of kept) {
    if (folded) folded += ' ';
    folded += piece.folded;
    segments.push({ end: folded.length, role: piece.role });
  }
  return {
    uuid: owner.uuid,
    toolUseId,
    raw: kept.map((p) => p.raw).join('\n'),
    folded,
    segments,
    short,
    timestamp: owner.timestamp,
  };
}

/**
 * What names a unit on both sides of the glass: the corpus builds it from the
 * data, `boxKeyOf` reads it off an element, and the two have to agree for the
 * "visible" scope to mean anything.
 */
export function unitKey(unit: FindUnit): string {
  return unit.toolUseId ? `tool:${unit.toolUseId}` : `msg:${unit.uuid}`;
}

/** Which piece a folded offset fell in. */
function roleAt(unit: FindUnit, offset: number): FindRole {
  for (const segment of unit.segments) {
    if (offset < segment.end) return segment.role;
  }
  return unit.segments[unit.segments.length - 1].role;
}

type ToolBlock = Extract<ContentBlock, { kind: 'tool' }>;

/**
 * A tool call is ONE box, not three. Its header, its input and its result are
 * three separately foldable regions inside a single `[data-tool-id]`, and an
 * occurrence's ordinal only lines up with the DOM if they are counted as the one
 * run of text the reader sees.
 *
 * The input is folded as it is RENDERED — pretty-printed, the way `ToolBlock`
 * prints it — and not in the compact form the server's deep scan reads. A hit
 * the bar cannot paint is worse than one it never claims.
 *
 * The header is the same rule applied to its two halves: `intent` BEFORE
 * `inputSummary`, because that is the order they are drawn in, and an ordinal
 * counted in the other order would paint the wrong occurrence.
 */
function toolUnit(block: ToolBlock, owner: MessageItem): FindUnit | null {
  const role: FindRole = block.toolName === 'ExitPlanMode' ? 'plan' : 'tool';
  const header = [block.toolName, block.intent, block.inputSummary].filter(Boolean).join(' ');
  const pieces: Piece[] = [{ text: header, role }];
  if (block.input !== null && block.input !== undefined) {
    try {
      pieces.push({ text: JSON.stringify(block.input, null, 2), role });
    } catch {
      // A cyclic or otherwise unserialisable input renders as nothing too.
    }
  }
  const result = block.result;
  if (result) pieces.push({ text: result.text, role });
  const short: ShortText | null = result?.offloadedFile ? 'offloaded' : result?.truncated ? 'truncated' : null;
  return unitOf(owner, block.toolUseId || null, pieces, short);
}

/** The prose of a user message: what `UserItem` draws inside its bubble. */
function userUnit(item: MessageItem): FindUnit | null {
  if (item.isCompactSummary) {
    // `CompactSummaryPanel`, not a bubble: the summary a compaction wrote is not
    // a prompt anybody typed.
    const text = item.blocks.find((b) => b.kind === 'text');
    return unitOf(item, null, [{ text: text?.kind === 'text' ? text.text : '', role: 'system' }], null);
  }
  const pieces: Piece[] = [];
  for (const b of item.blocks) {
    if (b.kind === 'text' || b.kind === 'command') pieces.push({ text: b.text, role: 'user' });
  }
  return unitOf(item, null, pieces, null);
}

/**
 * What Claude Code injected. The report an agent handed back exists nowhere else
 * in the transcript — 22.5 KB at the median — and no server-side search reaches
 * it, so it is the single most valuable thing this corpus adds.
 */
function noticeUnit(item: MessageItem, notice: Extract<ContentBlock, { kind: 'notice' }>): FindUnit | null {
  return unitOf(
    item,
    null,
    [
      { text: notice.text, role: 'notice' },
      { text: notice.result ?? '', role: 'notice' },
    ],
    null,
  );
}

/** Everything else a `system` line can be. The three panels are not boxes. */
function systemUnit(item: MessageItem): FindUnit | null {
  const first = item.blocks[0];
  if (!first || first.kind !== 'text') return null;
  // Cut where `SystemItem` cuts it — which for a recap is nowhere, and for
  // everything else is 400 characters with no fold to open, so a hit past them
  // could be counted and never shown.
  return unitOf(item, null, [{ text: first.text.slice(0, systemChars(item.systemSubtype)), role: 'system' }], null);
}

/**
 * Every marking box of a conversation, in the order they are drawn.
 *
 * `buildSegments` and `groupTurns` only group consecutive runs — they never
 * reorder — so a flat walk of `turns → items → blocks` is document order. What
 * it does have to imitate is `TurnView`'s tool accumulator: a run of calls is
 * held back and drawn when the next prose, prompt or system line arrives, or at
 * the end of the turn, which is why a message's trailing calls appear AFTER its
 * bubble and a message's leading calls appear inside it.
 *
 * Thinking is always included, whatever the reader's toggle says: hiding it can
 * only remove a bubble, never reorder what is left, so one corpus serves both
 * states and the toggle stays a filter over the hits.
 *
 * The one place this is not exactly document order: a bubble whose first drawn
 * thing is a tool run is still ONE unit, so a hit in its prose sorts after that
 * run and before a run drawn later in the same bubble. It needs a message that
 * goes tool → text → tool, which no transcript in this corpus does.
 */
export function buildFindCorpus(turns: Turn[]): FindUnit[] {
  const units: FindUnit[] = [];
  const push = (unit: FindUnit | null): void => {
    if (unit) units.push(unit);
  };

  for (const turn of turns) {
    /** Calls drawn at conversation level once something interrupts the run. */
    let pending: FindUnit[] = [];
    const flush = (): void => {
      units.push(...pending);
      pending = [];
    };

    for (const item of turn.items) {
      if (item.role === 'user') {
        flush();
        push(userUnit(item));
        continue;
      }
      if (item.role !== 'assistant') {
        flush();
        const first = item.blocks[0];
        if (first?.kind === 'notice') push(noticeUnit(item, first));
        else push(systemUnit(item));
        continue;
      }

      const tools = item.blocks.filter((b): b is ToolBlock => b.kind === 'tool');
      if (tools.length > 0 && tools.length === item.blocks.length) {
        // Only calls: no bubble at all, and they JOIN the run rather than being
        // drawn here — the message pays through the run's own pill.
        for (const block of tools) {
          const unit = toolUnit(block, item);
          if (unit) pending.push(unit);
        }
        continue;
      }

      flush();
      const prose: Piece[] = [];
      const inside: FindUnit[] = [];
      let held: FindUnit[] = [];
      let leadsWithTools = false;
      for (const b of item.blocks) {
        if (b.kind === 'tool') {
          const unit = toolUnit(b, item);
          if (unit) held.push(unit);
          continue;
        }
        if (b.kind !== 'thinking' && b.kind !== 'text') continue;
        if (held.length > 0) {
          if (prose.length === 0) leadsWithTools = true;
          inside.push(...held);
          held = [];
        }
        prose.push({ text: b.text, role: b.kind === 'thinking' ? 'thinking' : 'assistant' });
      }
      const bubble = unitOf(item, null, prose, null);
      // A run drawn before the first line of prose comes first; one drawn between
      // two lines is sorted after the bubble it interrupts (see above).
      if (leadsWithTools) units.push(...inside);
      push(bubble);
      if (!leadsWithTools) units.push(...inside);
      // Trailing calls leave with the next flush, or at the end of the turn.
      pending.push(...held);
    }
    flush();
  }
  return units;
}

/**
 * Every occurrence in every unit, in reading order.
 *
 * `ordinal` counts within the unit and BEFORE `roles` is applied, because it is
 * what picks a range out of the DOM later, and the DOM does not know which chips
 * are on. `byRole` is likewise counted before the filter: a chip has to be able
 * to say what turning it back on would bring.
 */
export function findHits(units: FindUnit[], hl: MatchHighlight, roles: Set<FindRole>): FindIndex {
  const hits: FindHit[] = [];
  const byRole: Record<FindRole, number> = {
    user: 0,
    assistant: 0,
    thinking: 0,
    tool: 0,
    plan: 0,
    notice: 0,
    system: 0,
  };
  let capped = false;
  if (hl.terms.length === 0) return { hits, byRole, capped };

  for (let u = 0; u < units.length && !capped; u++) {
    const unit = units[u];
    const found: { offset: number; length: number }[] = [];
    const seen = new Set<number>();
    for (const term of hl.terms) {
      for (const idx of occurrences(unit.folded, term, hl.wholeWord)) {
        // Two terms can match the same run ("invalid" inside "is invalid"); the
        // marker keeps one, so this must too or the ordinals would disagree.
        if (seen.has(idx)) continue;
        seen.add(idx);
        found.push({ offset: idx, length: term.length });
      }
    }
    found.sort((a, b) => a.offset - b.offset || a.length - b.length);

    for (let ordinal = 0; ordinal < found.length; ordinal++) {
      const { offset, length } = found[ordinal];
      const role = roleAt(unit, offset);
      byRole[role]++;
      if (!roles.has(role)) continue;
      if (hits.length >= MAX_FIND_HITS) {
        capped = true;
        break;
      }
      hits.push({ unit: u, offset, length, ordinal, role });
    }
  }
  return { hits, byRole, capped };
}

/**
 * The row a hit gets in the match list, cut by the same function the server cuts
 * its snippets with — so a match found here and a match found there look like
 * the same kind of thing.
 *
 * The fold map is rebuilt here rather than carried on every unit: it is one
 * entry per folded character, ~20 MB on the largest session in this corpus, for
 * offsets only the handful of rows on screen ever need.
 */
export function hitSnippet(units: FindUnit[], hit: FindHit, hl: MatchHighlight): SearchSnippet {
  const unit = units[hit.unit];
  const { folded, map } = foldWithMap(unit.raw);
  return buildSnippet(
    { uuid: unit.uuid, role: hit.role, text: unit.raw, toolUseId: unit.toolUseId, when: unit.timestamp },
    folded,
    map,
    Math.max(0, hit.offset - SNIPPET_BEFORE),
    Math.min(folded.length, hit.offset + hit.length + SNIPPET_AFTER),
    hl.terms,
    hl.wholeWord,
  );
}

/** How much of this conversation the browser does not hold, and why. */
export function shortfall(units: FindUnit[]): Record<ShortText, number> {
  const out: Record<ShortText, number> = { truncated: 0, offloaded: 0 };
  for (const unit of units) if (unit.short) out[unit.short]++;
  return out;
}
