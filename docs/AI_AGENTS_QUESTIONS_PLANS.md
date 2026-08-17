# Subagents, offloaded output, questions and plans

**Load this when:** you touch subagent parsing or the ⑂ panel, `AskUserQuestion` answers, plan mode, or the `tool-results/` files — `parser.ts`, `lib/subagents.ts`, `AnsweredQuestion.tsx`, `PlanCard`, `lib/plans.ts`, `routes/subagents.ts`, `routes/plans.ts`, and the composer half in [AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md).

Line-level format is in [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md) (task notifications especially); their cost in [AI_COST_AND_CONTEXT.md](AI_COST_AND_CONTEXT.md); how the panel draws all this in [AI_VIEWER.md](AI_VIEWER.md).

## Invariants

- **A subagent is three things in three places** — the call, the report, its own transcript — joined by `toolUseId` and `taskId`, **never by the description**.
- **The report exists only in the parent's `<task-notification>`**; the call's own tool result is boilerplate.
- **Never assume a notification id belongs to an agent** — background commands notify through the same channel.
- **A nested agent's call and report live in its PARENT agent's transcript**, and only the search for the call says who that parent is.
- **Read an `AskUserQuestion` answer from `toolUseResult`, never from the prose** — and never `split(',')` it.
- **`annotations` is the only copy of a note** written beside a pick.
- **Read an option's drawing from the tool INPUT** (the echoed `questions` are stripped), render it in a `<pre>`, never through markdown.
- **A plan's verdict is the TYPE of `toolUseResult`**, not its wording.
- **The `plans/<slug>.md` file is a working copy that gets overwritten** — the transcript is the archive.

## Subagents

Sibling directory: `<sessionUuid>/subagents/agent-<17hex>.jsonl` + `agent-<17hex>.meta.json` (`agentType`, `description`, `toolUseId`, `spawnDepth`). The `toolUseId` matches the parent's agent `tool_use` block — the tool is called **`Agent`** in current CC, not `Task`, and nothing keys on that name precisely because it moved.

**Three artifacts, three places, and they have to point at each other:**

| Artifact | Where | Join |
| --- | --- | --- |
| The call that sent it out | parent transcript, `tool_use` | `toolUseId` |
| The report it filed back | parent transcript, `<task-notification>` `<result>` | `taskId` (= `<task-id>` = the agent id) |
| Its own transcript | `subagents/agent-<id>.jsonl` | the id in the filename |

`buildSubagentIndex` joins them on those ids and **never on the description** — it is three words and repeats across retries.

