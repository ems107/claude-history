// Domain types shared between server and web.
// Data model reference: see docs/AI_TRANSCRIPTS.md and docs/AI_COST_AND_CONTEXT.md.

export type TitleSource =
  | 'custom-title'
  | 'ai-title'
  | 'agent-name'
  | 'last-prompt'
  | 'first-message'
  | 'uuid'
  /** Renamed locally in claude-history (override stored in userdata.json, never written to ~/.claude). */
  | 'local';

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

/**
 * What one assistant message was billed. `message.usage` sits on EVERY
 * assistant line (verified: 3156/3156 across 60 transcripts) and the streamed
 * chunks of a message repeat it verbatim (0 disagreements), so this is the
 * value of the first line carrying a given `message.id` — the same dedupe the
 * enricher does, which is what makes the per-message costs add up to the
 * session total exactly.
 */
export interface MessageUsage extends UsageTotals {
  /**
   * `cache_creation` split by TTL. Claude Code writes 1-hour caches — 100% of
   * this corpus — which is why the default cache-write price is the 1h rate.
   */
  cacheCreate1h: number;
  cacheCreate5m: number;
}

/**
 * One row of the `/context` breakdown. `deferred` rows (deferred MCP and system
 * tools) are counted by /context but are NOT in the context: subtracting them
 * from the category sum gives the reported total, exactly, in all four snapshots
 * on this machine (22.8k / 22.7k / 18.7k / 25.5k of discrepancy, each equal to
 * its two deferred rows).
 */
export interface ContextCategory {
  label: string;
  tokens: number;
  /** As /context computed it, against the real window — never derived here. */
  pct: number;
  deferred: boolean;
}

/**
 * A `/context` run, recovered from the transcript: Claude Code re-injects its
 * own output as an isMeta user line in clean markdown. It is the ONLY place the
 * window size and the `[1m]` model marker are recorded, and the only place the
 * per-category split exists — nothing else lets it be reconstructed, because the
 * fixed overhead grows during a session as deferred tools and skills load.
 */
export interface ContextSnapshot {
  model: string | null;
  reportedTokens: number | null;
  limitTokens: number | null;
  /** As printed by /context ("47"), not computed by us. */
  reportedPct: number | null;
  categories: ContextCategory[];
  mcpTools: Array<{ tool: string; server: string; tokens: number }>;
}

/** A `system`/`compact_boundary` line: the conversation was compacted here. */
export interface CompactBoundary {
  /** "manual" (/compact) or "auto" (the autocompact threshold). */
  trigger: string | null;
  preTokens: number | null;
  postTokens: number | null;
  /** cumulativeDroppedTokens — across the whole session, not just this boundary. */
  droppedTokens: number | null;
  durationMs: number | null;
  preservedMessages: number | null;
}

export interface PrLink {
  prNumber: number;
  prUrl: string;
  prRepository: string;
}

export interface DailyUsage {
  /** User-typed prompts that day. */
  prompts: number;
  byModel: Record<string, UsageTotals>;
  /**
   * Context that was already cached and had to be written again, per model — a
   * SUBSET of `byModel[...].cacheCreate`, never an addition to it. Stored as
   * tokens and never as an amount: the price table is user-editable, so a saved
   * cost would freeze yesterday's rates. Carried-over lines are excluded, like
   * every other aggregate here.
   *
   * It lives in the daily buckets rather than on the session because that is
   * what the stats page filters by, and because a session-level copy would be a
   * second source of truth for the number the viewer already computes from the
   * parsed turns. Both go through `recacheOf` in `shared/src/recache.ts`.
   */
  recachedByModel: Record<string, number>;
  /** Requests that day which had to re-write a cached prefix. */
  recacheEvents: number;
  /**
   * What the agents this session sent out spent THAT day, in their own
   * conversations. An addition to `byModel`, never a subset of it: those
   * requests are not in this transcript at all.
   *
   * Bucketed by the agent's own timestamps rather than by the turn that
   * launched it — an agent runs for minutes and can finish on the next day —
   * and kept with the TTL split, because a subagent writes 5-minute caches
   * (1.25x input) where a session writes 1-hour ones (2x). Folded into
   * `byModel` it would be priced at the session's rate and overcharged.
   */
  subagentByModel: Record<string, MessageUsage>;
}

