# Claude Code transcripts — the on-disk format

**Load this when:** you touch anything that reads `~/.claude` (`scanner`, `summarizer`, `parser`, `enricher`, `deepSearch`, `jsonl`), or when a session renders wrong, counts wrong or goes missing.

`~/.claude` is an undocumented internal format. Every rule here was verified empirically against the corpus on this machine and the code MUST follow it; where a rule depends on a Claude Code build, the build is named. Session ids are cited as the evidence a rule was measured on — several of those transcripts have since been swept off disk, so see [AI_TESTING.md](AI_TESTING.md#fixtures) before using one as a fixture.

Related: token and cost fields are in [AI_COST_AND_CONTEXT.md](AI_COST_AND_CONTEXT.md); subagents, questions and plans in [AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md); how all of it is drawn in [AI_VIEWER.md](AI_VIEWER.md).

## Invariants

- **Never write, create or lock anything inside `~/.claude`.**
- **Encoded directory names are lossy — never decode one.** The project path comes from `cwd`.
- **The FIRST `cwd` of a session is its project**, not the last.
- **`origin.kind` decides who wrote a `user` line.** Not the content type, not `promptSource`.
- **`[Request interrupted by user]` is the user pressing stop, not a message** — and the text is the only thing that says so.
- **A uuid seen twice is a replay of the first** — every full parse must drop it.
- **The file is a TREE.** Walk `parentUuid` from the last line; bridge compactions with `logicalParentUuid`; resolve an edge to the LAST occurrence of the parent.
- **Take the LAST occurrence of any sidecar** (they are re-appended per turn) and dedupe.
- **Wrap every `JSON.parse` of a transcript line in try/catch**: lines can be corrupt or half-written, and active files grow while being read.
- **`status` in `sessions/<pid>.json` has exactly four values**, and `waiting` means a dialog is on screen — with `waitingFor` naming it. A stop is a transition, which nothing on disk records.
- **Nothing here is permanent** — Claude Code sweeps its own history on `cleanupPeriodDays`.

## Files and directories

Paths are relative to the data root (`~/.claude` unless `--data-root` / `CLAUDE_CONFIG_DIR` says otherwise).

| Path | What it is |
| --- | --- |
| `projects/<encoded-dir>/<sessionUuid>.jsonl` | The transcript: one JSON object per line. Lines reach ~27 KB, files several MB. |
| `projects/<encoded-dir>/<sessionUuid>/subagents/` | `agent-<17hex>.jsonl` + `.meta.json` — see [AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md). |
| `projects/<encoded-dir>/<sessionUuid>/tool-results/*.txt` | Offloaded tool output (same doc). |
| `history.jsonl` | Every prompt ever typed: `display`, epoch-**ms** `timestamp`, the real `project` path, `sessionId`. |
| `sessions/<pid>.json` | Sessions running right now: `sessionId`, `cwd`, `status` (idle/busy), `pid`. |
| `plans/<slug>.md` | The working copy of a plan (overwritten — see the plan-mode rules). |
| `settings.json` | Machine-wide settings, including `cleanupPeriodDays`. Read-only to us. |

**Encoded dir names are lossy and MUST NOT be decoded**: `\ / . _ :` all collapse to `-`, while drive-letter case is preserved, so one real project can split across two dirs differing only in case. The real path comes from the `cwd` field of a message line (or `history.jsonl`'s `project`), and projects are grouped case-insensitively.

**Use the FIRST `cwd` of a session** — the launch directory, which is what `/resume` groups by. `cwd` changes mid-session when the shell cd's around, so the last one may name a subdirectory.

**~80% of files start with a timestamp-less line.** Session start = the first timestamped line within the head ~10 lines; last activity = the last timestamped line within the tail ~40. File mtime is a reliable sort proxy.

**Head-10 + tail-40 lines yield every list-view column**: title, dates, branch, model, entrypoint, slug, previews, and an approximate message count from `system` subtype `turn_duration`.`messageCount`. A full parse is only needed for token totals, PR/ancestry badges, search text and the viewer.

`turn_duration.messageCount` counts **context entries** (tool results, streamed chunks…), not conversational messages — label it accordingly.

Many sessions are throwaway stubs (≤16 lines, only slash commands, no title): flagged `isEmpty` and hidden by default.

## Line types

**Message lines** (`user` / `assistant` / `system` / `attachment`) carry `uuid`, `parentUuid`, `timestamp` (ISO-8601 UTC), `cwd`, `sessionId`, `version`, `gitBranch`, `slug`, `promptId` (groups a turn), `isMeta` (filter for previews), `entrypoint` (`cli` / `claude-desktop` / `claude-vscode`), `sessionKind` (`"bg"` = background session). Assistant lines add `message.model`, `message.usage` and `effort`.

`entrypoint` is per line, but resuming in another client creates a NEW session file, so files are uniform in practice (verified: no mixed files).

### `system` lines, by subtype

Seven exist in this corpus, and **only three ever carry `content`** — the rest keep their payload in fields of their own, so the parser's `if (!text) continue` drops them and nothing downstream has to know they were there.

| subtype | lines | What it is |
| --- | --- | --- |
| `turn_duration` | 364 | per-turn timing; dropped outright (its `messageCount` is read from the head/tail scan instead, and the viewer times a turn from the turn's own stamps — `turnSpan`, which agrees with `durationMs` within ms where no human wait sits inside the turn and is deliberately LONGER where one does: `durationMs` excludes time blocked on a permission or a question, wall time includes it. The line is also missing where a fallback would be needed anyway — interrupted turns get none, CLIs ≤ 2.1.202 write none at all) |
| `away_summary` | 147 | **the recap below** |
| `local_command` | 65 | the slash command that was typed, as `<command-name>` markup |
| `stop_hook_summary` | 40 | a Stop hook's report — in `hookInfos` / `hookErrors`, **no `content`** |
| `compact_boundary` | 4 | its own panel; the arithmetic is in `compactMetadata` ([AI_COST_AND_CONTEXT.md](AI_COST_AND_CONTEXT.md)) |
| `informational` | 2 | a notice Claude Code wrote to the transcript (auto mode explaining itself) |
| `api_error` | 1 | the error and its retry counters, **no `content`** |

**`away_summary` is the best paragraph a session contains about itself**, and the one thing here written to be read by a human who was not watching: *"Estamos añadiendo acceso remoto (LAN/WireGuard) a claude-history, ya implementado y probado salvo el botón «Open the port». Acabo de arreglarlo y reiniciar la preview…"*. 147 of them across 56 sessions, always in the tree (147/147 carry a `parentUuid`), never `isMeta`.

- **Claude Code calls it a recap, not an away summary.** The setting is `awaySummaryEnabled` and the line says `away_summary`, but its config offers to "disable recaps" and its own log tags the job `ccr_recap_generate` — so `recap` is the word the app shows (`web/src/lib/systemLines.ts`), and the identifier stays where identifiers belong.
- **There is NOT one per turn, and a gap means nothing.** Verified against the 2.1.234 bundle, which enumerates why it skips: at or near a rate limit, a draft in the input box, background work pending, a loop wakeup pending, a `StructuredOutput` recap already present, no cached params or params gone stale — and `ccr recap dropped: new turn already running`, i.e. it is generated after a turn ends and abandoned if the next one starts first. Never read the absence of a recap as "nothing happened".
- **It is written minutes AFTER the turn it summarises, and filed INSIDE that turn.** Its `parentUuid` is the line that CLOSED the turn — normally the `turn_duration` one — and the parser has no turn of its own to give it (`ensureTurn`), so a recap is usually the newest stamp its turn carries: 267 of the 268 here land more than 30 s after the line above them, p50 185 s, once 16.4 hr. That gap is the reader's absence and not the work, which is why the fold strip counts a recap and refuses to time it ([AI_VIEWER.md](AI_VIEWER.md)) — and why the row above can claim `turnSpan` agrees with `durationMs` at all.
- **It is the ONE `system` line a search can reach, and the one drawn in full** (`RECAP_ROLE` and `systemChars`, [AI_SEARCH.md](AI_SEARCH.md)). The 400-character cap the others live under is for markup — `local_command` reaches 2,456 — and a recap is prose; exempting it is what made its last sentence both visible and findable. Every other subtype stays invisible to the index and to the deep scan alike (the scan walks `message.content`, and a system line has none), so only the viewer's find bar sees those, and that remains a gap rather than a decision.

**Sidecar lines** mostly have NO timestamp: `last-prompt`, `mode`, `permission-mode`, `bridge-session`, `queue-operation`, `file-history-snapshot` (line ~2; its `snapshot.timestamp` ≈ session start), `file-history-delta`, `pr-link` (`prNumber` / `prUrl` / `prRepository`), plus the title lines below. Every type is re-appended per turn — always dedupe (`pr-link` by `prUrl`).

**There are no `type:"summary"` lines** (that was the pre-2.1 format). Titles are sidecars appended repeatedly over a session's life — `custom-title`, `ai-title`, `agent-name` — so always take the **last** occurrence. Precedence: `customTitle` → `aiTitle` → `agentName` → last `last-prompt`.`lastPrompt` (pre-truncated ~200 chars) → first non-`isMeta` user message with string content → session UUID.

**Thinking blocks are empty in recent CC versions**: `{"type":"thinking","thinking":"","signature":"..."}` — only the signature is persisted. Some older sessions carry plaintext thinking, so the UI must not assume the text exists either way. Censused across the corpus: **5,460 blocks, 396 with text (7%)**, and it is not a clean cutoff by version — 2.1.202 (158/158) and 2.1.219 (211/211) are whole, 2.1.229 has 24 of 867, 2.1.233 three of 1,654, and 2.1.200, 2.1.220–228, 2.1.232 and 2.1.234 have none at all.

**So the status line the CLI shows while it works is NOT on disk, and there is nowhere to get it.** Sentences like *"Refining port-open UX flow; investigating message state transitions"* are the SUMMARISED thinking the API streams — Claude Code asks for it with `thinking.display: "summarized"` when its `showThinkingSummaries` setting is on (verified in the 2.1.234 bundle) — and what reaches the transcript is the emptied block above. Searched for verbatim across the whole of `~/.claude`: present only in `history.jsonl` and in the session where the user typed the words into a prompt, absent from the session that displayed them. It is the live-streaming wall of the section below, in another guise: during a turn nothing under `~/.claude` is written but the transcript. **Do not try to recover it** — the only channel carrying it is the IDE socket, and posing as an IDE is forbidden.

**The one prose a tool call does carry is `input.description`** — what the model says it is DOING, as opposed to what the call is. Claude Code requires it for **Bash and PowerShell, 4,907 calls here and 100% of both**; `Agent` and `TaskCreate` carry one too (`TaskCreate` adds `activeForm`, the present-continuous the CLI puts in its spinner), and no other tool has it: 5,057 of 12,612 calls, 40%. It is short, it is the only thing on a `cd … && sed -n '…' | head -45` line that says why, and it is worth surfacing rather than folding away — `toolIntent` is where that decision lives, drawn by `ToolBlock` and indexed under `INTENT_ROLE` ([AI_SEARCH.md](AI_SEARCH.md)).

**Attached images ARE stored, inline and in full**, unlike thinking: a `user` line's `content[]` carries `{type:'image', source:{type:'base64', media_type, data}}` (`base64` is the only `source.type` observed). The viewer claimed "not stored in transcript" for a year and it was simply false. Inlining them in the API response is safe — **33 attachments in the whole corpus, 3.8 MB**, heaviest session 1.8 MB (`9ef9f798`). A prompt queued while Claude was working carries the very same block in its own envelope ([below](#queued-lines-attachment--queued_command)).

- **An image with no text beside it is a real message**, 1 of the 31 lines carrying one here (`6f42e08b`): `content[]` is a single `image` block. It gets a bubble like any other — `isPromptItem` (a text or command block) is what it does not get, so it is drawn without being counted as a prompt. Both envelopes must keep such a line rather than test the text and drop it.

- **Tool-returned screenshots are the same shape and the opposite problem**: 519 image blocks nested in `tool_result.content[]`, **116 MB inside ONE session** (whose transcript is 334 MB). They follow the tool-output rule ([AI_SEARCH.md](AI_SEARCH.md)) — if they are ever rendered it must be on demand, from an endpoint that re-reads the line, never in the conversation payload.
- Base64 must stay out of both search corpora. It does because every text extractor picks named fields (`text`) instead of stringifying blocks — `extractResultText`, `toolResultText` and the enricher all do. One `JSON.stringify(block)` would put megabytes of it into the index.

**`SendUserFile` delivers files by PATH and keeps no bytes at all** — the third shape, and the opposite of both above. The call carries `files[]` (absolute, and both separators occur), `caption`, `status` (`normal` or `proactive`) and sometimes `display` (`render`, absent in 3 of 10 calls). The `tool_result.content` is a plain **string** — `N files delivered to user.` and then one `<path> → file_uuid: <uuid>` per line — and the carrying line's `toolUseResult` holds `caption`, `display` and `attachments[]` with `path`, `size`, `isImage`, `media_type`, `pathValidated` and `file_uuid`. **There is no `image` block anywhere in a delivery**: 10 calls, 19 files, 5 sessions, 0 bytes.

- So the paths are read from the CALL, which is the authoritative list and is never truncated, and the sizes from `attachments`, joined on the path. Never from the result's prose: a filename containing ` → ` or a newline would yield a path that opens nothing, and `file_uuid` — the id of the upload to claude.ai — is worth nothing locally, which is why it is the one field deliberately not carried.
- The bytes live only in the session's temp scratchpad (`%TEMP%\claude\<project-encoded>\<session>\scratchpad`), which is swept. `f3384d17`'s three PNGs are already gone while `fbc2e20c`'s three are still there, so **"the file no longer exists" is an ordinary state of a delivery**, not a failure — and any check that wants to see a picture has to find its own fixture ([AI_TESTING.md](AI_TESTING.md)).
- The same PNG can be in the transcript twice over and still not through this: `fbc2e20c` also `Read` those files, and a `Read` of an image writes its base64 into `tool_result.content[]` **and** again into `toolUseResult.file.base64` — ~145 KB per line, for one screenshot.

**`ReportFindings` carries a code review's whole product in the CALL** — the fourth shape, and the one where the result is worth nothing at all. A `/code-review` reports through it and is told not to print the findings as text as well, so `input.findings[]` is the only copy: `file` (repo-relative), `line`, `category`, `short_summary` (capped at 60 characters), `summary`, `failure_scenario`, and optionally `verdict` and `outcome`, plus a `level` on the call. **The order is the ranking** — "most-severe first", and there is no severity field to sort on afterwards. The `tool_result.content` is the string `N findings reported.` and the carrying line's `toolUseResult` is `{count, findings}`, a normalised copy of what was already sent; nothing is joined from either.

- **A rejected report is an ordinary event, and it duplicates the review.** The harness validates the schema and answers `is_error` with a Zod `InputValidationError` (760 characters of it in `c483a438`, for three `short_summary` over the cap), and the model retries with almost the same list — so one review is two calls carrying 24 findings between them where there were 12. Only the result tells them apart.
- **One session in the corpus uses the tool** (`c483a438`, 2 calls, 12 findings), and `verdict`, `outcome` and `level` appear in none of it. They are read as optional rather than defaulted: a verdict nobody reached must not draw as one that was.

## Who wrote a `user` line

`user` `message.content` is a **string** or an **array** (the tool_result carrier) — always distinguish. But a string is NOT proof a human typed it:

> **`origin.kind` is what says who wrote the line, and only `human` is the user.** No `origin` field → the human typed it (older transcripts, from before background tasks existed); any kind other than `human` → it did not.

Claude Code injects `<task-notification>` blocks down the same path when a background command or an Agent finishes: 219 of them here across 18 sessions, 80 in `1decb824` alone — which is why that session reported **92 prompts when it really had 12**. All 219 carry `origin`, none is labelled `human`, and no older line carries a notification, so the rule above is exact.

**`promptSource` is not the discriminator** (`typed` / `queued` / `sdk` / `system`): a human prompt sent through the SDK reads `sdk` there, and so do most notifications.

The damage of getting this wrong reaches everywhere a prompt is counted: `userMessageCount`, the daily buckets behind the stats chart, the indexed corpus, the "N prompts" on every fold header, and `hasRealPrompt`, which decides `isEmpty`. (`firstPromptPreview` and the `first-message` title fallback read the head-25 lines only, so no title on this machine ever came from a notification — luck, not design.)

### Task notifications

They are **tool output wearing the user role**, so they follow the tool-output rule: not counted as prompts, not in the search index. `parser.ts` emits a `system` item with the origin as its subtype and the block's own `<summary>` as the text ("Background command … completed (exit code 0)").

**Whether one opens a turn is decided by the ENVELOPE, and the two are cleanly separated** — 175 notices over this corpus, not one sitting between them:

| | Queued: it landed **with a turn in flight** | `user`: it landed **with the turn closed** |
| --- | --- | --- |
| the line | `attachment`, `attachment.type: queued_command`, `commandMode: "task-notification"` (120/120) | `user`, string content, `origin.kind: "task-notification"` (59/59) |
| `promptId` | **none at all** (116/116) | **its own, fresh** (59/59) |
| `parentUuid` | a line from INSIDE the turn (a `tool_result`) | the line that CLOSED the turn — `turn_duration`, the last `assistant` on `end_turn` |
| its stamp vs its parent's | **negative**, p50 −10 s | **positive**, p50 +78 s, up to 27 min |
| `queue-operation` trail | `enqueue` … `remove`, at delivery | `enqueue` → `dequeue` ~10 ms later, nothing was running |
| what it does | **joins the open turn** (`ensureTurn`) | **opens a turn** |

The queued envelope *means* "a turn was running" — it is the same one a prompt typed mid-turn arrives in, and it gets the same treatment for the same reason: a turn of its own cut the thread where Claude had not stopped, splitting one stretch of work in two and the turn's cost and context badges with it. Its stamp is **when the TASK finished, not when the news was handed over**, so it is legitimately older than the answer above it, and `notice.queued` carries that to the viewer, which draws it on the answers' rail with a chip for the clock ([AI_VIEWER.md](AI_VIEWER.md)).

The `user` envelope is the other half of the same fact: the session had gone quiet and the notification is what woke it, so a real exchange follows and the turn is real. **Except behind another notice** — agents that finish together are delivered back to back, and a turn each leaves all but the last holding nothing but the news.

**The block carries eight fields and only one is noise**: `<task-id>`, `<tool-use-id>`, `<status>` (`completed`/`failed`), `<summary>`, `<result>`, `<usage>` (`subagent_tokens`, `tool_uses`, `duration_ms` — an agent's, and not to be confused with what the transcript bills), `<event>` and `<output-file>` — the last worth dropping (it points at a temp copy of the subagent's own JSONL). Not every producer writes every one, and **`<tool-use-id>` is the field to be careful about, because it is the only link back to what started the task** — `?tool=` resolves it against any `data-tool-id`, so its presence is exactly whether the notice can offer `↑ the call`:

| Producer | Notices | Names a `<tool-use-id>` | It resolves in the same transcript |
| --- | --- | --- | --- |
| Agent | 121 | 120 | 120, to the `Agent` call |
| Background command | 56 | **56** | 56, to a `Bash` (50) or `PowerShell` (6) call |
| `Monitor` event | 1 | 0 — `<event>` and no `<status>` either (`f3384d17`) | — |
| MCP task | 1 | 0 (`670bfd31`) | — |
| `<fork-source>` | 1 | 0 | — |

So **171 of the 175 name a call, and all 171 resolve** — a background command is not the poor relation this used to claim ("`<task-id>` + `<status>` + `<summary>` and nothing else"): it carries `<tool-use-id>` and `<output-file>` too, in all 56 here. An **MCP task** is a tool that outstayed its 120 s and was moved to the background (`<task-id>` of 9 characters, `<status>`, `<summary>` "MCP task … completed.", `<result>` a JSON blob); **`<fork-source>`** is the odd one out entirely — no `<task-id>`, no `<summary>`, no `<status>`, just a paragraph saying this session began as a copy of one still running, which leaves `parseNotification` holding the raw block as its `text`.

**A notice that names no call can still be traced, by its `<task-id>`, and two joins do it** — which is what leaves only the `<fork-source>` line with no origin at all:

- **The agent's `meta.json`**, when the `<task-id>` is an agent's: it records the `toolUseId` that sent it out, and every one of the 31 metas here finds its call. This is the case of an agent that was **resumed** — it files a second report and that one names no `<tool-use-id>` (`15a86025`).
- **The launching tool announces the id in its own `result`**: "Command running in background with ID: …", "Monitor started (task …", "moved to the background as task …", "agentId: …". The sentence differs per producer and is never read — **the id is the join**, and first mention in transcript order is the launch. A `TaskOutput` poll and a `TaskStop` name the same id later, and a `Read` of the task's `.output` file names it in its *input*, which is why only results are searched. Checked against the 177 notices whose answer is already known: same call 177 times, a different one never.

**`<result>` is the whole report an agent handed back, and this is its only copy in the parent transcript.** The tool result of the call itself is 1,084 characters of harness boilerplate ("Async agent launched successfully… never quote any part of it"), identical for every call. 53 reports here, 1,076 KB, p50 22.5 KB, max 56.7 KB — so `parseNotification` does not truncate them, where the tool-result limit would halve most.

The same `task-id` **may notify more than once** (its own `<note>` says so: an agent can be resumed with another message). How `<task-id>` and `<tool-use-id>` join a notification to an agent is in [AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md).

**Inside a SUBAGENT transcript the same notification is written `isMeta: true`** — that is how an agent learns one of its own agents has finished. The parser drops isMeta user lines (only `/context` survived), so the reports of every nested agent were read and thrown away: 4 of the 37 notifications in subagent files, against 0 of the 69 in session files. Test `injectedOrigin` BEFORE the drop; it is exact — of the 73 isMeta user lines in this corpus, those 4 are the only ones carrying an `origin` at all.

### Queued lines (`attachment` / `queued_command`)

**Anything that queues while a turn is in flight never comes down the `user` path at all.** It is queued (`queue-operation`, `enqueue`/`dequeue`, a sidecar with no uuid) and delivered as an **`attachment` line whose `attachment.type` is `queued_command`**, its `prompt` holding the payload. It is the only attachment type that is ever a message — the rest are context deltas (`total_tokens_reminder` 1,508, `task_reminder` 745, `deferred_tools_delta`, `skill_listing`, …).

Two things arrive in that envelope, and both were being lost. 144 `queued_command` lines here: **120 notifications and 24 typed prompts**, nothing else — and **`commandMode` is what Claude Code itself calls them apart by**, `"task-notification"` against `"prompt"`, agreeing with `origin` on all 144.

- **Notifications**: 3 of the 5 agent reports in `980751cb` and 4 of the 5 in `b343d4ac`. Reading only `user` lines rendered them nowhere. They join the open turn like everything else in this envelope ([Task notifications](#task-notifications)) — and they must be recognised by the envelope rather than by finding `<task-notification>` in the payload, or a prompt merely QUOTING the tag becomes a notice and stops being a prompt anywhere. Nothing on disk trips that (no crossing in 144), which is why the affirmative test comes first: ask `queuedByHuman`, and only then look at the block.
- **A prompt the user typed while Claude was working**, which is a prompt like any other. **The attachment line is the only copy** — no `user` line repeats the text (checked on all 10 there were then) — and it is a real node of the tree, with the answer hanging off its uuid. The failure was silent and asymmetric: `history.jsonl` keeps every typed prompt, so the Prompts page listed "No te dejes nada" while the session it belongs to showed nothing at all, in neither the count, the daily buckets nor the search index.

**`prompt` is a string until an image is pasted into it, and then it is the content-block array a `user` line uses** ([Line types](#line-types)). 141 of the 144 lines here carry the string — every notification does, and only 3 of the 24 typed prompts do not — and all 39 did when this envelope was first read — so the array shape reproduced the whole bug one shape later, on both lines that have it: `str()` answers null for an array, the line was skipped outright, and "No sé que has hecho, pero acaba de aparecer este popup" in `c98565c7` was in `history.jsonl` and on the Prompts page while its own session, its counters and the index had nothing. Read BOTH shapes (`queuedText`): text blocks joined for the text, `image` blocks for what was pasted, in payload order. The `[Image #N]` marker Claude Code writes into the text is part of the text, so it needs no handling of its own.

**The test is affirmative — `attachment.origin.kind === 'human'` — and inverting it is the trap.** A notification carries no `origin` whatsoever (`{type, prompt, commandMode, timestamp}`, 120 of 120), so `injectedOrigin`'s rule for `user` lines ("no origin means the human typed it") says the exact opposite here and would turn every one of them into a prompt. `queuedByHuman` is the one implementation — text and images both come through it — and it does not reuse `injectedOrigin` for that reason. **It is also asked FIRST**, before the payload is looked at at all, so nothing a human typed can be read as a notification by its words.

**Its `timestamp` is when it was TYPED, not when it was sent** (13:44:06 against a turn that ended at 13:44:45 in `15a86025`), so it is legitimately older than the answer above it. `MessageItem.queued` carries that to the viewer. A notification's stamp reads backwards for the same reason and says something slightly different — when the TASK finished — and `notice.queued` is what carries that one.

**Nothing in this envelope opens a turn — it joins the one already open** (`ensureTurn`), prompts and notifications alike, because being in this envelope IS the evidence that a turn was running. Claude Code agrees for the prompt: the `last-prompt` written straight after delivery still names the PREVIOUS prompt, in both cases here. A turn of its own cut the conversation where nothing had ended — in `b343d4ac` the line lands between a `tool_result` and three more `tool_use` calls of one piece of work. Drawn inside the thread its clock also stops reading backwards. It cuts the tool run it landed in, and for once that is free: the cut falls BETWEEN items, never inside one, so no assistant message has its calls split across two runs and `costOwner` has nothing to undo (checked: priced entries equal assistant-messages-with-usage, 13/75/609/736, zero double-billed).

### The stop marker (`[Request interrupted by user]`)

**When the user presses stop, Claude Code closes the turn by writing a `user` line that looks exactly like a message**: `message.content` an ARRAY holding one `text` block, the marker and nothing else, no `origin`, `isMeta` false. Two wordings, 9 lines over 7 sessions here — `[Request interrupted by user]` (6) and `[Request interrupted by user for tool use]` (3), the second when the stop landed on a tool call.

**So the text IS the discriminator, and nothing else on the line is**: `origin.kind` says "the human typed it" (there is no origin), the array shape says "tool results" (there are none), and read either way it became a prompt bubble quoting words nobody wrote — plus a prompt in every count above it. A typed prompt can never be confused with one: a typed prompt is a string ([Who wrote a `user` line](#who-wrote-a-user-line)).

**It carries the interrupted turn's own `promptId` and JOINS that turn** (9 of 9). It is always the last thing in it, always follows a `tool_result` or the prompt itself, and a turn of its own left it holding the turn's cost badge — the badge belongs to the prompt above. `803312ad` is the one that arrives with no turn open in this run, so the `promptId` is still worth keeping.

The reply it cut short is billed and stays; what follows is often an assistant line reading `No response requested.` — an artefact of the SDK, not an answer.

## The tree: rewinds, forks and replays

**A transcript is a TREE, and a `/rewind` leaves a whole branch in it.** Nothing is ever deleted: the new prompt is re-parented onto the message the user went back to, and the abandoned branch stays in the file forever. Claude Code walks `parentUuid` from the last line and shows only what is still connected — so a viewer that reads the file in order invents conversation, which is exactly what `c0f70eda` did: 9 turns, including 8 "You've hit your session limit" exchanges, drawn between the compaction and the live answer. `parser.ts` marks them (`MessageItem.discarded`) and the viewer folds them behind one header — folded, never dropped: they were really said and really billed.

Three rules, each bought with a wrong answer on real data:

1. **A compaction breaks the chain.** The boundary has `parentUuid: null` and `logicalParentUuid` pointing at the pre-compaction tail (56 of 56 mid-file roots in this corpus are boundaries, and all 56 carry it). Without that bridge the walk stops at the last compaction and **99.9% of `cae7f9f5`** reads as discarded.
2. **An edge resolves to the LAST occurrence of the parent before it.** A replayed stretch repeats uuids verbatim and the conversation continues from the COPY (`b3062149` is written at line 5492 and again at 8265; line 8266 attaches to the second). Resolving to the first re-attached that edge a day earlier and condemned **2,147 real lines of `0f5b1c8b`**.
3. **A branch holding a `compact_boundary` is never folded away.** A boundary is Claude Code stating that this stretch *became* the context that followed, so it happened whatever the tree says — and the viewer's "earlier context" sections are built from those lines. This keeps 4,163 lines of `0f5b1c8b` visible.

Anything the walk cannot reach (a parent not in the file — 3 sessions here) is **left visible**: showing an abandoned message is a far smaller error than hiding a real one. Same reason a turn cut in the middle is not split — two halves would each claim the turn's cost badge — it carries a "rewound away" notice instead.

**One message can have several abandoned branches, and they are not one stretch.** Rewinding twice to the same point leaves one branch per rewind, all siblings of the live one: `277ac189` in `c0f70eda` has three children — `/review PR 1968` (15:21, 9 turns, cut by the first rewind), `Estado actual?` (17:38, 2 turns, cut by the second) and the conversation that stands (18:49). They are adjacent in the file, so folding "consecutive discarded turns" merged them into an 11-turn stretch dated 15:21 → 17:39, **a span nothing ever occupied**. The parser therefore reports WHICH branch cut each message away (`MessageItem.discardedBranch` = the uuid that starts it) and `groupTurns` only merges turns sharing one.

**Claude Code's own title and `last-prompt` go stale across a rewind**: `c0f70eda` was still called `❯ /review PR 1968 … (Branch)` (`custom-title`, `agent-name`, and `name` in `sessions/<pid>.json`) after that very prompt was discarded, and `last-prompt.leafUuid` still pointed at the abandoned branch's last line. The sidecar leaf is NOT a way to find the live branch, and the app shows the stale title faithfully because that is what Claude Code shows.

### Forks (`forkedFrom`)

**Real ancestry has exactly one source: `forkedFrom`** (CC 2.1.220+), `{sessionId, messageUuid}`, stamped on every line `/branch` copies — with `messageUuid` equal to the line's own uuid, i.e. "this line is a copy of that message".

A `/branch` copies **the live context and nothing else**: from the last `compact_boundary` to the end of the parent, every uuid-bearing line (86 of the 146 lines in that range for `c0f70eda`; the 60 skipped are all sidecars). Consequences:

- The copies keep their **original uuids and timestamps**, so one uuid now exists in two files.
- `pr-link` is not copied, so a fork shows no PR badge though it is the same work.
- Subagent transcripts are not copied either: the `toolUseId`s of a copied Agent call resolve only under the parent.
- The carried-over tokens were billed in the parent — see `carriedOverUsage` in [AI_COST_AND_CONTEXT.md](AI_COST_AND_CONTEXT.md).

A `compact_boundary` on a fork carries its own `forkedFrom` too (it also carries `preCompactDiscoveredTools`, the deferred tools that had loaded — 23 in `c0f70eda`).

### Replayed segments

**Sometimes a whole previous segment is re-appended**: boundary, summary and every message that followed it, verbatim except for a `parentUuid` re-threaded onto the summary, keeping their **original timestamps**. 2,072 lines of `0f5b1c8b` (2 of its 8 boundaries) and 17,678 of `cae7f9f5` (23 of its 41), always written in the same millisecond as a real boundary, at the end of the segment being closed.

Read as new messages it **invents context that never existed**: 9 segments instead of 7 and 42 instead of 19, two of them holding prompts with no answer, the real ones closed by the *duplicated* boundary so their header quoted the wrong compaction and ran 12/08 → 06/08, backwards. And because assistant lines merge by `message.id` across the whole file, a replayed chunk appended its text to the item written days earlier — 108 answers printed twice.

**So a uuid seen twice is a replay of the first, and every full parse must drop it** (`replayFilter` in `jsonl.ts`, applied by `parser.ts`, `enricher.ts` and `deepSearch.ts`; the search index already deduped its own blocks by uuid+text, which is why search alone never showed this). Keep the FIRST: it is where the exchange happened and the one that carries the billed tokens — **a replay's top-level `usage` counts are zeroed** (only its `iterations[]` keeps the figures), so Claude Code does not bill it either. That zeroing is why token totals were the one thing this never corrupted.

The `/compact` line is replayed on its own too — see compaction in [AI_COST_AND_CONTEXT.md](AI_COST_AND_CONTEXT.md).

### `session_id` is a RUN, not an ancestor

Every message carries `sessionId` (the file it belongs to) and, once a request goes out, `session_id`. They differ whenever a session is resumed from a *fresh* CLI: that process gets its own session id at startup and stamps it on everything it appends.

Read as "history copied forward from an ancestor" — which this documentation claimed for a year — it produces an ancestry that is **backwards and mostly imaginary**: the ids point at what CONTINUED the session, they arrive at the END of the file with the NEWEST timestamps, and 15 of the 17 belong to 1-line stubs holding no conversation. Checked across all 22 occurrences here: **not one is a copy** — zero of their uuids exist in the other session's file. (`/resume` typed in a fresh CLI is recorded in `history.jsonl` under that CLI's id, which is how the chain was finally reconstructed: `0b70de12` ran `/resume` at 13:06:45 and wrote 176 lines into `b399c159`.)

The app keeps them as `runIds` and says "resumed ×N", never as lineage.

## Live sessions and streaming

`sessions/<pid>.json` lists what is running: `sessionId`, `cwd`, `status`, `pid`. **Verify pid liveness with `process.kill(pid, 0)` before trusting an entry** (on Windows, treat `EPERM` as alive).

### `status` has four values, and one of them says the session is waiting for you

Read out of the 2.1.239 binary rather than guessed from what this machine happens to have written — which for a year was only two of them, and left the field typed `string // "idle" | "busy" | ...`:

```js
Ybv = ["busy", "shell", "idle", "waiting"]        // the whole set; Xbv() validates against it
```

| `status` | What it means | For us |
| --- | --- | --- |
| `busy` | a turn is in flight | working — this is what `isWorking` tests |
| `waiting` | **a dialog is on screen** | stopped, and it wants an answer |
| `idle` | the turn is over | stopped |
| `shell` | `idle` with a shell open over it | stopped — nothing about the conversation differs |
| *absent* | a `--print` run (ours included) never writes one | say nothing; the composer answers for those |

`idle` and `shell` are one state to every reader here, which is what `LIVE_STOPPED` is for. The CLI computes the pair as `status === 'idle' && shellOpen ? 'shell' : status`, so a shell is never anything but an idle session with a shell over it.

**`waiting` comes with `waitingFor`, and that field is the only thing on disk that says WHY a session stopped.** Any dialog at all produces it — a permission prompt, an `AskUserQuestion`, a plan to approve, a `/model` picker:

```js
function qyA(e) {
  if (e.workerSandboxPrompt) return "sandbox request";
  if (e.elicitationPrompt) return "input needed";
  if (e.topDialogWaitingFor !== void 0) return e.topDialogWaitingFor;
  if (e.pendingWorkerRequest) return "worker request";
  if (e.pendingSandboxRequest) return "sandbox request";
  if (e.isShowingLocalJSXCommand) return "dialog open";
}
function s_y(e) { return e === void 0 ? void 0 : y2A[e] ?? "permission prompt"; }
```

So the vocabulary is closed and short — `"permission prompt"`, `"input needed"`, `"dialog open"`, `"goal proposal"`, `"sandbox request"`, `"worker request"` — and `"permission prompt"` is by far the commonest, being the `??` fallback for every dialog kind the CLI has no name of its own for. **Show it as written.** Translating it into something friendlier would be this app claiming to know which dialog it was, which it does not.

Measured on this repo's own session, while a question was on screen:

```
23:32:18.684 pid=25996 status=busy
23:32:55.191 pid=25996 status=waiting waitingFor="input needed"
23:34:33.154 pid=25996 status=busy
```

Two things the registry's schema declares and this machine has never written: `tempo` (`active`/`idle`/`blocked`) and `needs`. The CLI reads both defensively, so something else writes them; nothing here reads them until one is actually seen.

**A stop is a TRANSITION, and none of this records one.** `idle` is the resting state of every open session, so the set of idle sessions is only the set of terminals you have open — see `core/notifications.ts` for the memory that turns it into an event, and [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md#where-state-lives) for why that memory is not persisted. Three writes look like stops and are not: a session being born writes its file with **no `status` at all** and then `idle` half a second later (measured), a shell opening over an idle session writes `shell`, and a menu the user pulled up writes `waiting`.

**Do not use the idle-notification channel.** `peerFeatures: ["notify_idle"]` and `messagingSocketPath` in that same file are a real IPC channel the CLI uses to tell other sessions it has gone idle (`cross_session_notify_idle` in the binary, with its own `peer-gone` / `send-failed` states). Subscribing to it would mean talking to the Claude Code process over its named pipe, which is the same line the IDE channel is on and which this app must never cross. The file says the same thing a debounce later, for free.

**That file has no heartbeat: it is written when something CHANGES.** Measured mid-turn, `updatedAt` and `statusUpdatedAt` sat frozen at the start of the turn for 3 minutes while the session was busy. Good news for the live indicator — `idle`→`busy` is stamped at the instant it happens, so the watcher sees it within its 300 ms debounce and `statusUpdatedAt` is a truthful "working since". The cost is the other direction: a CLI killed outright leaves the file saying `busy` forever and nothing announces it. Only `pidAlive` catches that, and every reader re-checks it as it reads, so no answer is ever wrong — what was missing is anyone to SAY so, and a page with nothing to ask went on believing a dead terminal still held the session until it was reloaded. That is `Watcher.checkLiveness`: one `process.kill(pid, 0)` per running CLI every 5 s, none at all while nothing is running, and a `live-changed` the moment one is gone.

**A response is written one CLOSED content block per line — never token by token.** Each line of a streamed turn carries one finished block (`thinking`, `text`, `tool_use`) with its own timestamp: 99 of 245 messages in one session span several lines, e.g. `thinking(0)` → `text(168)` → `tool_use:Edit` over 8.0 s. The `user` line carrying a `tool_result` has its own timestamp too, so the span between a call's two lines is its wall time from issue to result recorded (pairing 1:1 over this corpus, no negative spans). That is more than the tool's own run when something sat in between — a parallel batch, a permission wait: against the duration Glob and WebFetch self-report (`toolUseResult.durationMs`, the only tools that write one), the span never undershoots and lands within 20 ms for 72 of the 93 in this corpus (median +6 ms), the rest overshooting by up to 90 s of real waiting. The parser keeps both clocks: `ToolBlock.timestamp` and `ToolResultInfo.timestamp`.

**So the live streaming the CLI and the VS Code extension show cannot be reproduced from disk**, and there is nowhere else to get it: during a turn nothing under `~/.claude` is touched except the transcript (checked — no partial buffer in `paste-cache`, `session-env`, `debug` or anywhere else). The IDE channel (`~/.claude/ide/`, a lock file plus a WebSocket, created only when the CLI runs inside an editor) is the sole path to partial text, and using it would mean posing as an IDE and talking to the Claude Code process — which this app must never do.

What IS reachable is block granularity, and the numbers say why the wait feels all-or-nothing: the silence before an assistant line runs p50 **4.5 s**, p90 15 s; prose blocks are p50 70 chars but reach 3,546, and the big ones land after ~20 s of nothing. `WorkingIndicator` exists to fill exactly that silence, and it says "working" rather than "writing" on purpose — `busy` covers the whole turn, tool calls included.

## Everything here has an expiry date (`cleanupPeriodDays`)

Claude Code deletes its own history, and the app that browses it has to say so — `core/retention.ts` reads the setting and `RetentionPanel` explains it. Verified against the CLI bundle (2.1.228: `jCm` the sweep, `wjv` the transcripts, `aoe` the per-file decision, `rul` the skip reasons, `GV` the cutoff) and the docs.

- `cleanupPeriodDays` is an **integer ≥ 1, default 30**. `0` is not "never", it fails validation — a long retention is spelt `3650`. The sweep runs a few seconds after startup, **at most once every 24 h**, gated by the mtime of `~/.claude/.last-cleanup`.
- It deletes by **file mtime** (`if (!(stat.mtime < cutoff)) keep`), NOT by the last timestamp inside the transcript — which is why the expired count is computed against `SessionSummary.mtimeMs` and is exact. A transcript takes its `<uuid>/` folder (subagents, offloaded results) and its `.ccr-tip.json` / `.precompact.json` sidecars with it, and the same cutoff sweeps `file-history/`, `plans/`, `debug/`, `paste-cache/`, `image-cache/`, `session-env/`, `tasks/`, `shell-snapshots/`, `backups/`, `usage-data/` and orphaned worktrees.
- **`history.jsonl` is never swept** — the Prompts page outlives the sessions it points at (`sessionExists: false`). The one piece of good news in here, and worth saying in the UI.
- Precedence is `["userSettings","projectSettings","localSettings","flagSettings","policySettings"]`, so a project's `.claude/settings.json` beats `~/.claude/settings.json` **whenever Claude Code is started inside it**, while the sweep itself is global. A number shown without checking the projects can be a lie, which is why `readRetention` scans every known project path.
- **An unparseable settings file pauses the sweep entirely** (`settings_unknowable` / `settings_invalid_key_set`), as does a `cleanupPeriodDays` that fails validation — unless managed settings supply the value, in which case it runs at theirs. "Broken settings" does NOT mean "falls back to 30": nothing is deleted at all, and the UI must not state a day count or an expired count as fact while that is true. (Before CC 2.1.203 it *did* fall back to 30 and could delete what a longer value was meant to keep.)
- **Never write any of this.** There is no API for it and the file is rewritten by Claude Code while it runs; the app shows the value, explains the edit and opens the folder. `GET /api/retention` re-reads from disk on every call — that is what makes the Refresh button honest — and logs only what CHANGED since the last read, or every page load would repeat the same warnings.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 1, 11 (replays), 15 (retention), 16 (forks and rewinds), 17 (injected and queued lines), 18 (live/working), 28 (delivered files).