- **The report is only in the notification.** The call's own tool result is 1,084 characters of identical harness boilerplate; see [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#task-notifications) for the block's fields and for the queued envelope that carries most of them.
- **Not every notification is an agent's.** A background command notifies through the same channel with a 9-character id matching no transcript (11 of the 16 notices in `980751cb`), so look the id up in the session's subagents instead of trusting its shape.
- **A row whose call is not in this parse must say so** rather than offer a dead button — a fork copies no calls (see forks in [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#forks-forkedfrom)).
- **An agent's report may be missing legitimately.** 31 agents here find their call 31 times; only 25 have a report. "No report" with a disabled button and the reason on it is the truthful row, never a guess.

### Nested agents

**An agent can spawn agents** (`spawnDepth` 2 and up: 4 of the 31 here). Their transcripts sit in the SESSION's `subagents/` directory like any other — so they are listed and their cost counts — but **the call that created them and the report they filed are in their PARENT agent's transcript**, not in the conversation.

**Nothing in `meta.json` says who the parent is.** The only way to know is to look for the call: whichever fetched transcript holds a `tool_use` with that `toolUseId` is the agent that made it. Everything else about such a row — its times, its brief (`input.prompt` of the call there) and its report — is read from that parent's transcript too, so it can look like any other row.

Those reports only exist because a notification inside a subagent transcript is written `isMeta: true`; if they come back empty, that rule regressed ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#task-notifications)).

**The agent id is written on screen** — on the row and in the drawer header — and indexed like a session's ([AI_SEARCH.md](AI_SEARCH.md)). It is what the URL carries and what a notification calls the agent; while it appeared nowhere on the page there was no way back from the string to the thing.

## Offloaded tool outputs

`<sessionUuid>/tool-results/*.txt`. The carrying user line has the structured field `toolUseResult.persistedOutputPath` (absolute) — **use it as the primary source**. The in-text form is `<persisted-output>\nOutput too large (NN KB). Full output saved to: <abs path>` (match "output saved to:" case-insensitively).

A quoted reference (inside a subagent report, say) can point into a DIFFERENT session's directory, so keep paths projects-relative and **validate on serve**: the endpoint must verify the resolved path stays inside that session's `tool-results/`.

## `AskUserQuestion`

**The answer is written twice and only one form is unambiguous.** The carrying user line has the structured `toolUseResult.answers` (question text → what was chosen) beside `questions` and `annotations`; the result TEXT repeats it as `"question"="answer"` pairs, and reading THOSE back is guesswork — 7 of the 64 questions here carry a quote, and one (`…marcar repos como "solo lectura"…`) had its answer read off the wrong pair and lost entirely, while an answer containing a quote was truncated at it.

So: **structured field first, prose only as a fallback**, anchored on the question texts we already hold (a value ends at the first quote followed by the joiner, by ` selected preview:`, by ` notes:` or by the tool's closing sentence).

- A **decline** writes no answers at all (`"The user declined."`, with the prose spread into a character-keyed `toolUseResult`).
- A question answered with **notes alone** writes `=(no option selected)` in the prose, which cannot express it, and `"(notes only)"` in the structured field.

### Splitting an answer

**The answer to a multiSelect is ONE string joined with `", "`, and labels contain commas** ("Stash, tags y worktrees", "Detectar y guiar, resolver fuera"). `split(',')` is wrong in both directions: options really picked drew as unpicked because only half a label was looked for, and a single-choice answer whose label held a comma matched nothing and was then announced as **"typed instead"** — the viewer inventing a free-text answer nobody typed. 12 of the 64 questions here rendered wrongly.

Consume the answer **from the front, longest label first** (a label can be a prefix of another); what is left over never matched an option and IS the "Other" text — which must be shown BESIDE the picks, not only when nothing matched: 2 answers here are boxes ticked *plus* a typed requirement, and both were dropped from the page.

**`(notes only)` is a sentinel, not an answer.** `splitAnswer` matched no label against it and the card drew `✎ (notes only) — typed instead`, with the real sentence nowhere. Test the string and treat it as answered-with-no-pick.

**"Other" and a note are two different affordances**, and the corpus keeps them apart: free text goes into `answers` (7 of them, 2 alongside picks), a note goes into `annotations`, and only the note can leave the answer empty. Anything writing this format — the composer does — has to reproduce both, plus the sentinel.

`response` (freeform text replying to the card rather than to a question) and `afkTimeoutMs` (the dialog resolved itself while the user was away) are in the tool's output schema too; neither has been written on this machine yet.

### Notes (`annotations`)

**`toolUseResult.annotations[question]` is `{preview?, notes?}`** — optional, sometimes `{}`, present only where there is something to say (24 of the 33 structured results, 23 previews, 4 notes). `preview` is the drawing of the option taken, normally identical to the input's.

**`notes` is free text written BESIDE a pick and this is its only copy**: the answer string does not carry it, and in the prose it runs into the tool's closing sentence with `. ` between them. All four here state a real requirement ("Esta opción, pero explicando el motivo (si se conoce)", "Pero con sangría, que se note que no es un prompt normal") — read the pick without the note and you get the opposite instruction to the one given, so a note is drawn and never folded away.

### Drawings (`options[].preview`)

**An option can carry a DRAWING, and it is not markdown.** A mockup Claude writes to make a choice comparable — 68 of the 215 options here, across 24 of the 78 questions, 60-853 characters, p50 368, up to **19 lines by 114 columns**. It is ASCII/box-drawing art: two of them contain ``` *inside the box*, so a markdown pass eats them. Render in a monospace `<pre>` with `whitespace-pre` and a scroller of its own — wrapping one destroys it and 114 columns will otherwise push the page sideways. **Never on a `multiSelect` question** (0 of 7), which is what the tool's own schema says.

**Read it from the tool INPUT**: CC 2.1.221 strips `preview` (and `multiSelect`) from the `questions` it echoes into the result, so `edacebe6` has 3 in the input and 0 in the echo.

**A drawing is TERMINAL art, and a browser will not put it on the grid by itself.** Every character is meant to be one cell — **two for an emoji**, verified on the two framed drawings here that carry one (counting `👤` as 2 makes them rectangular, as 1 does not). But the monospace stack has no glyph for **22 of the 167 characters** these drawings use, so Chrome falls back to a proportional symbol font and draws them 0.9-2.5 cells wide: `👤` 2.497, `⟶` 2.145, `✎` 1.819, `⚙` 1.533, `✔` 1.457, `↺` 1.422. One of those anywhere in a line shifts everything after it, and it was breaking **17 of the 23 drawings Claude had drawn correctly**. No font fixes it — on this machine Cascadia Mono covers 6 of the 22, and Consolas, Lucida Console, Courier New and the generic `monospace` cover none. So `monoCells.ts` MEASURES each character against `1ch` and gives the ones that come out wrong an explicit `width` in `ch` — measured rather than listed, because a list is a list of the symbols yesterday's drawings happened to use. Only 11 characters on a whole page needed it.

**What that does NOT fix, and must never be made to: 19 of the 42 framed drawings are crooked in the transcript itself.** Claude miscounted by a character or two — including in this repo's own sessions. They are shown exactly as written, and a rendered spread of exactly one cell is the correct rendering of a one-character miscount, not a bug to chase.

## Plan mode

**It leaves five different marks and only two can be trusted on their own.** `ExitPlanMode` is the plan being submitted for approval; the verdict comes back on the result line, and **the three shapes it takes are three different TYPES**, which is what decides the reading:

| Case | `toolUseResult` |
| --- | --- |
| **Approved** (10 of the 14 archived calls) | an OBJECT, `{plan, isAgent, filePath}`, no `is_error` |
| **Refused** | a plain STRING starting `"Error: "` |
| **`EnterPlanMode`** (1 call in the corpus, input `{}`) | `{message}` |

So the TYPE is the verdict and the prose never has to be read — the tool_result text is a fixed template with the plan glued onto the end either way.

**The plan is written in up to five places per approval**: the call's input, the tool_result text, `toolUseResult.plan`, the `~/.claude/plans/<slug>.md` file, and a `planContent` copy if a compaction follows. **The FILE is the one that lies**: it is named after the session slug and **overwritten**, so a session that planned twice keeps only its latest (`quiero-que-planifiques-la-playful-pearl.md`, two approvals a day apart, only the second survives). The transcript is the archive; any UI linking to the file must say which it is showing.

**The input shape moved.** Every archived call carries `{plan}`; **2.1.233 sends `{plan, planFilePath}`**, and the tool's description now says the model should have "finished writing your plan to the plan file" first — so a future version sending NO plan at all is the direction of travel. Read the input, then `toolUseResult.plan`, then the file. The SDK's `ExitPlanModeInput` already declares no `plan` field (only a deprecated `allowedPrompts`), while `ExitPlanModeOutput` declares `{plan, isAgent, filePath?, planWasEdited?}`.

**A refusal from the app is not recorded like a refusal typed in a terminal.** Interactively: `toolDenialKind: "user-rejected"` plus a `userFeedback` field. Through the SDK's `canUseTool` deny: `toolDenialKind: "permission-rule"`, **no `userFeedback` at all**, and the message inside `toolUseResult` as `"Error: <message>"`. Reading only the field loses every note sent from this app — `planFeedback` reads both and drops the generic refusals (`The user declined.`, `The user doesn't want to proceed with this tool use…`), which say nothing about why.

**The window is marked by `attachment` lines, not by the sidecars**: `plan_mode` (entry, `{reminderType, isSubAgent, planFilePath, planExists}`), `plan_mode_reentry`, `plan_mode_exit` and `plan_file_reference` — the last carrying the whole plan inline in `planContent`, re-injected beside a `compact_boundary` so it survives the compaction. All four have a uuid and a timestamp.

- **`plan_mode_exit` is the trap: 60 of them against 11 entries.** It also fires on the first prompt of every CLI run, in sessions that never planned at all — `b343d4ac` has four and only one is real. **An exit means something only while an entry is open.**
- **`permissionMode` on the line is the only per-turn record with a clock** (`"plan"` on 18 user lines across 12 sessions; it appears on no assistant line). The `permission-mode` sidecar says the same with no uuid and no timestamp, so it can only be read positionally — and **`type: "mode"` is something else entirely**: `"normal"` in 1993 of 1993 lines, the editor mode, never `plan`.
- The plan-mode system reminder ("Plan mode is active…") is **never written to disk**: it is injected into the model's context at request time. A UI wanting that banner has to write its own.
- `ExitPlanModeV2` exists in the 2.1.233 binary — with an HTML `<section>` plan format — behind a feature gate that is off, and appears nowhere in the corpus. Do not build for it; just do not break on it.

A plan is also the one piece of tool input that IS indexed — see [AI_SEARCH.md](AI_SEARCH.md).

The Plans page orders itself with the same control as the Starred page (`askedAt`, a direction, grouping by session) — see [AI_VIEWER.md](AI_VIEWER.md). `/api/plans` still answers newest-first, which is what the page opens on.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 22 (subagents), 23 (plan mode), 24 (answered questions, drawings and notes).