/**
 * One plan this session submitted for approval, for the index and the Plans
 * page. The markdown itself is deliberately NOT here: plans run to 25 KB each
 * and this is cached on disk for every session, while the text is already in
 * the transcript and one fetch away.
 */
export interface PlanRecord {
  /** The `ExitPlanMode` call — the anchor a `?tool=` link needs. */
  toolUseId: string;
  /** The assistant message that made the call. */
  uuid: string | null;
  askedAt: string | null;
  /** When the user answered. Null while a plan is still awaiting one. */
  decidedAt: string | null;
  status: 'approved' | 'rejected' | 'pending';
  /** Its first `# heading`. */
  title: string | null;
  /** Enough of the plan to recognise it in a list. */
  preview: string;
  chars: number;
  /** `~/.claude/plans/<slug>.md`, when the approval recorded one. */
  filePath: string | null;
  feedback: string | null;
}

export interface SessionEnrichment {
  userMessageCount: number;
  assistantMessageCount: number;
  toolUseCount: number;
  turnCount: number;
  /** `system`/`compact_boundary` lines: how many times this session was compacted. */
  compactionCount: number;
  /**
   * What the requests in THIS transcript cost. Carried-over lines are excluded
   * (see `carriedOverUsage`), so summing sessions never bills a fork's copies
   * twice.
   *
   * This is no longer the whole of what the session spent — the agents it sent
   * out are in `subagentUsage` — and it must stay this exact quantity: it is
   * what the viewer's per-message pills add up to, which is the only check that
   * the token arithmetic is right.
   */
  usage: UsageTotals;
  usageByModel: Record<string, UsageTotals>;
  /**
   * What the agents this session sent out spent, added up from their own
   * transcripts (`<sessionUuid>/subagents/agent-*.jsonl`). Their requests are
   * their own API conversations and appear nowhere in this file, so without
   * this the session cost was short by 88% in the worst case here — $1.49
   * shown against $12.01 really spent, across 11 agents.
   *
   * Kept apart from `usage` rather than folded into it for two reasons, both
   * load-bearing: the pills above, and the cache TTL — hence `MessageUsage`,
   * which carries the 1h/5m split that `UsageTotals` does not.
   *
   * Nothing here can be double-counted corpus-wide: an `agent-*.jsonl` belongs
   * to exactly one session and a `/branch` fork does not copy the directory.
   */
  subagentUsage: MessageUsage;
  subagentUsageByModel: Record<string, MessageUsage>;
  /**
   * The agents' own ids (`agent-<id>.jsonl`), which is what a notification's
   * `<task-id>` is. Indexed like the session's own id so that pasting one finds
   * it: the app writes them into the URL when a drawer opens, and until they
   * were searchable there was no way back from the string to the agent.
   */
  subagentIds: string[];
  /** Per-UTC-day usage (yyyy-mm-dd) for the stats dashboard. Carried-over lines excluded. */
  daily: Record<string, DailyUsage>;
  models: string[];
  /** Every plan submitted with `ExitPlanMode`, in the order they were made. */
  plans: PlanRecord[];
  prLinks: PrLink[];
  /**
   * The session this one was forked from (`/branch`), read from the `forkedFrom`
   * field Claude Code stamps on every copied line. The ONLY explicit ancestry in
   * the format — see `runIds` for what used to be mistaken for it.
   */
  forkedFrom: string | null;
  /**
   * Tokens that arrived WITH the fork: lines copied from the parent, already
   * billed there. Kept apart instead of dropped, because the viewer renders
   * those messages and their pills have to add up to something.
   */
  carriedOverUsage: UsageTotals;
  /**
   * Other Claude Code runs that appended to this transcript, from the
   * `session_id` field — which names the RUN that wrote a line, not an ancestor.
   * Resuming a session from a fresh CLI stamps that CLI's id on everything it
   * writes, and the id usually belongs to a 1-line stub with no conversation of
   * its own. Verified across all 22 cases in this corpus: not one carries a
   * copied uuid, so nothing here is history this session inherited.
   */
  runIds: string[];
}

