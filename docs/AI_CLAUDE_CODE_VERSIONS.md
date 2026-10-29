# Claude Code versions — what changed upstream, and what we did about it

**Load this when:** Claude Code has shipped versions newer than the first one below, or something that used to work broke after a CLI update.

This app reads a format nobody documents and runs a CLI that ships almost every day, so it falls behind without noticing. This file is what stops that: every published Claude Code version from the baseline up, newest first, with what in it reaches this app and what was decided about it. How a round is carried out — the sources, the triage, the corpus check — is the `review-claude-code-versions` skill ([`.claude/skills/review-claude-code-versions/SKILL.md`](../.claude/skills/review-claude-code-versions/SKILL.md)); this file holds only what the rounds found.

## Invariants

- **The first version heading below (`## X.Y.Z`) is the newest version reviewed.** There is no other marker: that heading is the answer to "up to where are we". Nothing assumes the `2.1.` prefix — the next version may well be `2.2.0`.
- **Every published version from the baseline up has an entry**, even if all it says is that nothing applies. A missing version means NOT REVIEWED, never "nothing there".
- **Newest first.** A round adds its entries above the previous top, newest of the round first.
- **An entry records a decision, never how something works.** The fact goes to its area doc (`AI_TRANSCRIPTS.md`, `AI_RUNNING_CLAUDE.md`, …) and the entry links to it — one home per fact.
- **Entries are edited, not appended to.** When a decision changes — a `pending` settled, an `implement` landed — the entry is updated where it is, and Open decisions follows.
- **Baseline: 2.1.268.** Nothing older was ever reviewed as a whole. What the repo knows about earlier versions was measured one bug at a time, and lives in the area docs.

## Decisions

| Decision | Means |
| --- | --- |
| `implement` | the app will do something about it, and it stays under Open decisions until the commit that does it is linked here |
| `tolerate` | nothing to support, but it must not break anything — and it was checked that it does not |
| `not applicable` | it was a candidate, and it does not reach this app |
| `pending` | it needs a decision or a measurement, and stays under Open decisions until it has one |

Each item also names the **area** it touches: `reads` (what is on disk in `~/.claude` and the other folders this app reads), `runs` (the CLI and the SDK this app spawns: flags, modes, the renderer, the environment, usage limits) or `idea` (something new this app could build on — a datum worth drawing, a feature worth offering, a new way in). **Ideas are half of what a round is for**, not a by-product: what Claude Code adds is what this app can grow from, and a round that only reports what could break has done half its job.

An item reads `- **[decision · area]** what changed, quoting the changelog where it helps — why it matters here — link.` A finding the changelog never mentions is filed under the version the corpus first shows it in, marked *(corpus)*.

## Open decisions

Every `pending` item, and every `implement` whose commit is not linked yet, grouped by what it asks for.

**To fix**

Nothing open.

**To build**

