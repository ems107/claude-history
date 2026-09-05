import type { ChatQuestion, StopKind, StopPreview, StopPreviewKind } from '@claude-history/shared';
import { STOP_PREVIEW_MAX } from '@claude-history/shared';
import { isRec, type RawLine, safeParse, str, tailLines } from './jsonl.ts';
import { createLogger } from './logger.ts';
import { resolvePlan } from './planFile.ts';
import { planTitle, summarizeInput, toMessageUsage, toolIntent } from './parser.ts';

// The bell's other half, on the bell's own channel: an installed instance's log
// has to read as one story about one feature.
const log = createLogger('notifications');

/**
 * How many lines of the tail are read, and then how many on the second look.
 *
 * The causing line is normally the LAST one, so forty is already generous — but
 * a chatty turn puts a run of tool calls and their results between the last
 * thing Claude said and the end of the file, and a compaction can bury the lot
 * under a replayed segment of thousands of lines. So a walk that finds nothing
 * looks once more, wider, IN THE SAME CALL: that failure is indistinguishable
 * from the flush race the retry exists for, and the retry cannot fix it —
 * a session sitting on a permission prompt will never write the line that would
 * wake it. `tailLines` grows its own byte chunk, so the second look is one more
 * read of a file already in the OS cache.
 */
const TAIL_N = 40;
const TAIL_WIDE_N = 400;

/** Where a plan file WOULD be, for a call that did not carry its plan. */
export interface StopPreviewSource {
  filePath: string;
  plansDir: string;
  /** The session's slug — how Claude Code names its plan file. */
  slug: string | null;
}

/**
 * What the session said as it stopped, read from the tail of its transcript.
 *
 * **Backwards, and no tree is rebuilt.** The branch a `/rewind` left alive is
 * the one ending at the last line written (see `discardedBranches` in
 * `parser.ts`), so the last thing in the file is by definition the last thing
 * that really happened — an abandoned branch sits in the MIDDLE of a file, never
 * at its end. That is the whole reason this can be a walk rather than a parse.
 *
 * Answers null freely, and every caller has to mean it: a transcript that could
 * not be read, a session with no transcript yet, a tail whose causing line is
 * out of reach. A row without a preview says exactly what a row said before any
 * of this existed.
 */
export async function readStopPreview(src: StopPreviewSource, kind: StopKind): Promise<StopPreview | null> {
  for (const n of [TAIL_N, TAIL_WIDE_N]) {
    let raw: string[];
    try {
      raw = await tailLines(src.filePath, n);
    } catch (err) {
      log.debug(`could not read the tail of ${src.filePath}`, err);
      return null;
    }
    const lines = raw.map(safeParse).filter((o): o is RawLine => o !== null);
    const found = await (kind === 'needs-you' ? pendingCall(lines, src) : lastAnswer(lines));
    if (found) return found;
    // The whole file was already inside the window we asked for, so there is no
    // wider look to take. Counted on the RAW lines and never on the parsed ones:
    // an active transcript's last line is regularly a half-written append that
    // `safeParse` drops, and counting after the parse turned a full 40-of-40
    // read into 39 — skipping the second look on exactly the files most likely
    // to need it, since a session being appended to is a session that just
    // stopped.
    if (raw.length < n) return null;
  }
  return null;
}

/**
 * The composer's half, which needs no file at all: the question is held open in
 * memory for as long as it is being asked, and `sessionChat` has already
 * resolved a plan out of `~/.claude/plans` for us.
 */
export function previewFromQuestion(q: ChatQuestion): StopPreview | null {
  if (q.toolName === 'ExitPlanMode' && q.plan) return planPreview(q.plan);
  if (q.toolName === 'AskUserQuestion' && q.questions) {
    const label = q.questions.map((item) => item.question).join(' · ');
    const options = q.questions.flatMap((item) => item.options.map((o) => o.label));
    return build('question', label, options.join(' · '));
  }
  return toolPreview(q.toolName, q.input);
}

/**
 * A turn that ended badly. The only preview that never comes out of a
 * transcript: nothing in a CLI's lines marks an error as one, so this is the
 * composer's `lastError` and only ever a composer's — which is exactly what
 * `notifications.ts` already says an `error` stop is ("what is at the other end
 * of the row is the message saying why").
 */
export function previewFromError(message: string): StopPreview | null {
  return build('error', null, message);
}

// ---- internals ----

/** The last thing Claude said. */
function lastAnswer(lines: RawLine[]): StopPreview | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i];
    if (o.type !== 'assistant' || isReplayed(o)) continue;
    const text = assistantText(o);
    // A streamed message repeats its `message.id` across lines, which the
    // billing has to undo and this does not: the last line carrying text IS the
    // end of what was said, whichever chunk it was.
    //
    // A turn stopped with Escape lands here too, and lands on the half of the
    // answer that had been written — which is deliberately still an `answer`.
    // What was on screen when you stopped it is what was said; the marker
    // saying you stopped it is the session's own business, and the row's clock
    // already puts the two together.
    if (text) return build('answer', null, text);
  }
  return null;
}

