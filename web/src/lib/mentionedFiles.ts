import type { FileStatEntry, Turn } from '@claude-history/shared';
import { normalisePath, parseFileRef, refBasename } from './fileRefs.ts';

/**
 * A path an answer NAMED, as opposed to one it acted on.
 *
 * `ref` is what was written and `path` what it means — and the difference is the
 * whole reason a mention is a weaker thing than a delivery. A path in prose is
 * written for a human: `core/git.ts` for `server/src/core/git.ts`, `<pid>.json`
 * for a naming scheme, `~/.claude` for a folder, `vX.Y.Z` for nothing at all. So
 * the panel shows the ones that resolve to a real file and says how many did not.
 */
export interface MentionCandidate {
  /** Exactly as the message wrote it. Sent to the server; shown beside the name. */
  ref: string;
  /** What `parseFileRef` made of it: decoded, with any `:line` cut off. */
  path: string;
  name: string;
  /** `normalisePath(path)` — the dedupe key. Two spellings are one mention. */
  key: string;
  /** From `:12` / `#L12`, kept so the link opens where the sentence pointed. */
  line: number | null;
  /** How many times it was named at all — several can sit in one message. */
  hits: number;
  /**
   * The messages that named it, distinct and in the order they arrived.
   *
   * Two numbers rather than one, because they answer different questions and the
   * badge on the row was answering the wrong one: `hits` is how often the path was
   * written, and this is how many PLACES there are to go. `×4` counted occurrences
   * while the jump could only ever take you to one of them and mark the ones in
   * that message — a badge promising four stops for a file named four times in a
   * single paragraph. The badge counts these now, and `hits` lives on the tooltip.
   *
   * `[0]` is where the jump goes, which is what makes the row's timestamp its own.
   */
  messages: string[];
  timestamp: string | null;
}

/** One mention with what the disk had to say about it. */
export interface MentionRow extends MentionCandidate {
  /** The absolute path the server resolved it to — what was actually looked for. */
  resolved: string;
  /**
   * Whether anything is there.
   *
   * A row either way, and that is the point: an answer naming a file that is not
   * there is worth knowing about — the path may be partial, or a placeholder, or
   * the file may have moved since — and the row says which by saying nothing is
   * at it. What it must never do is stay silent and look like the others.
   */
  exists: boolean;
  /** Null when nothing is there to measure. */
  sizeBytes: number | null;
  modifiedAt: string | null;
  /** Also in another panel. Said on the row, never used to hide it. */
  alsoIn: 'changed' | 'sent' | null;
}

export interface MentionedFiles {
  rows: MentionRow[];
  /** How many of the rows point at nothing — the panel's own summary of itself. */
  missing: number;
  /** Why the others are not here at all. Reported, never silently swallowed. */
  dropped: {
    /** It resolved to a folder, which is not what this panel is a list of. */
    folder: number;
  };
  /** Candidates past the batch cap, never asked about at all. */
  unchecked: number;
}

/**
 * Fenced blocks, cut before anything else is looked for.
 *
 * A path inside one is a line of code or of shell, not a reference the reader is
 * being pointed at — and the renderer does not linkify one either (`InPre`).
 */