/**
 * What a Claude Code CLI is doing, as it writes it to
 * `~/.claude/sessions/<pid>.json`. **The whole set is four values** — read out
 * of the 2.1.239 binary (`["busy","shell","idle","waiting"]`) rather than
 * guessed from what this machine happened to have written, and verified live.
 *
 * Kept as loose strings rather than a union: a later CLI may add a fifth, and an
 * unknown value has to degrade to "cannot say" instead of failing to typecheck.
 * The whole reading is in [AI_TRANSCRIPTS.md](../../docs/AI_TRANSCRIPTS.md).
 */
export const LIVE_BUSY = 'busy';
/** A dialog is on screen — see `LiveInfo.waitingFor` for which. */
export const LIVE_WAITING = 'waiting';
/**
 * The turn is over. Two values, because `shell` is `idle` with a shell open on
 * top of it (the CLI writes `idle && shellOpen ? 'shell' : status`) — nothing
 * about the conversation differs, so nothing here tells the two apart.
 */
export const LIVE_STOPPED: readonly string[] = ['idle', 'shell'];

export interface LiveInfo {
  pid: number;
  /** `LIVE_BUSY` | `LIVE_WAITING` | one of `LIVE_STOPPED`, or `"unknown"`. */
  status: string;
  /**
   * What the session is waiting FOR, written only alongside `LIVE_WAITING`:
   * `"permission prompt"` (the CLI's default for any dialog it has no name for,
   * so by far the commonest), `"input needed"`, `"dialog open"`,
   * `"goal proposal"`, `"sandbox request"`, `"worker request"`.
   *
   * Its own field rather than folded into `status`, because it is the sentence
   * a UI can show where `status` is the state a UI can branch on.
   */
  waitingFor: string | null;
  name: string | null;
  startedAt: number | null; // epoch ms
  updatedAt: number | null; // epoch ms
  /**
   * When the status last changed — which, for a busy session, is when the turn
   * began. Kept separate from `updatedAt` on purpose: the two are equal today
   * because Claude Code writes this file only when something changes (measured:
   * `updatedAt` frozen for 3 minutes into a busy turn, no heartbeat at all), and
   * a heartbeat appearing later would move `updatedAt` while this stays true.
   */
  statusUpdatedAt: number | null; // epoch ms
  /**
   * When the turn in flight began, as this app best knows it: the moment the
   * session was last seen LEAVING idle, kept across the waiting↔busy flips a
   * dialog causes — a session goes busy when the user gives it something back
   * (`statusUpdatedAt` restarts on every answered permission), and the turn's
   * own clock must not. Ours, not the CLI's: the pid file has no turn concept,
   * so the index remembers the flip in memory like every other transition, and
   * a server restarted mid-turn falls back to `statusUpdatedAt` until the next
   * turn. Null while no turn is open. The viewer's `total` is still the finer
   * reading (`turnClocks` bounds the turn by the transcript itself); this is
   * the list's, exact wherever the server saw the turn start.
   */
  busySince: number | null; // epoch ms
}

export interface SessionSummary {
  id: string; // session UUID (= jsonl filename base)
  encodedDir: string; // subdir name under ~/.claude/projects
  projectKey: string; // normalized (lowercase) real project path — grouping key
  projectPath: string; // real project path as recorded in `cwd` (display casing)
  projectName: string; // basename of projectPath, for the tag
  title: string;
  titleSource: TitleSource;
  /** Set only when titleSource === 'local': the title Claude Code still shows. */
  originalTitle: string | null;
  createdAt: string | null; // ISO-8601
  lastActivityAt: string | null; // ISO-8601
  mtimeMs: number;
  sizeBytes: number;
  gitBranch: string | null;
  slug: string | null;
  entrypoint: string | null; // "cli" | "claude-desktop" | "claude-vscode"
  model: string | null; // last assistant model seen in tail
  claudeVersion: string | null;
  messageCount: number | null; // approx, from last turn_duration sidecar
  firstPromptPreview: string | null;
  lastPromptPreview: string | null;
  isEmpty: boolean; // throwaway stub (hidden by default)
  isBackground: boolean; // sessionKind === "bg"
  /** Pinned locally in claude-history (userdata.json — never touches ~/.claude). */
  pinned: boolean;
  subagentCount: number;
  enrichment: SessionEnrichment | null;
  live: LiveInfo | null;
  // Sessions forked FROM this one (the reverse of their `forkedFrom`).
  descendants: string[];
}

