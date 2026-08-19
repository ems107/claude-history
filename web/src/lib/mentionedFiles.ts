import type { FileStatEntry, Turn } from '@claude-history/shared';
import { normalisePath, parseFileRef, refBasename } from './fileRefs.ts';

/**
 * A path an answer NAMED, as opposed to one it acted on.
 *
 * `ref` is what was written and `path` what it means — and the difference is the
 * whole reason a mention is a weaker thing than a delivery. A path in prose is
 * written for a human: `core/git.ts` for `server/src/core/git.ts`, `<pid>.json`
 * for a naming scheme, `~/.claude` for a folder. Only 14 of 64 mentions across
 * five sessions of this corpus resolved to a file that is really there, so the
 * panel shows the survivors and says how many did not.
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
  /** Named in a subagent's report rather than in the conversation's own words. */
  fromReport: boolean;
}

/** One mention that survived: it resolved, and it is a file, and it is nowhere else. */
export interface MentionRow extends MentionCandidate {
  /** The absolute path the server resolved it to. */
  resolved: string;
  sizeBytes: number;
  modifiedAt: string | null;
}

export interface MentionedFiles {
  rows: MentionRow[];
  /** Why the others are not here. Reported, never silently swallowed. */
  dropped: {
    /** Nothing is at that path — a partial path, a placeholder, a file long gone. */
    missing: number;
    /** It resolved to a folder. */
    folder: number;
    /** A real file, but Changed Files or Sent Files already lists it. */
    listed: number;
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
 * Every file path the conversation NAMED, deduplicated, in the order it was
 * first named.
 *
 * Only where a path is a link today, which is what keeps the panel and the page
 * agreeing about what a mention is: an assistant `text` block, and a subagent's
 * report inside a notice. **A prompt is deliberately not read** — it renders as
 * `whitespace-pre-wrap`, so a path typed into one is not a link anywhere in this
 * app, and a panel is no place to start pretending it is.
 */
export function collectMentionedFiles(turns: Turn[]): MentionCandidate[] {
  const found = new Map<string, MentionCandidate>();
  const take = (raw: { ref: string; strict: boolean }, item: { uuid: string; timestamp: string | null }, fromReport: boolean) => {
    const ref = parseFileRef(raw.ref, { strict: raw.strict });
    if (!ref) return;
    const key = normalisePath(ref.path);
    const existing = found.get(key);
    if (existing) {
      existing.hits += 1;
      // The first anchor and the first spelling stay: the row reads as "this
      // file, first named here". A mention in the conversation's own words
      // outranks one in a report, because that is the one worth jumping to.
      if (existing.fromReport && !fromReport) {
        existing.fromReport = false;
        existing.messageUuid = item.uuid;
        existing.timestamp = item.timestamp;
      }
      return;
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
      fromReport,
    });
  };

  for (const turn of turns) {
    for (const item of turn.items) {
      for (const block of item.blocks) {
        if (block.kind === 'text' && item.role === 'assistant') {
          for (const c of candidates(block.text)) take(c, item, false);
        } else if (block.kind === 'notice' && block.result) {
          // A report wears the `user` role in the transcript and nobody typed
          // it; it renders through `Markdown` like an answer, so its paths are
          // links like an answer's.
          for (const c of candidates(block.result)) take(c, item, true);
        }
      }
    }
  }
  return [...found.values()];
}

/**
 * The mentions worth a row, and an honest account of the rest.
 *
 * Three filters, and every one of them exists because of something measured
 * rather than imagined:
 *
 * - **It has to resolve to something that is there.** Four of five did not, and
 *   a row that cannot be opened is a promise the panel cannot keep.
 * - **It has to be a file.** `~/.claude` was the single most-named "path" of one
 *   session (14 times), and it is a directory.
 * - **It must not already be listed.** Two thirds of the survivors of one session
 *   were files it also EDITED, and this panel exists for what the other two do
 *   not hold. `alreadyListed` is normalised absolute paths from `fileChanges` and
 *   from the sent/published index.
 *
 * Pure, so the counts can be checked without a browser, and the panel is left
 * with nothing to decide.
 */
export function filterMentions(
  found: MentionCandidate[],
  stats: FileStatEntry[],
  alreadyListed: Set<string>,
  unchecked: number,
): MentionedFiles {
  // Joined on the ref the server echoed back, normalised the one way the app
  // normalises a path — the same join the sent panel makes, and never positional.
  const byRef = new Map(stats.map((s) => [normalisePath(s.ref), s]));
  // Keyed on the RESOLVED path, which is the only thing that identifies a file
  // here. Deduplicating on what was written cannot do it: one report named
  // `server/src/core/parser.ts` and another the same file absolutely, and the
  // panel drew two rows for one file — four times over in one session. The
  // resolution is the server's answer, so this is the earliest point where the
  // question can even be asked.
  const rows = new Map<string, MentionRow>();
  const dropped = { missing: 0, folder: 0, listed: 0 };
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
    if (alreadyListed.has(resolved)) {
      dropped.listed += 1;
      continue;
    }
    const existing = rows.get(resolved);
    if (existing) {
      // Named twice in two spellings is named twice. The first spelling stays,
      // and a naming in the conversation's own words takes the anchor from a
      // naming in a report, wherever in the list it turns up.
      existing.hits += c.hits;
      if (existing.fromReport && !c.fromReport) {
        existing.fromReport = false;
        existing.ref = c.ref;
        existing.messageUuid = c.messageUuid;
        existing.timestamp = c.timestamp;
      }
      existing.line ??= c.line;
      continue;
    }
    rows.set(resolved, { ...c, resolved: stat.path, sizeBytes: stat.sizeBytes, modifiedAt: stat.modifiedAt });
  }
  return { rows: [...rows.values()], dropped, unchecked };
}