const FENCED = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
/** An inline code span. The whole span is one candidate, never scanned inside. */
const CODE_SPAN = /`([^`\n]+)`/g;
/** A markdown link. Only the destination counts — the label is the wording. */
const LINK_HREF = /\[[^\]\n]*\]\(([^)\s]+)\)/g;

/**
 * The candidates one piece of prose offers, and the ONE rule this module states:
 * **it may be stricter than the renderer, never looser.**
 *
 * What draws the links is `Markdown.tsx`, working on react-markdown's AST — an
 * `inlineCode` node in strict mode, an `a` href in loose mode. Reaching that AST
 * from here would mean a markdown parser this package does not have (only
 * `remark-gfm` resolves), so the candidates are found with these three
 * expressions instead, and they are DELIBERATELY narrower: a code span broken
 * across a newline is missed, and a fenced block is cut whole. That direction is
 * safe — a mention the panel does not list is one the reader still has as a link
 * in the message — while the other would put a row on screen that the
 * conversation never offered, which is a claim about the transcript that nothing
 * backs up.
 *
 * The decision itself is not re-implemented: `parseFileRef` makes it, with the
 * same `strict` flag the renderer passes for the same kind of candidate.
 */
function candidates(text: string): { ref: string; strict: boolean }[] {
  const prose = text.replace(FENCED, '\n');
  const out: { ref: string; strict: boolean }[] = [];
  for (const m of prose.matchAll(CODE_SPAN)) out.push({ ref: m[1], strict: true });
  for (const m of prose.matchAll(LINK_HREF)) out.push({ ref: m[1], strict: false });
  return out;
}

/**
 * Every file path the conversation itself NAMED, deduplicated, in the order it
 * was first named.
 *
 * **The assistant's own answers, and nothing else.** Two other places name paths
 * and both are deliberately out:
 *
 * - **A subagent's report.** It renders through `Markdown` like an answer, so its
 *   paths are links too, and the first version of this panel read them — with the
 *   result that 23 of 23 rows of one session came from reports, drowning the four
 *   the conversation itself had pointed at. Worse, the row could not keep its
 *   promise: a report is folded inside a notice, so `↑ the mention` landed on the
 *   agent's box with the path nowhere on screen. A row here must go somewhere the
 *   named path can actually be READ, and only an answer can offer that.
 * - **A prompt**, which renders `whitespace-pre-wrap` — a path typed into one is
 *   not a link anywhere in this app, and a panel is no place to start pretending.
 */
export function collectMentionedFiles(turns: Turn[]): MentionCandidate[] {
  const found = new Map<string, MentionCandidate>();
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.role !== 'assistant') continue;
      for (const block of item.blocks) {
        if (block.kind !== 'text') continue;
        for (const raw of candidates(block.text)) {
          const ref = parseFileRef(raw.ref, { strict: raw.strict });
          if (!ref) continue;
          const key = normalisePath(ref.path);
          const existing = found.get(key);
          if (existing) {
            // The first anchor and the first spelling stay: the row reads as
            // "this file, first named here", and the two counts say the rest.
            existing.hits += 1;
            if (!existing.messages.includes(item.uuid)) existing.messages.push(item.uuid);
            existing.line ??= ref.line ?? null;
            continue;
          }
          found.set(key, {
            ref: raw.ref,
            path: ref.path,
            name: refBasename(ref.path),
            key,
            line: ref.line ?? null,
            hits: 1,
            messages: [item.uuid],
            timestamp: item.timestamp,
          });
        }
      }
    }
  }
  return [...found.values()];
}

/**
 * What to underline in the message a mention came from.
 *
 * The ref as written is the first term, because that is the text on screen — a
 * `:12` suffix included, since the sentence pointed at the line and the reader is
 * looking for that. The basename follows when the ref is more than that, and it
 * covers the case the ref alone cannot: a markdown link puts the path in the HREF
 * and the filename in the words, so marking only the ref would underline nothing
 * at all. Marking both also lights up every other naming of the same file in that
 * message, which is what the search does with a term and is right here too.
 */
export function mentionTerms(row: MentionCandidate): string[] {
  return row.ref === row.name ? [row.ref] : [row.ref, row.name];
}


/**
 * The mentions worth a row, and an honest account of the rest.
 *
 * **One filter only, and it is not existence.** A mention that resolves to
 * nothing is still something the answer said, and hiding it made the panel quietly
 * disagree with the messages the reader can see; it is a row wearing `not found`
 * instead. What is dropped is a FOLDER — `~/.claude` was the single most-named
 * "path" of one session, 14 times over — because this is a list of files and a
 * folder row would be the same noise in every session that mentions one.
 *
 * Being in another panel is not a filter either, and that was the same mistake
 * made once already: the first version dropped those rows on the grounds that the
 * information was already elsewhere, and it took the most obvious mentions of a
 * session with it — a file the answers keep pointing at is usually one the session
 * also edited. It is a chip on the row now.
 *
 * Pure, so the counts can be checked without a browser, and the panel is left
 * with nothing to decide.
 */
export function filterMentions(
  found: MentionCandidate[],
  stats: FileStatEntry[],
  changed: Set<string>,
  sent: Set<string>,
  unchecked: number,
): MentionedFiles {
  // Joined on the ref the server echoed back, normalised the one way the app
  // normalises a path — the same join the sent panel makes, and never positional.
  const byRef = new Map(stats.map((s) => [normalisePath(s.ref), s]));
  // Keyed on the RESOLVED path, which is the only thing that identifies a file
  // here: one answer can name `server/src/core/parser.ts` and another the same
  // file absolutely, and the panel drew two rows for one file until the key moved
  // here. The resolution is the server's answer, so this is the earliest point
  // where the question can even be asked.
  const rows = new Map<string, MentionRow>();
  const dropped = { folder: 0 };
  for (const c of found) {
    const stat = byRef.get(normalisePath(c.ref));
    // No answer at all is the same state as "nothing is there", and it happens
    // only past the cap or on a ref the server refused to resolve.
    if (stat?.isDirectory) {
      dropped.folder += 1;
      continue;
    }
    const resolvedPath = stat?.path ?? c.path;
    const resolved = normalisePath(resolvedPath);
    const existing = rows.get(resolved);
    if (existing) {
      // Both counts survive the merge, or a file named once as `core/parser.ts`
      // and once absolutely would report one place and one naming.
      existing.hits += c.hits;
      for (const uuid of c.messages) if (!existing.messages.includes(uuid)) existing.messages.push(uuid);
      existing.line ??= c.line;
      continue;
    }
    rows.set(resolved, {
      ...c,
      resolved: resolvedPath,
      exists: stat?.exists === true,
      sizeBytes: stat?.exists ? stat.sizeBytes : null,
      modifiedAt: stat?.exists ? stat.modifiedAt : null,
      alsoIn: changed.has(resolved) ? 'changed' : sent.has(resolved) ? 'sent' : null,
    });
  }
  const all = [...rows.values()];
  return { rows: all, missing: all.filter((r) => !r.exists).length, dropped, unchecked };
}