/**
 * A line that is a verbatim re-append of an older one, and the reason this
 * cannot be `replayFilter`.
 *
 * A compaction sometimes re-appends the whole segment it closed — boundary,
 * summary and every message after it, **keeping their original timestamps** —
 * at the very end of the file: 17,678 lines of one transcript here
 * ([AI_TRANSCRIPTS.md](../../../docs/AI_TRANSCRIPTS.md), "Replayed segments").
 * So the newest thing on disk can be days old, and a walk backwards through a
 * tail would report it as what the session just said.
 *
 * `replayFilter` cannot help: it keeps the FIRST occurrence of a uuid, and in a
 * WINDOW the copy may be the only occurrence there is. What does tell them
 * apart is what Claude Code itself does about billing — **a replay's top-level
 * usage counts are zeroed** — against a real assistant line, every one of which
 * carries usage (3,156 of 3,156 measured). So four numbers adding to nothing is
 * a replay, and it is a fact on the line rather than a guess about its clock.
 *
 * After a plain `/compact` this correctly finds nothing at all: the whole tail
 * is replay, the compaction is what ended the turn, and a row with no quote is
 * the honest answer.
 */
function isReplayed(o: RawLine): boolean {
  const usage = isRec(o.message) && isRec(o.message.usage) ? o.message.usage : null;
  if (!usage) return false;
  const u = toMessageUsage(usage);
  return u.input === 0 && u.output === 0 && u.cacheRead === 0 && u.cacheCreate === 0;
}

/**
 * The call a person is being asked about — the last `tool_use` still waiting
 * for an answer.
 *
 * The pending test is not decoration. A permission dialog goes up with that
 * turn's earlier calls already answered above it, and taking simply "the last
 * `tool_use`" was picking whichever one the model happened to write last — so
 * the panel would name, as the thing waiting for you, a call that came back
 * minutes ago.
 */
function pendingCall(lines: RawLine[], src: StopPreviewSource): Promise<StopPreview | null> | StopPreview | null {
  const answered = new Set<string>();
  for (const o of lines) {
    const content = messageContent(o);
    if (!content) continue;
    for (const c of content) {
      if (!isRec(c) || c.type !== 'tool_result') continue;
      const id = str(c.tool_use_id);
      if (id) answered.add(id);
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i];
    if (o.type !== 'assistant' || isReplayed(o)) continue;
    const content = messageContent(o);
    if (!content) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const c = content[j];
      if (!isRec(c) || c.type !== 'tool_use') continue;
      const id = str(c.id);
      if (id && answered.has(id)) continue;
      const name = str(c.name) ?? 'tool';
      if (name === 'ExitPlanMode') return planFromCall(c.input, src);
      if (name === 'AskUserQuestion') return questionFromCall(c.input);
      return toolPreview(name, c.input);
    }
  }
  return null;
}

/**
 * A plan awaiting approval. Where a plan lives is `planFile.ts`'s question and
 * not this module's — the composer asks it the same one. A plan that cannot be
 * found still leaves a row naming the call, which is what every other tool gets.
 */
async function planFromCall(input: unknown, src: StopPreviewSource): Promise<StopPreview | null> {
  const { plan } = await resolvePlan(src.plansDir, src.slug, input);
  return plan ? planPreview(plan) : toolPreview('ExitPlanMode', input);
}

/**
 * Its own heading names it, so the heading comes OFF the body — printing it
 * twice on a card of three lines says less than printing it once, which is the
 * rule `toolIntent` already follows against `summarizeInput`.
 */
function planPreview(markdown: string): StopPreview | null {
  const title = planTitle(markdown);
  const body = title ? markdown.replace(/^#\s+.*$/m, '') : markdown;
  return build('plan', title, body);
}

function questionFromCall(input: unknown): StopPreview | null {
  const questions = isRec(input) && Array.isArray(input.questions) ? input.questions : [];
  const options = questions.flatMap((q) =>
    isRec(q) && Array.isArray(q.options)
      ? q.options.map((o) => (isRec(o) ? (str(o.label) ?? '') : '')).filter((l) => l !== '')
      : [],
  );
  // The label is `summarizeInput`'s, not a second reading of the same array:
  // it already answers "the question, and how many more there were".
  return build('question', summarizeInput('AskUserQuestion', input), options.join(' · '));
}

/**
 * Any other call. `summarizeInput` is what the call IS — the command, the path,
 * the pattern — and `toolIntent` is what the model said it was doing, which for
 * every Bash and PowerShell call is the one piece of prose a tool call has.
 */
function toolPreview(name: string, input: unknown): StopPreview | null {
  const what = summarizeInput(name, input);
  const why = toolIntent(name, input);
  return build('tool', name, [what, why].filter((s) => s).join('\n'));
}

/** The `message.content` array of a line, when it has one. */
function messageContent(o: RawLine): unknown[] | null {
  const message = isRec(o.message) ? o.message : null;
  return message && Array.isArray(message.content) ? message.content : null;
}

function assistantText(o: RawLine): string {
  const content = messageContent(o);
  if (!content) return '';
  const parts: string[] = [];
  for (const c of content) {
    // `thinking` blocks are deliberately not read: they are not what the
    // session said, and a card quoting them would be quoting the working out.
    if (isRec(c) && c.type === 'text' && typeof c.text === 'string' && c.text.trim()) parts.push(c.text);
  }
  return parts.join('\n\n');
}

/**
 * The cut, done once. `.slice` with the real length beside it and a flag rather
 * than an ellipsis in the string — `StarredMessage`'s shape, so whoever draws
 * this decides how to say that it was cut.
 */
function build(kind: StopPreviewKind, label: string | null, raw: string): StopPreview | null {
  const text = raw.trim().replace(/\n{3,}/g, '\n\n');
  const headline = label?.replace(/\s+/g, ' ').trim() ?? '';
  // Nothing to say at all. A row draws as it always did rather than opening a
  // quote on an empty string.
  if (!text && !headline) return null;
  return {
    kind,
    label: headline || null,
    text: text.slice(0, STOP_PREVIEW_MAX),
    chars: text.length,
    truncated: text.length > STOP_PREVIEW_MAX,
  };
}