- [2.1.300 — show the exact request Claude received](#21300) — implement
- [2.1.303 — how each tool call was approved](#21303) — implement
- [2.1.303 — how long Claude thought](#21303) — implement
- [2.1.303 — the share of the context window, where it can be known](#21303) — implement
- [2.1.276 — messages between sessions, drawn as such](#21276) — implement
- [2.1.285 — open a session in Claude Desktop](#21285) — implement
- [2.1.290 — background sessions, told apart](#21290) — implement
- [2.1.295 — the embedded terminal's state from OSC 7501](#21295) — implement
- [2.1.287 — a claude-history mod for Claude Code itself](#21287) — implement, a user priority
- [2.1.304 — the tools called before a compaction](#21304) — implement
- [2.1.292 — each subagent's effort in the ⑂ panel](#21292) — implement
- [2.1.269 — the diff of what a Bash command changed](#21269) — implement

**To measure**

Nothing open.

## Rounds

| Date | Range | Installed | Notes |
| --- | --- | --- | --- |
| 2026-10-28 | 2.1.268 → 2.1.312 | 2.1.312 | The catch-up round that started the register: 42 published versions, ~3,000 bullets. 2.1.279, 2.1.297 and 2.1.298 were never published. The corpus has no transcript written by 2.1.283–2.1.302, so every shape those versions introduced first shows up at 2.1.303. |

## 2.1.312

39 bullets, 13 for other surfaces.

- **[tolerate · runs]** Usage-limit messages now say "5-hour limit" instead of "session limit" — the auto-reload reads `resets_at` from the usage endpoint and matches no message text (`core/autoReload.ts`).
- **[implement · reads]** *(corpus)* **A Workflow run's agents, one level down.** The first workflow run on this machine (`cd2180fb`, a fixture made for the purpose) wrote its agents to `subagents/workflows/<runId>/`, where every reader of agent transcripts was blind — their cost was in no total, their rows in no ⑂ panel ([Subagents](AI_AGENTS_QUESTIONS_PLANS.md#workflow-agents)). The layout was read out of the 2.1.312 bundle first (`WORKFLOW_TRANSCRIPT_SUBDIR`), and `/usage` counts these as its `workflow` behaviour ([2.1.299](#21299)). **Landed in `4c73e87`**: one list of agent folders for every reader; the call is joined through the run id and the status read from the run's journal.
- **[tolerate · reads]** *(layout, version unknown)* `sessions/` now holds a `<pid>.<64 hex>.key` file of 115 bytes beside each `<pid>.json` — first noticed in this round, on the live sessions of 26–28 October; `core/live.ts` reads only `.json`.
- *Not applicable:* transcripts naming the effort level in force rather than one just picked; "waiting on you" detection; a first reply lost after a terminal resume; an invalid command name silencing `claude -p`; Remote Control idle status.

## 2.1.311

92 bullets, 16 for other surfaces.

- **[tolerate · reads]** "`claude -p` and SDK sessions saving transcript messages out of order or keeping messages that were taken back" — older composer transcripts may hold either; the parse walks `parentUuid`, never file order ([Transcripts](AI_TRANSCRIPTS.md#the-tree-rewinds-forks-and-replays)).
- **[tolerate · runs]** Model ids drop `[1m]` where it has no effect — prices are keyed by `message.model`, which never carried it, and the context pill counts tokens, never a share of a window.
- **[tolerate · reads]** `claude purge` deletes a project's local data — a vanished session is what the retention sweep already does to the index every day.
- *Not applicable:* `stream-json` escaping control characters (values unchanged once parsed); local-scope MCP servers in `~/.claude.json`; agent-teams task lists; `/teleport` of compacted cloud sessions; partial output of a timed-out shell command; `ultrathink` raising effort mid-turn; `claude daemon` wording; the retry watchdog.

## 2.1.310

26 bullets, 14 for other surfaces.

- **[tolerate · reads]** The cleanup deleted recent files such as pasted images when `cleanupPeriodDays` was very large — this machine runs 9999, so images pasted before this version may be gone from `paste-cache/` and `image-cache/`; the viewer draws images from the transcript's own base64, not from those folders.
- **[tolerate · reads]** *(corpus)* `attachment:thinking_drop` and `user.summarizedTurnPromptUuids` — `4a3654ae` and `8d285e93` open and draw. The three `thinking_drop`s here all sit on the first request after a compaction, which is never a re-cache, so the re-cache causes of [2.1.280](#21280) do not read them.

## 2.1.309

79 bullets, 20 for other surfaces.

- **[tolerate · reads]** Tool-output previews cut through an emoji, leaving lines `jq` refused — Node decodes the broken byte sequence as U+FFFD and `JSON.parse` accepts it.
- **[tolerate · reads]** `/rename` titles replaced by a generated one after a VS Code reload or a non-interactive `--resume` — the app takes `custom-title` first whatever comes after it ([Transcripts](AI_TRANSCRIPTS.md)).
- *Not applicable:* `/rewind` checkpoints covering subagents and shell commands; `sed -i` no longer previewed as an edit; empty "Untitled" VS Code sessions (stubs are already flagged `isEmpty`).

## 2.1.308

1 bullet; nothing reaches this app.

- **[tolerate · reads]** *(corpus)* `user.sandboxed` — always `false` here; `baf28c9d` opens and draws.

## 2.1.307

43 bullets, 8 for other surfaces.

- **[tolerate · reads]** Subagent transcripts recorded placeholder usage for streamed responses until this version — subagent token totals of older sessions can be off, and nothing in the transcript says by how much.
- *Not applicable:* `setModel()` waiting up to 15 s for the API; VS Code's "still open somewhere else" covering leftover processes.

## 2.1.306

2 bullets; nothing reaches this app.

## 2.1.305

38 bullets, 12 for other surfaces.

- *Not applicable:* the retry watchdog's usage-limit recheck; empty "(session)" entries left by Remote Control (stubs are flagged `isEmpty`).

## 2.1.304

76 bullets, 10 for other surfaces.

- **[not applicable · runs]** Resuming an inactive conversation on Pro or Max now warns that it will use a noticeable share of the 5-hour limit, offering to resume anyway or start a new conversation. In the embedded terminal that is the CLI's own prompt, answered there like in any terminal. Whether a composer (SDK) resume meets it was left to measure, and will not be: the composer is [retired](AI_RUNNING_CLAUDE.md#the-composer-is-retired).
- **[tolerate · reads]** `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC` dropping messages on a full disk — the variable is opt-in and unset here; what it does is in [Transcripts](AI_TRANSCRIPTS.md#files-and-directories) (filed under [2.1.296](#21296)).
- **[tolerate · reads]** A new transcript line when a plugin skips a mod's hook — not in the corpus; a session holding a `system` subtype the app has never heard of (`agents_killed`, [2.1.268](#21268)) opens and draws.
- **[tolerate · reads]** Mods' `settings.read` hook can rewrite the effective `cleanupPeriodDays` — the retention panel reads `settings.json`, so a managed mod could make the sweep differ from what it shows. No mods here.
- **[tolerate · reads]** *(corpus)* `system.commandRun` — `a7d5b145` opens and draws.
- **[implement · idea]** **The tools called before a compaction.** Claude Code now lists them in its compaction summary; the compaction this app draws could say the same, from the calls in the segment it closes.
- *Not applicable:* the auto-mode classifier's context no longer stored with every request (smaller files); large shell output copied into `tool-results/`; SDK messages waiting behind a context check.

## 2.1.303

1 bullet; nothing in the changelog reaches this app. **The corpus resumes here** after a gap from 2.1.283, so everything below was first written by some version between 2.1.283 and 2.1.303, not necessarily this one.

- **[tolerate · reads]** *(corpus)* `assistant.requestedModel`, `requestRef`, `thinkingDisplay`, `thinkingDurationMs`; `user.permissionDecision`, `turnPosition`, `serverClassifierContext`; `attachment.renderedRole`, `renderedBesideToolResult`; `usage.fallback_credit`; `queue-operation.commandUuid`, `deliveryId`; `user.joinedNotice*`, `queueSkipSlashCommands`, `queueTranscriptOnly`, `toolEndsTurn` — `1387f52e` and `eb137b52` open and draw.
- **[implement · reads]** *(corpus)* **Session files writing 5-minute caches.** 2,135 messages of 27 sessions, written by 2.1.303–2.1.309 between 19 and 24 October, report their cache writes as `ephemeral_5m` while the request asked for 1h — and the caches still lasted the hour ([Tokens and cost](AI_COST_AND_CONTEXT.md#the-cache-write-ttl-and-why-it-is-read-per-line)). The session totals priced every write at 1h, so on those 27 they no longer added up to the pills: $41 over all of them. **Landed in `50220fc`**: every aggregate keeps the TTL split, and all 654 sessions reconcile to zero.
- **[implement · idea]** **How each tool call was approved — or refused.** `permissionDecision` on the line that carries a tool's result: `decision` (`accept` / `reject`), `source` (`config`, or `user_temporary` when a person granted it, with a `grantScope`), and `reasonType` (`classifier`, `mode`, `rule` with its `ruleSource`, `safetyCheck`, `other`). Measured: 5,289 lines here, 13 of them refusals. A mark on each call, and a way to see what the classifier let through on its own: the composer runs in auto mode, and so does this machine.
- **[implement · idea]** **How long Claude thought.** `thinkingDurationMs` on assistant lines (with `thinkingDisplay`, `updates` or `omitted`) — "thought for 12 s" beside the thinking block.
- **[implement · idea]** **The share of the context window, where it can be known.** `requestedModel` keeps the `[1m]` the model was asked with (`claude-opus-5[1m]`) where `message.model` never did — but since [2.1.311](#21311) the suffix is dropped for models that have 1M anyway (Opus 5.5), so a window per model is still needed, and a percentage must never be shown where neither says it. Reverses a rule in [Tokens and context](AI_COST_AND_CONTEXT.md), which this would have to rewrite.
- The API request lines first appear here too; they are filed under [2.1.300](#21300), which introduced them.

## 2.1.302

63 bullets, 26 for other surfaces.

- **[tolerate · reads]** Fork subagents (`subagent_type: "fork"`) on by default in the SDK, so the composer may start them — the drawer draws a fork's own transcript, checked on `15a86025` ([Subagents](AI_AGENTS_QUESTIONS_PLANS.md#subagents)).
- **[tolerate · runs]** SDK sessions with no permission mode start in `default` on third-party providers or with telemetry off — the composer always passes `permissionMode`.
- *Not applicable:* the `/config` row for idle compaction ([2.1.299](#21299)); subagents' own Agent calls running in the foreground by default.

## 2.1.301

51 bullets, 6 for other surfaces.

- **[tolerate · reads]** Switching to a model with a smaller window now compacts first, with the previous model — that compaction bills on the old model, and cost already follows `message.model` line by line.
- *Not applicable:* the retry watchdog's maximum wait; sign-outs after a short command; a tool call cut off mid-turn no longer reported as rejected; the compaction row saying where earlier messages are saved; the `[killed]` line in background PowerShell output files.

## 2.1.300

88 bullets, 18 for other surfaces.

- **[implement · reads]** **"Local session transcripts also record each API request's system prompt, tools and parameters."** Three new line types, first written here by 2.1.303 ([Transcripts](AI_TRANSCRIPTS.md)). The viewer, the summarizer and the enricher check `type` and pass them over; **the deep scan does not**. In a main transcript it reads every `tool_use` and `tool_result` block it meets, blobs included: `1387f52e` answers "OrchardCore.DistribWebAPI_*" with 2 matches, and the second one has no uuid and quotes a command the conversation never showed. In a subagent transcript it reads every text block, so the blobs' copies of the subagent's prompt are indexed beside the real one: in `60e0dcc4`, a sentence from the subagents' instructions matches 9 times, 8 of them `agent` rows. **Landed in `a586346`**: the deep scan reads `user` and `assistant` lines only ([Search](AI_SEARCH.md#two-corpora-and-the-split-is-the-whole-design)).
- **[implement · idea]** **Show the exact request Claude received.** The same lines hold, per request, the system prompt and the tools offered (`api-request-shape`), the model, betas, `max_tokens`, thinking mode, context management and effort (`params`), and what was sent. A "what did Claude see on this turn" panel, read lazily. They also make the context's split between system prompt, tools and conversation estimable — in characters, not tokens — which [Tokens and context](AI_COST_AND_CONTEXT.md) says only a `/context` snapshot could give. Only for sessions written since 2.1.300.
- **[implement · reads]** VS Code fixed "still open somewhere else" after a reboot handed the old pid to another program. This app had the same trap: `pidAlive()` (`core/live.ts`) trusts `process.kill(pid, 0)`, so a pid file left by a crash showed its session live, and the guard refused it, for as long as the reused pid lived. **Measured:** the CLI does not sweep such files. 2.1.312 compares the record's `procStart` — the process creation time as a FILETIME, equal to WMI's to the microsecond — with the live process's own and skips a mismatch (`"recycled"`), but leaves the file on disk. **Landed in `e88af83`**: the app makes the same comparison ([Transcripts](AI_TRANSCRIPTS.md#live-sessions-and-streaming)).
- **[tolerate · reads]** A crash-cut last line swallowing the first entry written after a resume — older files may hold one merged line that does not parse, and the parse skips it.
- *Not applicable:* U+2028 and U+2029 breaking `/branch` and `claude purge` (the app's version of it is under [2.1.296](#21296)); a mod hot-reload note recorded as typed (no mods); `gitBranch` reading `.invalid` in reftable repositories; `claude daemon stop`; Remote Control status; background commands force-killed on exit; VS Code worktree resume.

## 2.1.299

190 bullets, 18 for other surfaces.

- **[tolerate · runs]** Idle compaction: a conversation over 200K tokens left idle about 54 minutes compacts itself before its cache expires. It is OFF on this machine (`"idleCompaction": false` in `settings.json`). Were it on, an embedded terminal — which has no timeout — would spend tokens on its own an hour after its user walked away.
- **[tolerate · runs]** `utilization` can exceed 100 — the usage widget caps the bar at 100% and prints the real number.
- **[tolerate · reads]** `document` blocks in a message sent while Claude is working — none in the corpus yet; the parser draws text and image blocks and passes over the rest.
- **[implement · idea]** **What made a session expensive.** "`/usage` warnings for max effort, workflows, always-on context and large tool results" — the same four are readable from a transcript (effort per line, workflow agents, the context every request re-sends, tool results by size), so a session's cost could come with the reasons for it rather than only the total. A user priority. **Landed** with the `cost-drivers` branch (`cf83672` the requests, `7e64588` the token panel, `6f0fb2a` the Stats page), with `/usage`'s own rules read out of the 2.1.312 bundle — reasons that overlap, two of them estimates, the parser and the enricher feeding one tracker ([Tokens and cost](AI_COST_AND_CONTEXT.md#what-made-a-session-expensive)). Finding workflows on the way turned up a layout nothing read ([2.1.312](#21312)), fixed on its own.
- *Not applicable:* the plan-mode note about bypass permissions; mods' `queue` door; SDK auto mode after a model switch; queued `stream-json` prompts merged without a newline; `verbatimPrompts` with `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`; background subagents reporting twice; orphaned PowerShell processes from the CLI's own liveness check; PDF bytes no longer kept in transcripts; richer background-agent notifications.

## 2.1.296

79 bullets, 17 for other surfaces.

- **[implement · reads]** Claude Code fixed messages holding U+2028 or U+2029 being dropped by its own transcript code. **This app has the same bug**: `streamLines()` (`core/jsonl.ts`) splits with Node's `readline`, which also breaks lines at both characters, so the parser, the enricher and the deep scan all lose such a line without a word. Reproduced on `60e0dcc4`: line 726, an assistant turn whose command holds one, is absent from the parse (uuid `8e1f77a1…`), while its neighbours are there. **Landed in `1edfabd`**: `streamLines()` splits on `\n` itself. The six lines of `60e0dcc4` (five calls and a result) now draw, and 931 of the corpus's 933 transcripts read exactly as before. The rule is in [Transcripts](AI_TRANSCRIPTS.md#files-and-directories).
- **[tolerate · reads]** `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC` trims a transcript in place — opt-in, non-interactive sessions only, unset here; written down in [Transcripts](AI_TRANSCRIPTS.md#files-and-directories) because the docs used to say nothing is ever rewritten.
- **[tolerate · reads]** Sonnet 5.5 cache reads priced at $0.10 per million — the price table saved in the release already says 0.1; the defaults are under [2.1.284](#21284).
- *Not applicable:* `autoCompactWindow` for subagents (a subagent is parsed by the same parser, compactions included); Read's `allow_large`; the wording given to resumed subagents about interrupted calls; interrupts during a submit hook; `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`; Windows MCP shutdown; link hover in fullscreen; auto mode's "Not run" rows.

## 2.1.295

143 bullets, 15 for other surfaces.

- **[implement · idea]** **The embedded terminal's state from OSC 7501.** Program Status Protocol tells the terminal whether Claude is working, waiting on you or done, in the stream itself — so the embedded terminal can know the moment it changes, from the bytes it already relays, where `sessions/<pid>.json` is read off disk afterwards.
- *Not applicable:* the retry watchdog's 429/529 limit; `/tui` restarts; `claude agents` restarting sessions (background sessions register in `sessions/` like any other, so the guard sees them); `disableAutoMode`; `rate_limit_event` wording; MCP output files getting real extensions; Bash's `command_description`, Grep's `-l`/`-c`/`-r` (none in the corpus, and tool inputs are drawn generically); `FORCE_COLOR` in background sessions; repeated SessionStart context; mods rewriting prompts; `~/.claude/seed-admin`; the leaf a resume continues after `/rewind`; MCP tool names in waiting status.

## 2.1.294

2 bullets; nothing reaches this app.

## 2.1.293

56 bullets, 8 for other surfaces.

- **[implement · reads]** Claude Haiku 5.5 (`claude-haiku-5-5`): "$0.10/$0.50 per Mtok ($0.50/$2.50 for prompts over 100K)" — part of [2.1.284](#21284).
- *Not applicable:* daemon subcommands signing out; the footer's agent count; `claude plugin test` with `session.append`.

## 2.1.292

92 bullets, 15 for other surfaces.

- **[tolerate · reads]** The Agent tool's `effort`, Grep's `file_path` for `path`, stray parameters to Write, WebFetch and Read — none in the corpus; unknown input fields are drawn as they are.
- **[tolerate · runs]** Plan mode restored when resuming from the picker or `/resume` — see [2.1.290](#21290).
- **[implement · idea]** **Each subagent's effort in the ⑂ panel.** The Agent tool takes an `effort`, so a subagent can run at another level than its parent; the row and the drawer could say which.
- *Not applicable:* the "instruction file not loaded" line; escaped `<system-reminder>` in hook output; `-p` and SDK runs waiting for background commands after the result (the composer's process outlives the turn by design); repeated limit alerts; `https://` links in limit messages.

## 2.1.291

2 bullets.

- **[tolerate · reads]** 2.1.288–2.1.290 could lose a session's last messages when quitting — nothing to recover, and nothing on this machine was written by those versions.

## 2.1.290

190 bullets, 26 for other surfaces.

- **[tolerate · runs]** Plan mode restored on `--resume <id>` and `--continue` — the embedded terminal starts with `--resume`, so a session left in plan mode reopens in it, as in any terminal; the composer passes its own mode, and its picker already opens on the mode the transcript left.
- **[tolerate · reads]** The `plansDirectory` setting can put plans outside `~/.claude/plans/`, which is the only place the plans panel reads — not set here.
- **[tolerate · reads]** Advisor `serverToolUses`, a teammate's `agent_id`, WebFetch's `offset`, scheduled tasks kept across compaction — no advisor call has ever run here (every `usage.iterations` entry is a `message`), and new input fields are drawn as they are.
- **[implement · idea]** **Background sessions, told apart.** Sessions run by the background service (`claude agents`, `claude --bg`, `claude attach <name>` and `claude logs <name>` from here on) carry `sessionKind: "bg"` on their lines ([Transcripts](AI_TRANSCRIPTS.md)). The list and the badges could say so — and what the app offers for one differs, since the CLI that holds it is the service's, not a terminal's.
- *Not applicable:* background sessions reopening after a restart; `--include-partial-messages`.

## 2.1.289

27 bullets; nothing reaches this app.

## 2.1.288

89 bullets, 7 for other surfaces.

- **[tolerate · reads]** "Resume occasionally loading a transcript cut short when the same session rewrote the file during the load" — the transcript GC, under [2.1.296](#21296).
- *Not applicable:* partial responses continued after a timeout; all-zero usage (only `<synthetic>` lines carry it here, 85 of them); a resumed session not saving its last response; thinking dropped on resume; auto mode compacting for its classifier; `claude purge` renamed; `/autocompact` per model; VS Code archiving; Windows keyboard after a self-restart; the background-command time limit.

## 2.1.287

106 bullets, 19 for other surfaces.

- **[implement · idea]** **A claude-history mod for Claude Code itself.** "Claude Mods: plugins may now modify deeper behavior" — and later versions give mods `prompt.autocomplete` (rows of their own in the prompt's autocomplete), `$.ui.notify`, `$.ui.view` and commands. A mod could bring this app into the CLI: open the current session here, search the whole history from the prompt, autocomplete from prompts written in any project. **What makes it more than a convenience is where it runs: inside the live CLI**, which this app only ever sees from outside, through files. From there it could record what no file holds — the transitions the bell has to keep in memory because "nothing on disk records one", the context window in force, the effort and mode actually applied — and act inside a session this app does not own, a terminal's, without being a second writer, since it IS the writer's own process (`$.ui.selection()`, for one, hands a mod the transcript row the user selected: a star taken from the terminal). The mod hooks named in this register so far: `turn.step`, `tool.check`, `session.append`, `agent.spawn`, `prompt.submit`, `prompt.change`, `prompt.autocomplete`, `skill.prompt`, `settings.read`. A user priority. A different kind of deliverable — a plugin, not a page — so it is a plan of its own, and that plan starts by reading the mod API itself, not this list. It also meets two rules head-on: a mod would talk to this app from outside its own pages, which every state-changing request is refused for today, and it would run inside every Claude Code session on the machine.
- *Not applicable:* "You should know" (a built-in mod, off); a folder's CLAUDE.md attached twice; JSON paging wording; the hooks count in `stop_hook_summary`; skill names typed mid-message; smaller files for large MCP results; `claude agents` replies arriving as queued messages (the same channel hand-backs use, [2.1.271](#21271)); tool heartbeats in SDK streams; repeated model fallbacks; reopening a session whose worktree was removed; a fullscreen crash while scrolling; auth error text; `context: fork` skills streaming; piped stdin on Windows (the elevated host runs the CLI in a pseudo-console); right-click paste on release; VS Code's "still open somewhere else".

## 2.1.286

88 bullets, 21 for other surfaces.

- *Not applicable:* turns lost after a crash in a batch of parallel calls; tool results that are objects, numbers or booleans (none in the corpus); a message typed into a subagent showing twice; hand-back messages naming a task id ([2.1.271](#21271)); background jobs shown done while waiting; the retry limit; trust records differing in letter case; the 1M→200K fallback notice.

## 2.1.285

136 bullets, 24 for other surfaces.

- **[implement · reads]** A subagent's run now ends as soon as it hands its report back — landed with [2.1.271](#21271), in `c363d8a`.
- **[tolerate · runs]** `claude --resume` on a session running in the background now attaches to it instead of refusing — the embedded terminal never gets that far: it refuses a session any live CLI of someone else's holds in `sessions/` (`core/sessionTerminal.ts`), and a background session is a CLI that registers there (the CLI's own agents view is built from that folder, [2.1.293](#21293)).
- **[tolerate · runs]** `-p` and the Python SDK starting in auto mode with no permission mode — the composer always passes one.
- **[implement · idea]** **Open a session in Claude Desktop.** `claude --desktop --resume <id>` opens the desktop app on a session — a third way out beside the embedded terminal and "resume in terminal", and local-only for the same reason the second one is.
- *Not applicable:* `modelUsage` under the wrong model after a refusal fallback (cost follows each line's `message.model`); malformed compaction markers and loop wakeups; background shells stopped at a time limit; VS Code queued messages and renames; `setModel` keeping the old output limit; background subagents' permission requests; forks keeping plan mode; Remote Control messages delivered on the next resume; stale plans handed to `canUseTool`; the login-refresh lock; `--max-turns` and `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`.

## 2.1.284

100 bullets, 28 for other surfaces.

- **[implement · reads]** **New models the default price table does not know.** Opus 5.5 ([2.1.280](#21280), $4/$20, cache reads $0.20), Sonnet 5.5 (here, $2/$10, cache reads $0.20 then $0.10 from [2.1.296](#21296)) and Haiku 5.5 ([2.1.293](#21293)) are missing from `DEFAULT_PRICES` (`shared/src/prices.ts`), so a fresh install, or a reset to defaults, prices them as unknown. The release on this machine fetched them and has all three. Haiku 5.5 also has a **long-prompt rate** ($0.50/$2.50 over 100K tokens, five times the base), and the table holds one rate per model. The row the release saved IS the long-prompt one, so every ordinary Haiku 5.5 message here is priced at five times its cost (48 lines so far). **Landed in `ea57415`**, with the tier settled as one rate per model: the defaults carry the three rows at their base rates, and the scraper — which was what saved the long-prompt row, letting it overwrite the base one of the same model — now skips rows priced for prompts over N tokens. Learning the tier would split every by-model aggregate by prompt size, and no Haiku 5.5 prompt here comes near 100K ([Tokens and cost](AI_COST_AND_CONTEXT.md#pricing)). The same pass found two things the changelog does not say: Fable 5.1 and Mythos 5.1 were missing from the defaults too (2,184 Fable 5.1 messages here), and Sonnet 5's $2/$10 is now its standard price. **A table saved before this keeps its wrong Haiku 5.5 row** — the release's included — until it is fetched again by a build carrying the fix, or edited by hand.
- **[tolerate · runs]** Interactive sessions start in auto mode when no permission mode is configured — the embedded terminal behaves like any terminal, and this machine already sets `permissions.defaultMode: "auto"`.
- **[tolerate · runs]** The CLI now backs off the usage endpoint after a 429 — fewer 429s shared with the widget, which reads the same account.
- *Not applicable:* a second compaction when the first was not enough; usage-limit message wording; Ultracode as its own toggle; malformed images in SDK messages; "Continue automatically at usage limit" (the auto-reload starts the 5-hour window, it does not resume cut turns); VS Code restored tabs.

## 2.1.283

94 bullets, 16 for other surfaces.

- *Not applicable:* MCP images also saved to a file; VS Code reloads splitting turns or showing rewound ones; SDK sessions losing deferred calls; fast keys against stale state; auto mode by default on third-party providers ([2.1.284](#21284)); the weekly Fable limit with telemetry off.

## 2.1.282

86 bullets, 19 for other surfaces.

- **[tolerate · reads]** `redacted_thinking` blocks — none in the corpus; the parser passes over block types it does not draw.
- **[tolerate · reads]** *(corpus)* `attachment:credential_org` — `20bb93a3` opens and draws.
- *Not applicable:* shell output files left in temp on a full disk; the Fable usage-credits prompt; the login-refresh lock; bracketed paste reset mid-session; the send-now hint; EBADF on resume (this app reads with shared access and never locks a transcript).

## 2.1.281

177 bullets, 24 for other surfaces.

- **[tolerate · reads]** An assistant `message.content` that is a plain string — 0 such lines in the corpus. The parser draws assistant content from an array, so one would show as an empty answer rather than break anything; worth revisiting if a corpus run ever counts one.
- **[tolerate · reads]** A manual resume no longer adds a hidden "Continue" message — the old ones are `isMeta` and already hidden.
- *Not applicable:* loop wakeups refired every second; IDE selections on queued messages; empty local copies of web sessions (flagged `isEmpty`); a crash during a retry; SDK sessions whose folder was deleted; the `claude.exe` backup race; send-now moving tools to the background.

## 2.1.280

114 bullets, 28 for other surfaces.

- **[implement · reads]** Claude Opus 5.5 (`claude-opus-5-5`), the new default Opus — prices under [2.1.284](#21284). Context needs nothing: the pill counts tokens, never a share of a window.
- **[tolerate · reads]** Write inputs named `path`, `file_text` or `file_content` — none in the corpus.
- **[tolerate · reads]** Hand-back messages carry a provenance preamble the CLI hides — it is part of the `<agent-message>` text, under [2.1.271](#21271).
- **[implement · idea]** **Name more causes of re-cached context.** "`/cost` cache-miss causes name thinking mode and thinking display changes" — the app's own explanation of re-cached context (`recacheOf`, [Tokens and context](AI_COST_AND_CONTEXT.md)) could too: the request's `thinking` is in `api-request` `params` ([2.1.300](#21300)), `thinkingDisplay` on assistant lines ([2.1.303](#21303)), and a `thinking_drop` attachment marks thinking blocks dropped from a request ([2.1.310](#21310)). **Landed** with the `cost-drivers` branch (`d9cf884`): where both requests are recorded, a re-cache lists what changed in the request — a new chain, rewritten history, the system prompt, the tools, effort, thinking and its display, betas, cache breakpoints — and gains two causes, `request-changed` and `server-side`; the changes stay facts beside the cause, never above the TTL, because 97 of 101 shape changes here cost the cache nothing. No event on this corpus needed a new cause yet ([Tokens and cost](AI_COST_AND_CONTEXT.md#re-cached-context--the-most-expensive-thing-in-the-corpus)).
- *Not applicable:* auto mode stopping after ten denials; prompt repaint on Windows; cache misses after a host model switch; malformed MCP and memory notices; fullscreen interface errors; preferences moving from `~/.claude.json` to `settings.json` (`cleanupPeriodDays` was already there); resumes starting a turn by themselves; lost messages to background subagents; reports lost to a compaction; junctions under `~/.claude`; Opus as the Pro default; per-model effort; launch-default effort no longer held; VS Code paste markers.

## 2.1.278

2 bullets; nothing in the changelog reaches this app.

- **[tolerate · reads]** *(corpus)* `assistant.apiErrorCode`, `assistant.serverClassifierRequest`, `system.source` (`request_retry`) — `23c29b42`, `ee912dc9` and `a23de95b` open and draw.

## 2.1.277

87 bullets, 17 for other surfaces.

- **[tolerate · reads]** TaskOutput removed: background output is read with `Read` of the `.output` file — the background-task join already finds the id in a `Read` of that file (`web/src/lib/toolCalls.ts`).
- **[tolerate · reads]** Subagent results now arrive under a "subagent output" header, indented — the drawer takes the report from the notification, not from the call's own result; no synchronous result of that shape is in the corpus yet.
- **[tolerate · reads]** No more `ai-title` for plain `claude -p` runs outside an SDK — the composer is an SDK session, and the title falls back to the last prompt anyway.
- *Not applicable:* `-p` and SDK hangs now ending with exit code 1; empty text blocks; logouts beside older builds; crashes on color codes, at the first spinner and in rendering; an out-of-memory stop on Windows; SessionStart output in the first message; Remote Control placeholders in `~/.claude.json`; malformed stop-hook summaries; headless totals saved at exit; invisible characters stripped from prompts; VS Code archiving.

## 2.1.276

1 bullet; nothing in the changelog reaches this app.

- **[tolerate · reads]** *(corpus)* the `ReadNotifications` tool and `user.turnOrigin` (`human`, `task_notification`, `sdk`, `peer`) — `2500b6bb` opens and draws. `turnOrigin` agrees with `origin.kind` on every line that has both; who wrote a line is still decided by `origin.kind` ([Transcripts](AI_TRANSCRIPTS.md#who-wrote-a-user-line)).
- **[implement · idea]** **Messages between sessions, drawn as such.** A line with `turnOrigin: "peer"` (and `origin.kind: "peer"`) is a message another Claude session sent this one; a queued `<agent-message from="…">` is one from an agent ([2.1.271](#21271)). Both could be drawn as coming from that sender, with a way to the sending session — teammates, `SendMessage` and the agents view all speak through this channel. Every `peer` line in the corpus so far is an agent's hand-back (14 of 14, `origin.handback: true`), and those are drawn since [2.1.271](#21271) landed — so what is left here is a peer message that is not one, of which there is none yet to build against.

## 2.1.275

95 bullets, 39 for other surfaces.

- **[tolerate · runs]** Usage reads shared between processes on one machine — nothing is left on disk for the widget to reuse (nothing under `~/.claude` holds it), but the account's rate limit sees fewer calls.
- **[tolerate · reads]** *(corpus)* `assistant.advisorModel` on every assistant line since — the advisor is configured; it has never run a call here. `scripts/corpus-shapes.mjs` dates `iteration:<type>` so the first one shows up ([2.1.273](#21273)).
- *Not applicable:* the send-now key; `--forward-subagent-text`; superseded questions; malformed task reminders, messages and content blocks (the parse is defensive); `/rewind` in forks; a fullscreen crash; thinking lost on resume; pasted images saved as files; slow terminals; VS Code's empty `CLAUDE_CONFIG_DIR`, reopen times and renames.

## 2.1.274

108 bullets, 40 for other surfaces.

- *Not applicable:* corrupted transcripts healing themselves; `/goal` lost on resume; AskUserQuestion preview notes; background tasks reported on resume; batched background completions in SDK sessions; subagent messages in the Desktop transcript; Monitor notifications merged; VS Code settings writes.

## 2.1.273

64 bullets, 24 for other surfaces.

- **[tolerate · reads]** The CLI's context meter counted advisor-tool turns at about twice their size — the app takes context from each line's usage, and no advisor call has run here to check it against. `iteration:<type>` in the corpus survey is the tripwire.
- **[tolerate · reads]** *(corpus)* `session_id` on `system` lines too — the same run id the other lines carry ([Transcripts](AI_TRANSCRIPTS.md#session_id-is-a-run-not-an-ancestor)); `dbf83102` opens and draws.
- *Not applicable:* forking a Remote Control session from the Claude app; agents reported failed when the last reply lacked usage; SDK streams after moving a subagent to the background; sign-in scopes.

## 2.1.272

1 bullet; nothing in the changelog reaches this app. The first `SubagentHandback` call in the corpus is from this version ([2.1.271](#21271)).

## 2.1.271

96 bullets, 24 for other surfaces.

- **[implement · reads]** **"In auto mode a subagent reports back to its caller through a dedicated hand-back call."** The notification's `<result>` then only points at the report, and the report itself arrives as a `queued_command` attachment opening `<agent-message from="<agentId>">` ([Subagents](AI_AGENTS_QUESTIONS_PLANS.md#subagents)). The app reads neither: the ⑂ drawer shows the pointer as the agent's report, and the report is drawn nowhere. All four agents of `60e0dcc4` are like that; `db4fe0c0` has more. **Landed in `c363d8a`**: a hand-back is drawn where it landed as a notice of its agent's carrying the report, and the pointer is dropped. The fix found that the message comes in both envelopes a notification uses — 6 queued, 8 as `isMeta` `user` lines that wake an idle session — and that `origin.handback: true` is what marks it; 14 agents over 7 sessions now show their report byte for byte ([Subagents](AI_AGENTS_QUESTIONS_PLANS.md#subagents)).
- *Not applicable:* `allowed_domains` on shell calls (none in the corpus); `SendMessage` delivery notices; `[1m]` lost on resume (no window is read); synced skills in the cleanup; capability replies at exit; dynamic workflows waiting out a limit; Monitor deadlines; VS Code on mapped drives; 260-character PowerShell paths.

## 2.1.270

1 bullet; nothing reaches this app.

## 2.1.269

98 bullets, 39 for other surfaces.

- **[tolerate · reads]** Headless and remote sessions stay busy while background agents run, and SDK sessions now report a status — the live badge says working while agents work, which is the truth; the guard already excludes the composer's own pids ([Running Claude](AI_RUNNING_CLAUDE.md)).
- **[implement · idea]** **The diff of what a Bash command changed.** With `bashEditDiffEnabled` on, the Bash tool's result carries a diff of the files the command changed — drawn the way an Edit's is. Off here, so there is nothing to build against until it is turned on.
- *Not applicable:* keyboard fixes for other terminals; capability replies at startup; blank rows after a resize; replies lost by resumed headless sessions; escape codes in background-task records; synchronized-output detection; `permission_denials`; "Prompt is too long" in SDK sessions; `/goal` retries; `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`'s age limit; stray characters over slow links; background PowerShell on exit; the kitty keyboard query; VS Code renames.

## 2.1.268

96 bullets, 32 for other surfaces.

- **[tolerate · reads]** The task tools (TaskCreate…, TodoWrite) only offered on older models — new sessions stop containing them; old ones still draw.
- **[tolerate · reads]** *(corpus)* `system:agents_killed`, `assistant.isAbortedMidStream`, `user.queuePriority` — `5a0f519f` opens and draws.
- *Not applicable:* `configDirectory` in `claude auth status --json`; a busy loop in idle sessions; `excludeDynamicSections`; fork names in `/resume`; VS Code renames with a SessionStart hook.