/**
 * Cap on the copy a star keeps. `userdata.json` is read whole at startup and
 * rewritten in full on every pin, rename and setting, and a prompt can carry a
 * pasted log of any size — so the copy is bounded and says when it was cut.
 * 200,000 characters is far above any real message here.
 */
export const STAR_TEXT_MAX = 200_000;

/**
 * A message the user starred, as stored in `userdata.json` — the third kind of
 * local override after renames and pins, and the only one that keeps CONTENT.
 *
 * It keeps a copy of the text on purpose. Reading it back out of the transcript
 * on every visit would mean parsing one file per starred session (~100-200 ms
 * each, measured on the 16 MB one), and the star would die with the transcript
 * — while the whole point of starring something is to keep it. Nothing can
 * drift: transcript lines are append-only, so a message's text never changes
 * after it is written.
 */
export interface StarredMessage {
  sessionId: string;
  /** The item's canonical uuid (`MessageItem.uuid`) — what `?msg=` needs. */
  uuid: string;
  role: 'user' | 'assistant';
  /** The message's own clock: what the Starred page sorts by. */
  timestamp: string | null;
  /** When the star was set. The fallback order for a message with no clock. */
  starredAt: string;
  /** Its text as the transcript held it when it was starred. */
  text: string;
  /** The real length, before `STAR_TEXT_MAX` cut it. */
  chars: number;
  truncated: boolean;
  /**
   * Where it came from, snapshotted so an orphaned star still says so. The
   * index wins whenever the session is still there — that is what keeps a
   * local rename showing on the Starred page too.
   */
  sessionTitle: string;
  project: string;
}

export interface ProjectInfo {
  key: string; // normalized path
  path: string; // display path
  name: string; // basename
  color: string; // css color for the tag
  sessionCount: number;
  lastActivityMs: number;
}

// ---- Conversation detail (viewer) ----

/**
 * What became of a plan Claude submitted with `ExitPlanMode` — the half of the
 * story the transcript keeps and the viewer used to throw away.
 *
 * Read from the STRUCTURED fields of the carrying line, never from its prose,
 * for the reason `answers` is: the tool_result text is a fixed template with the
 * plan glued onto the end of it, and picking either back out of that is
 * guesswork the moment the plan contains the template's own words.
 *
 * The two flavours are not variations of one shape — they are different types.
 * An approval writes an OBJECT (`{plan, isAgent, filePath}`, 10 of the 14 calls
 * in this corpus); a rejection writes a plain STRING starting `"Error: "`, with
 * `toolDenialKind` and `userFeedback` as siblings on the line. That second one
 * is the generic tool-rejection shape, nothing plan-specific, which is why the
 * status is decided by the type of `toolUseResult` and not by any field in it.
 */
export interface PlanOutcome {
  status: 'approved' | 'rejected';
  /**
   * The plan as Claude Code recorded it on approval (`toolUseResult.plan`).
   * Null on a rejection, which keeps no copy — the call's own input is then the
   * only place the plan exists.
   */
  text: string | null;
  /**
   * `toolUseResult.filePath`: the `~/.claude/plans/<slug>.md` the plan was saved
   * to. Worth carrying even though the text is here, because it is a real file
   * the user can open — but it holds only the LATEST plan for that slug, so it
   * is not proof that this is the plan on disk.
   */
  filePath: string | null;
  /**
   * `userFeedback`: what the user said instead of approving. Every rejection in
   * this corpus carries one, and it is the whole point of the rejection — the
   * plan was refused *for a reason*, and that reason is the next instruction.
   */
  feedback: string | null;
}

