import type { ContentBlock } from '@claude-history/shared';

type ToolBlockType = Extract<ContentBlock, { kind: 'tool' }>;

export interface ParsedPlan {
  /** The plan itself. Null only when neither the call nor the result carried it. */
  text: string | null;
  /** Its first `# heading` — what names it when it is folded. */
  title: string | null;
  status: 'approved' | 'rejected' | 'pending';
  filePath: string | null;
  /** What the user said instead of approving. */
  feedback: string | null;
}

/** One remark the reader filed against a passage of the plan. */
export interface PlanFeedbackComment {
  quote: string;
  heading: string | null;
  text: string;
}

/** What the user sent back with a plan, taken apart. */
export interface PlanFeedback {
  /** What they typed in their own words, if anything. */
  note: string | null;
  comments: PlanFeedbackComment[];
}

/** The line this app (and Claude Code's IDE panel) writes before the comments. */
const COMMENTS_MARKER = 'Comments on the plan:';

/**
 * Read the comments back out of a plan's feedback.
 *
 * The feedback is ONE string — that is all the transcript keeps, and all Claude
 * ever saw ([AI_AGENTS_QUESTIONS_PLANS.md](../../docs/AI_AGENTS_QUESTIONS_PLANS.md)) —
 * so the note and the remarks arrive glued together in the shape they were sent:
 * a `Comments on the plan:` line and then `[Re: "<quote>" · under "<heading>"]
 * <comment>` per remark. Splitting them again is presentation only: the wire
 * format is what the model reads and is not changed for the sake of the card.
 *
 * Entries are cut at each `[Re: "`, never at every newline: a comment is a
 * textarea and may hold several lines. Anything that does not parse leaves the
 * whole feedback as a plain note, which is the truthful fallback for a plan
 * refused from a terminal or by another client.
 *
 * ## Why the cut cannot rely on a newline
 *
 * Because the newlines do not survive the journey. A stack pasted into the
 * CLI's own *Tell Claude what to change* box goes through a pseudo-terminal,
 * where a pasted line break arrives as **`\r`** — measured on a real refusal
 * here: `"Comments on the plan:\r[Re: …] saludo_y_hora\r[Re: …] el fichero de
 * readme"`. Cutting on `\n` found one entry, so the card said *1 comment* and
 * printed the second one's raw `[Re: "…"]` inside the first one's text.
 *
 * So carriage returns are normalised first and the split is on the marker
 * itself, which also survives a client that joins them with nothing at all.
 * The cost is a remark whose own text contains `[Re: "` — it would be cut in
 * two — and that is the better failure: it still shows everything somebody
 * wrote, where the newline rule hid a whole comment.
 */
