// Cutting the piece of text a match sits in, and marking the words inside it.
//
// It lives here for the reason the fold and the whole-word rule do: the server
// cuts the snippets of a search result with it, and the viewer's own find bar
// cuts the rows of its match list with it, over a corpus the server never sees.
// Two implementations would disagree about where a snippet starts the day one of
// them learned something — and the offsets they work in are the fold's, which is
// already shared.
//
// What did NOT come with it is `matchWindows`: grouping occurrences into places
// so that a paged list's figures add up is the paged list's problem, and a find
// bar counts occurrences.

import type { SearchSnippet } from './api.ts';
import { occurrences } from './match.ts';

/** Folded characters of context kept on each side of a match. */
export const SNIPPET_BEFORE = 60;
export const SNIPPET_AFTER = 90;

/** The `system` subtype of a recap. The identifier — the label is `systemLines.ts`. */
export const RECAP_SUBTYPE = 'away_summary';

/**
 * How much of a `system` line is DRAWN — and therefore how much of one may be
 * searched. `SystemItem` cuts it here and offers no fold to open, so a match
 * past this point is one nothing can ever show.
 *
 * It is shared for the reason the fold is: the viewer's find bar stops here, so
 * must the server's index, and `SystemItem` has to draw exactly as much as both.
 * Three readers, one number.
 */
export const SYSTEM_CHARS = 400;

/**
 * Subtypes drawn WHOLE, however long they are.
 *
 * The cut above exists for plumbing, and it earns its keep: a `local_command`
 * line is `<command-name>` markup and the longest here is 2,456 characters. A
 * recap is the opposite — prose Claude Code wrote to be read by whoever comes
 * back — and the cap cost it exactly 65 characters across the whole corpus, in
 * the middle of a sentence, in the one recap of 148 that runs past 400. Its own
 * ceiling is the two or three sentences Claude Code writes.
 */
const UNCUT = new Set<string>([RECAP_SUBTYPE]);

/**
 * How much of THIS system line may be drawn, folded and indexed. `Infinity` on
 * purpose: every caller then slices unconditionally, and none has to grow a
 * branch that could be written differently in three places.
 */
export function systemChars(subtype: string | null | undefined): number {
  return subtype && UNCUT.has(subtype) ? Number.POSITIVE_INFINITY : SYSTEM_CHARS;
}

/**
 * One searchable piece of a session, whatever produced it: the enricher's index,
 * the deep scan's stream of tool output, or the browser's own copy of the
 * conversation. Only the text is scanned; the rest is what a hit needs to point
 * at something.
 */
export interface SearchBlock {
  uuid: string | null;
  role: string;
  text: string;
  /**
   * Which tool call this text belongs to. A line uuid cannot say it — one
   * assistant message carries several calls, and the line that carries a
   * `tool_result` is not rendered at all — so this is the only anchor that can
   * open the right tool in the viewer.
   */
  toolUseId?: string | null;
  /** Only on the block that holds a subagent's id: which agent it names. */
  agentId?: string | null;
  /**
   * When the line this text came from was written (ISO-8601), so a row can say
   * it. Optional because some blocks are not a moment at all: a session's own
   * id, its agents' ids and its title have no clock to give, and inventing one
   * for them would put a date on a row that is not a thing anybody wrote.
   */
  when?: string | null;
}

/** Snippets are rendered on one line, so the text shown must fold like the text searched. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * One window of a block, cut at folded offsets and mapped back to the original
 * text, with every term that falls inside it marked — the anchor is only what
 * chose the window, not the only thing worth highlighting.
 */
export function buildSnippet(
  block: SearchBlock,
  folded: string,
  map: number[],
  startFold: number,
  endFold: number,
  terms: string[],
  wholeWord: boolean,
): SearchSnippet {
  const text = block.text;
  const at = (foldedIndex: number): number => (foldedIndex < map.length ? map[foldedIndex] : text.length);

  const ranges: [number, number][] = [];
  for (const term of terms) {
    for (const idx of occurrences(folded, term, wholeWord, startFold, endFold)) {
      ranges.push([idx, idx + term.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const parts: SearchSnippet['parts'] = [];
  const push = (chunk: string, hit?: true): void => {
    if (chunk) parts.push(hit ? { text: chunk, hit } : { text: chunk });
  };
  let cursor = startFold;
  let lead = startFold > 0 ? '…' : '';
  for (const [start, end] of ranges) {
    // Overlapping terms ("invalid" inside "is invalid") merge into one mark.
    if (end <= cursor) continue;
    push(lead + oneLine(text.slice(at(cursor), at(Math.max(start, cursor)))));
    lead = '';
    push(oneLine(text.slice(at(Math.max(start, cursor)), at(end))), true);
    cursor = end;
  }
  push(lead + oneLine(text.slice(at(cursor), at(endFold))) + (endFold < map.length ? '…' : ''));

  return {
    uuid: block.uuid,
    role: block.role,
    parts,
    toolUseId: block.toolUseId ?? null,
    agentId: block.agentId ?? null,
    when: block.when ?? null,
  };
}