/**
 * One file `SendUserFile` handed to the user, as the transcript recorded it.
 *
 * The pixels are NOT here and never were: the tool's result is the one-line
 * prose `N files delivered to user.`, and `toolUseResult.attachments` is the
 * only copy of everything else. So a viewer that wants to show the file has to
 * read it off disk — from `path`, which is absolute and usually points inside
 * the session's scratchpad, i.e. a directory that gets cleaned. "The file is
 * gone" is therefore an ordinary state here, not a failure.
 *
 * `size` and `media_type` are what was SENT. The file on disk may since have
 * changed or vanished, which is why the viewer shows the real `modifiedAt`
 * beside them the moment it opens one.
 *
 * `file_uuid` is deliberately NOT carried: it is the id of the upload to
 * claude.ai, and nothing on this machine can do anything with it.
 */
export interface SentAttachment {
  path: string;
  /** `size` — as sent, not as it is on disk now. Null when the line wrote none. */
  sizeBytes: number | null;
  isImage: boolean;
  /** `media_type`, e.g. `image/png` or `text/markdown`. */
  mediaType: string | null;
  /** Whether Claude Code found the file where the model said it was. */
  pathValidated: boolean | null;
}

export interface ToolResultInfo {
  text: string;
  /**
   * The clock of the user line that carried this result — when the result was
   * RECORDED. With the call's own `timestamp` on the tool block, the two are
   * the call's wall time from issue to result, which is more than the tool's
   * own run when something sat in between (a parallel batch, a permission
   * wait): against the duration Glob and WebFetch self-report
   * (`toolUseResult.durationMs`), the span never undershoots and lands within
   * 20 ms for 72 of the 93 in this corpus (median +6 ms), with the rest
   * overshooting by up to 90 s of real waiting.
   */
  timestamp: string | null;
  truncated: boolean;
  totalChars: number;
  isError: boolean;
  /**
   * When output was offloaded to disk: path of the .txt file relative to
   * ~/.claude/projects (it may live under a DIFFERENT session's dir, e.g.
   * when a subagent report quotes it). Fetch via /api/tool-results?path=.
   */
  offloadedFile: string | null;
  /**
   * `AskUserQuestion` only: the answers as Claude Code recorded them
   * STRUCTURALLY (`toolUseResult.answers`, question text -> what was chosen),
   * which is the only unambiguous form of them.
   *
   * The prose in `text` says the same thing as `"question"="answer"` pairs, and
   * reading it back is guesswork the moment either half contains a quote — 7 of
   * the 64 questions in this corpus do. One of them ("¿Quieres poder marcar
   * repos como "solo lectura"?") lost its answer entirely that way, and an
   * answer carrying a quote was truncated at it.
   *
   * Null for the transcripts that never wrote it (a declined question records
   * no answers at all), where the prose stays the fallback.
   *
   * One value is a sentinel and not an answer: `(notes only)` means no option
   * was taken and a note was written instead — see `annotations`. The prose
   * spells that same case `=(no option selected)`, so the two forms disagree
   * on the one thing they both record.
   */
  answers: Record<string, string> | null;
  /**
   * `AskUserQuestion` only: `toolUseResult.annotations`, question text -> what
   * the user attached to their answer.
   *
   * `notes` is free text written BESIDE a pick, and this is its ONLY copy: the
   * answer string does not carry it, and in the prose it runs straight into the
   * tool's own closing sentence with nothing but `. ` between them, so it
   * cannot be read back from there. All three in this corpus state a real
   * requirement ("Esta opción, pero explicando el motivo (si se conoce)",
   * "Pero con sangría, que se note que no es un prompt normal") — which is
   * exactly the half of an answer that changes what gets built.
   *
   * `preview` is the drawing of the option that was taken, normally the same
   * string as that option's own `preview` in the tool input — which is where
   * the viewer reads it from. Kept as the fallback for the versions whose
   * echoed `questions` dropped previews altogether (2.1.221).
   *
   * Null when the line wrote none. The field is optional, is sometimes `{}`,
   * and carries an entry only for the questions that really have something:
   * 24 of the 33 structured results here, 20 previews and 3 notes.
   */
  annotations: Record<string, { preview?: string; notes?: string }> | null;
  /**
   * `AskUserQuestion` only: `toolUseResult.response`, freeform text answering
   * the card as a whole rather than any one of its questions. Nothing on this
   * machine has written one yet — it is in the tool's output schema, and this
   * app can produce one from the composer — so it is carried rather than
   * assumed absent.
   */
  response: string | null;
  /**
   * `ExitPlanMode` only: whether the user approved the plan, and what they said
   * if they did not. Null on every other tool, and on a plan still awaiting an
   * answer — which is a real state, not a missing one.
   */
  plan: PlanOutcome | null;
  /**
   * `SendUserFile` only: the files that were handed over, off
   * `toolUseResult.attachments`. Null on every other tool.
   *
   * The call's own input already names the files, so this is not how the viewer
   * learns THAT something was sent — it is the only place the size, the media
   * type and `pathValidated` exist. 10 calls in this corpus, 9 of screenshots
   * and one of a `.md`.
   */
  attachments: SentAttachment[] | null;
}

