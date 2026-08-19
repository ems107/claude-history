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
  /** How many times it was named. */
  hits: number;
  /** The message that named it first — `?msg=`, all a mention can be anchored on. */
  messageUuid: string | null;
  timestamp: string | null;
}

/** One mention that survived: it resolved, and it is a file. */
export interface MentionRow extends MentionCandidate {
  /** The absolute path the server resolved it to. */
  resolved: string;
  sizeBytes: number;
  modifiedAt: string | null;
  /** Also in another panel. Said on the row, never used to hide it. */
  alsoIn: 'changed' | 'sent' | null;
}

export interface MentionedFiles {
  rows: MentionRow[];
  /** Why the others are not here. Reported, never silently swallowed. */
  dropped: {
    /** Nothing is at that path — a partial path, a placeholder, a file long gone. */
    missing: number;
    /** It resolved to a folder. */
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
            // "this file, first named here", and the count says the rest.
            existing.hits += 1;
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
            messageUuid: item.uuid,
            timestamp: item.timestamp,
          });
        }
      }
    }
  }
  return [...found.values()];
}

/**
 * The mentions worth a row, and an honest account of the rest.
 *
 * Two filters, and both exist because of something measured rather than imagined:
 *
 * - **It has to resolve to something that is there.** Most did not — a partial
 *   path, a placeholder, a version number — and a row that cannot be opened is a
 *   promise the panel cannot keep.
 * - **It has to be a file.** `~/.claude` was the single most-named "path" of one
 *   session (14 times), and it is a directory.
 *
 * Being in another panel is NOT a filter, and that was a mistake worth recording:
 * the first version dropped those rows on the grounds that the information was
 * already elsewhere, and it took the most obvious mentions of a session with it —
 * a file the answers keep pointing at is usually one the session also edited. It
 * is a chip on the row now, which is what the reader wanted from it anyway.
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
  const dropped = { missing: 0, folder: 0 };
  for (const c of found) {
    const stat = byRef.get(normalisePath(c.ref));
    if (!stat || !stat.exists) {
      dropped.missing += 1;
      continue;
    }
    if (stat.isDirectory) {
      dropped.folder += 1;
      continue;
    }
    const resolved = normalisePath(stat.path);
    const existing = rows.get(resolved);
    if (existing) {
      existing.hits += c.hits;
      existing.line ??= c.line;
      continue;
    }
    rows.set(resolved, {
      ...c,
      resolved: stat.path,
      sizeBytes: stat.sizeBytes,
      modifiedAt: stat.modifiedAt,
      alsoIn: changed.has(resolved) ? 'changed' : sent.has(resolved) ? 'sent' : null,
    });
  }
  return { rows: [...rows.values()], dropped, unchecked };
}