export function parsePlanFeedback(raw: string): PlanFeedback {
  const feedback = raw.replace(/\r\n?/g, '\n');
  const at = feedback.lastIndexOf(COMMENTS_MARKER);
  if (at < 0) return { note: feedback.trim() || null, comments: [] };
  const note = feedback.slice(0, at).trim();
  const body = feedback.slice(at + COMMENTS_MARKER.length).trim();
  const comments: PlanFeedbackComment[] = [];
  for (const entry of body.split(/(?=\[Re: ")/).filter((e) => e.trim())) {
    const m = /^\[Re: "([\s\S]*?)"(?: · under "([\s\S]*?)")?\]\s*([\s\S]*)$/.exec(entry.trim());
    if (!m) return { note: feedback.trim() || null, comments: [] };
    comments.push({ quote: m[1], heading: m[2] ?? null, text: m[3].trim() });
  }
  if (comments.length === 0) return { note: feedback.trim() || null, comments: [] };
  return { note: note || null, comments };
}

/** The first `# heading` of a plan. Mirrors `planTitle` on the server. */
export function planTitle(markdown: string): string | null {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : null;
}

/**
 * The plan out of an `ExitPlanMode` call, or null for every other tool.
 *
 * Pure and free of the DOM on purpose: the card, the export and the per-message
 * copy all read a plan the same way, and the last two must never disagree with
 * what is on screen.
 *
 * The text lives in two places and neither is guaranteed. Claude Code used to
 * put the whole markdown in the call's `input.plan` (14 of 14 calls made by
 * 2.1.222 through 2.1.229); newer versions have the model write the plan to
 * `~/.claude/plans/<slug>.md` first and send no input at all, keeping a copy
 * only on the RESULT of an APPROVED plan. So both are read, and a plan refused
 * by a version that sends neither leaves only the file link — still worth
 * drawing, because the file is right there.
 */
export function parsePlan(block: ToolBlockType): ParsedPlan | null {
  if (block.toolName !== 'ExitPlanMode') return null;
  const input = block.input as { plan?: unknown } | null;
  const fromInput = typeof input?.plan === 'string' && input.plan.trim() ? input.plan : null;
  const outcome = block.result?.plan ?? null;
  const text = fromInput ?? outcome?.text ?? null;
  return {
    text,
    title: text ? planTitle(text) : null,
    // No result yet is a real state and not a missing one: the plan is on
    // screen and nobody has answered it.
    status: outcome?.status ?? 'pending',
    filePath: outcome?.filePath ?? null,
    feedback: outcome?.feedback ?? null,
  };
}

/**
 * What a stack of remarks is filed under: the plan's own TEXT, hashed.
 *
 * ## Why not the `ExitPlanMode` call's id
 *
 * Because while the dialog is on screen there is no call to point at. A CLI in
 * a terminal — the mode this app ships with — does not persist the `tool_use`
 * line until the dialog is ANSWERED: measured on a live session with the
 * approval prompt up, `ExitPlanMode` appeared 0 times in its 94 transcript
 * lines. The only thing that exists meanwhile is `~/.claude/plans/<slug>.md`,
 * written four seconds before the CLI went `waiting`. Keying on the call's id
 * meant the one moment worth commenting on was the one moment with no key.
 *
 * The text spans both: the file and the `input.plan` that later lands in the
 * transcript are the same bytes — 40 of 40 archived plans here hash identically
 * to the file still on disk. So remarks written against the file ARE the
 * remarks on the plan once it becomes history, with no migration and nothing to
 * reconcile, and the two stop being two rows the moment they agree.
 *
 * FNV-1a over the text with its length in front. Not a cryptographic hash and
 * it does not need to be: this distinguishes a handful of plans inside one
 * session, and `crypto.subtle` is async, which would make every render that
 * wants a key a promise.
 *
 * **The trim is inside on purpose.** The file ends with a newline the call's
 * `input.plan` does not, and trimming at one call site and not the other drew
 * the same plan as two rows — 906 characters against 907 — with the remarks
 * stranded on whichever half was keyed first. Normalising here is the one place
 * that cannot be got wrong twice.
 */
export function planKeyOf(raw: string): string {
  const text = raw.trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `${text.length.toString(36)}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** One plan of a session, as the Plan panel lists it. */
export interface SessionPlan extends ParsedPlan {
  /** What its remarks are filed under — see `planKeyOf`. */
  key: string;
  /** The `ExitPlanMode` call, for the jump into the conversation. */
  toolUseId: string;
  /** The assistant message that made the call, for the jump into the conversation. */
  uuid: string;
  /** When Claude submitted it. */
  askedAt: string | null;
}

/**
 * Every plan this session submitted, newest first.
 *
 * Read off the turns the page already holds rather than asked for: the text is
 * in `['session', id]` because the conversation draws it, so the panel costs no
 * request at all. A session can submit several — 21 of the 82 here did, one of
 * them seven times — which is the whole reason the panel needs a list.
 */
export function collectPlans(turns: { items: { uuid: string; blocks: ContentBlock[] }[] }[]): SessionPlan[] {
  const out: SessionPlan[] = [];
  for (const turn of turns) {
    for (const item of turn.items) {
      for (const block of item.blocks) {
        if (block.kind !== 'tool') continue;
        const parsed = parsePlan(block);
        if (!parsed) continue;
        out.push({
          ...parsed,
          // A plan whose text was never recorded cannot be keyed on it; the
          // call's id is the honest fallback, and such a plan has nothing to
          // comment on anyway.
          key: parsed.text ? planKeyOf(parsed.text) : block.toolUseId,
          toolUseId: block.toolUseId,
          uuid: item.uuid,
          askedAt: block.timestamp,
        });
      }
    }
  }
  return out.reverse();
}

/** How much of a quote is repeated back to Claude before it is cut. */
export const QUOTE_MAX = 240;

/**
 * The comments as the sentence Claude is given, in Claude Code's own shape —
 * the inverse of `parsePlanFeedback` above, and its neighbour on purpose.
 *
 * It goes out as the *keep planning* message, which is the one channel that is
 * certainly read: it lands in the transcript as `userFeedback` and the plan card
 * then prints it back under "the user said". The approval side has no field for
 * it at all, which is why remarks travel only with a refusal.
 *
 * Nothing at either end PARSES this shape — not the CLI, not the model — so it
 * is a convention rather than a protocol, and it reads the same whether this
 * app sent it or somebody pasted it into a terminal by hand.
 */
export function commentsFeedback(comments: { quote: string; heading: string; text: string }[]): string {
  if (comments.length === 0) return '';
  const lines = comments.map((c) => {
    const quote = c.quote.length > QUOTE_MAX ? `${c.quote.slice(0, QUOTE_MAX)}…` : c.quote;
    const where = c.heading ? ` · under "${c.heading}"` : '';
    return `[Re: "${quote}"${where}] ${c.text}`;
  });
  return `Comments on the plan:\n${lines.join('\n')}`;
}