export type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'command'; text: string }
  /**
   * An image attached to a prompt. The transcript stores it inline as base64
   * (`source.type: 'base64'` is the only form seen), so it rides along in the
   * response instead of sitting behind an endpoint: every attachment on this
   * machine adds up to 1.6 MB, the heaviest session to 0.43 MB.
   *
   * Screenshots returned by TOOLS are a different problem with the same shape —
   * 519 of them, 116 MB inside ONE session — and are deliberately NOT carried
   * here, for the reason tool output is not indexed either.
   *
   * `data` is null only when the line held something we cannot decode, and that
   * is the one case where the viewer may say the image is unavailable.
   */
  | { kind: 'image'; mediaType: string | null; data: string | null }
  /**
   * A line Claude Code injected into the conversation itself — today a
   * background command or an Agent reporting back (`origin.kind`,
   * e.g. `task-notification`). It wears the `user` role in the transcript but
   * nobody typed it, so it gets its own panel: it OPENS a turn (a real exchange
   * follows) and has to look like an event, not like a prompt.
   *
   * `text` is the block's own `<summary>` — the readable line. The fields below
   * are the rest of what a `<task-notification>` carries and used to be thrown
   * away with it; every one of them is null on a notice that is not one (and on
   * the older transcripts, which had no background tasks to report).
   */
  | {
      kind: 'notice';
      origin: string;
      text: string;
      /**
       * `<task-id>`. For an Agent it IS the `agentId`, which is the only exact
       * link between a report and the subagent transcript that produced it. A
       * background COMMAND notifies through this same channel with an id of its
       * own (9 characters, matching no transcript), so a reader must check it
       * against the session's subagents rather than assume every notice is an
       * agent's.
       */
      taskId: string | null;
      /** `<tool-use-id>`: the call this is the answer to — what a "go to the call" link needs. */
      toolUseId: string | null;
      /** `<status>` verbatim, `completed` or `failed`. 4 of the 6 agents in one session here failed. */
      status: string | null;
      /**
       * `<result>`: the whole report the agent handed back. It exists ONLY here —
       * the tool result of the call is boilerplate ("Async agent launched
       * successfully…") and the parent transcript holds the deliverable nowhere
       * else. Not truncated: 53 of them in this corpus, p50 22.5 KB, max 56.7 KB,
       * and cutting at the tool-result limit would halve most of them.
       */
      result: string | null;
    }
  /**
   * The user pressing stop: Claude Code closes the turn by writing
   * `[Request interrupted by user]` as a `user` line, and it wears the same
   * shape a real message does — an ARRAY holding one `text` block, the marker
   * and nothing else, no `origin`, `isMeta` false, and the interrupted turn's
   * own `promptId`. All 9 in this corpus are exactly that, so the text is the
   * only discriminator there is; a typed prompt cannot be confused with one
   * because a typed prompt is a string.
   *
   * Read as the prompt it looks like, it opened a turn of its own and drew a
   * bubble saying words the user never typed — and `isPromptItem` counted it, so
   * every fold header above it said one prompt too many.
   *
   * `forToolUse` is the `… for tool use` wording (3 of the 9): the stop landed
   * on a tool call rather than on prose. Both flavours only ever follow a
   * `tool_result` or a prompt, never open a turn, and are the last thing in the
   * one they close.
   */
  | { kind: 'interrupt'; forToolUse: boolean }
  /**
   * The session entering or leaving plan mode. Claude Code records it as an
   * `attachment` line of its own — with a uuid and a timestamp, unlike the
   * `permission-mode` sidecar, which carries neither and can only be read
   * positionally.
   *
   * `exit` is the one to be careful with: the transcript writes 60 of them here
   * against 11 entries, because it also fires on the first prompt of every CLI
   * run whether or not plan mode was ever on. So an exit is only emitted when an
   * entry is open — otherwise the viewer would announce the end of something
   * that never started, in sessions that never planned at all.
   *
   * `reference` is the plan being re-injected to survive a compaction, and it is
   * the only one carrying `planContent`: the whole markdown, inline.
   */
  | {
      kind: 'plan-mode';
      event: 'enter' | 'reentry' | 'exit' | 'reference';
      /** `~/.claude/plans/<slug>.md`. Claude Code precomputes it from the slug, so it is set even before a plan exists. */
      planFilePath: string | null;
      /** Whether that file was already on disk when the line was written. Absent on a re-entry. */
      planExists: boolean | null;
      /** `reference` only: the plan itself, carried through the compaction. */
      planContent: string | null;
    }
  /** The output of a `/context` run, parsed. */
  | { kind: 'context'; snapshot: ContextSnapshot }
  /** A compaction boundary, with what it dropped. */
  | { kind: 'compact'; boundary: CompactBoundary }
  | {
      kind: 'tool';
      toolName: string;
      toolUseId: string;
      /**
       * The `tool_use` line's own clock — when the call was issued. A streamed
       * message writes one closed block per line, each with its own timestamp,
       * and the merge by `message.id` keeps only the message's first and last;
       * this is the per-call one, kept before the merge flattens it.
       */
      timestamp: string | null;
      inputSummary: string;
      /**
       * What the model said it was doing, in its own words: the `description`
       * Claude Code makes it write for every Bash and PowerShell call, and the
       * `activeForm` of a task. Null when the call carries neither, or when the
       * summary above already IS it (an Agent call is named by its description).
       * See `toolIntent` — and note it is drawn BEFORE `inputSummary`, which is
       * the order `findInSession` has to fold it in.
       */
      intent: string | null;
      input: unknown;
      result: ToolResultInfo | null;
      /** Set when this tool_use spawned a subagent (Task tool). */
      agentId: string | null;
    };

export interface MessageItem {
  uuid: string;
  /** Extra line uuids merged into this item (streamed assistant chunks). */
  aliasUuids: string[];
  role: 'user' | 'assistant' | 'system';
  timestamp: string | null;
  /**
   * Timestamp of the LAST streamed chunk of this message (equal to `timestamp`
   * when it was written in one line) — the two together are how long the answer
   * took.
   */
  endTimestamp: string | null;
  model: string | null;
  isMeta: boolean;
  /**
   * The summary a compaction wrote, not something the user typed. Claude Code
   * appends it as an ordinary `user` line with string content (no `usage`), so
   * nothing but this flag tells the two apart — and the transcript's own
   * `compactMetadata.preservedSegment.anchorUuid` points at exactly this uuid.
   * Without it the viewer showed a 17,000-character "prompt" nobody wrote.
   */
  isCompactSummary: boolean;
  /**
   * A prompt the user typed while Claude was working, so it waited in the queue
   * and was delivered when the turn ended. It reaches the transcript in a
   * different envelope from every other prompt — an `attachment` line, see
   * `queuedPrompt` — and its `timestamp` is when it was TYPED, not when it was
   * sent, so it is legitimately older than the answer above it. The viewer says
   * so rather than letting the clock read as a parsing error.
   */
  queued: boolean;
  /** system messages only */
  systemSubtype: string | null;
  /**
   * The permission mode in force when this line was written (`plan`, `auto`,
   * `default`…), verbatim. Only `user` lines carry it — it appears on no
   * assistant line in this corpus — which makes it the one record of the mode
   * that has a timestamp and belongs to a turn. The `permission-mode` sidecar
   * says the same thing with no uuid and no clock, and the `mode` sidecar says
   * something else entirely (`normal` in 1993 of 1993 lines: that is the editor
   * mode, and it never reads `plan`).
   *
   * The viewer marks only `plan`. Everything else is the ordinary state of
   * affairs, and a chip for it would be furniture on every prompt ever sent.
   */
  permissionMode: string | null;
  /**
   * A line copied into this transcript by `/branch` (`forkedFrom` on the line):
   * the exchange happened in the parent session and was billed there. Rendered
   * like any other message — it IS the context the fork started from — but its
   * cost belongs to the parent, and the fork's own total leaves it out.
   */
  carriedOver: boolean;
  /**
   * The RUN that wrote this line (`session_id`), NOT an ancestor — resuming from
   * a fresh CLI stamps that CLI's id on everything it appends here. Two
   * consecutive requests carrying different ids mean a new process re-sent the
   * whole conversation, which is why the cache went with it: the second-biggest
   * cause of a re-cache in this corpus, and unknowable without this field.
   */
  runId: string | null;
  /**
   * Set on a message a `/rewind` cut away: it stays in the file forever, but
   * nothing descends from it any more, so Claude Code stops showing it. It was
   * really said and really billed, so the viewer folds it away rather than
   * dropping it.
   *
   * The value is WHICH branch it was cut away with — the uuid of the message that
   * starts it — because rewinding twice to the same point leaves two separate
   * branches there, and they are two different pieces of history: `c0f70eda` has
   * a 9-turn one from 15:21 and a 2-turn one from 17:38 hanging off the same
   * message, and showing them as one 11-turn stretch invented a span that never
   * existed. Null means the message is part of the conversation that stands.
   */
  discardedBranch: string | null;
  /** Assistant only: tokens billed for this message; null for `<synthetic>` and for every other role. */
  usage: MessageUsage | null;
  /** Assistant only: the reasoning effort recorded on the line (`effort`), e.g. "xhigh". */
  effort: string | null;
  blocks: ContentBlock[];
}

export interface Turn {
  promptId: string | null;
  items: MessageItem[];
}

export interface SubagentMeta {
  agentId: string;
  agentType: string;
  description: string;
  toolUseId: string;
  spawnDepth: number;
  /**
   * When its transcript was last written (epoch ms), or null where the meta has
   * no transcript beside it.
   *
   * **Not something `meta.json` says** — that file holds four fields and no
   * clock. It is the mtime of `agent-<id>.jsonl`, and it is here because an
   * agent has no status anywhere: it runs inside its parent's process, so the
   * parent going idle says nothing about it. Whether it is still going is read
   * from the report it has not filed and from this.
   */
  lastWriteMs: number | null;
}

export interface FileEdit {
  tool: string; // Edit | Write | NotebookEdit | ...
  timestamp: string | null;
  oldString: string | null;
  newString: string | null; // Write stores the (truncated) file content here
  truncated: boolean;
}

export interface FileChange {
  path: string;
  edits: FileEdit[];
}

export interface SessionDetail {
  summary: SessionSummary;
  turns: Turn[];
  subagents: SubagentMeta[];
  /** `forkedFrom`: the session `/branch` copied this one's context from. */
  ancestry: { forkedFrom: string | null; descendants: string[] };
  prLinks: PrLink[];
  /** Files touched by Edit/Write tool calls in THIS transcript (subagent edits live in their own transcripts). */
  fileChanges: FileChange[];
}

export interface SubagentDetail {
  meta: SubagentMeta;
  turns: Turn[];
}
