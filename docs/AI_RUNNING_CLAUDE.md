# Running Claude: usage, auto-reload and the composer

**Load this when:** you touch `core/usage.ts`, `core/autoReload.ts`, `core/sessionChat.ts`, the usage widget, the auto-reload panel or the composer — i.e. anything that talks to Anthropic or spawns a `claude` process.

## The line between reading and running

The app has two halves and they are not the same kind of thing. **Everything that reads `~/.claude` is ours and stays ours; the Agent SDK is used only to run Claude.** Keep that line where it is:

- **The reading half** — `scanner`, `summarizer`, `parser`, `enricher`, `deepSearch` — is where this project's value lives. It knows things no public API exposes: replayed segments after a compaction, `/branch` forks and their carried-over tokens, the branches a `/rewind` leaves behind, per-message cost with its cache TTL, `<task-notification>` lines wearing the user role. The SDK's `listSessions()` / `getSessionMessages()` do exist and return raw paginated messages — adopting them would trade all of the above for convenience. **Do not.**
- **The running half is plumbing**, and there the SDK is simply better plumbing, maintained by the people who own the protocol.
- `renameSession()` and `tagSession()` also exist, and both **append to the transcript**. That is a real option for a future "rename in Claude Code too", but it breaks the read-only rule, so it must be an explicit, visible user action — never the silent replacement for the local override.

## Invariants

- **Subscription usage is READ-ONLY**: never refresh the token, never write `.credentials.json`.
- **`UsageService` is the only reader** — nothing keeps a private copy of the read state.
- **A failed or stale read is never "no window".**
- **The auto-reload must never poll**, and the browser must never be able to make it send.
- **A firm `resets_at` outranks every wait**; waits belong on the paths with no date to act on.
- **No layer of the anti-loop may disable "Send it now"**, and every refusal must say why.
- **Two writers on one transcript is the thing being prevented** — but never block on a list, always re-check `pidAlive`.
- **The composer never renders the answer from the SDK stream** — the transcript is the source, as for any other session.
- **A new session's id is minted here, and which of `sessionId` / `resume` applies is asked of the disk**, never remembered in a flag.
- **A typed folder is the one path that comes from the request**, and it is validated rather than trusted.

## Subscription usage (read-only)

`core/usage.ts` reads `claudeAiOauth.accessToken` from `<dataRoot>/.credentials.json` and calls `GET api.anthropic.com/api/oauth/usage` with `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20` (verified against Claude Code 2.1.223). Response: `five_hour` / `seven_day` / `seven_day_{opus,sonnet}` with `utilization` as a **0-100 percentage** and `resets_at`, plus a `limits[]` array whose `weekly_scoped` entries carry per-model percentages.

> **NEVER refresh the token and NEVER write that file.** Refreshing rotates it and writes back, racing with Claude Code and potentially killing the user's real session. An expired token is reported (`auth-stale`) and left for **Claude Code** to refresh — by the user running it, or by the auto-reload sending its message, which is the same thing done automatically.

Re-read the file before every call (Claude Code rotates the token in place). The endpoint is undocumented and rate limited, so fail soft: on a transient failure keep the last good figures marked `stale` instead of blanking the widget. Only credential problems blank it, because only those need the user to act.

### One cache, one truth

`UsageService` is the only reader; the header widget and the auto-reload scheduler both go through it. Two rules make that real, and both were bought with bugs:

1. **A failed read never discards the last good figures** — the failure is recorded beside them in `readState()`.
2. **Every read is announced on `usage.events`**, so a reader about to ask the same question takes the answer instead. `AutoReloadService` subscribes and re-plans its sleep from anyone's reading; its `probeFiveHour(..., { reuseWindowMs })` reuses a reading that says the window is ALIVE — **never one reporting no window**, since acting on that spawns a session.

**Nothing may keep a private copy of the read state.** The panel claiming "the stored Claude token has expired" while the widget showed perfect figures was exactly that: a stale private `lastError` that no successful read could clear.

### Cadence: event-driven, not polled

The reading changes when Claude answers, and only then. `index.rescan()` classifies each change by reading the bytes appended and reports `assistantIds` on `sessions-changed` — the sessions where a real `assistant` line landed. Everything else that grows a transcript (your prompt, tool results, and the `mode` / `permission-mode` / `bridge-session` / `ai-title` / `last-prompt` lines rewritten every turn — about a third of all lines) costs nothing and must not trigger a read.

`useEvents.ts` refreshes usage on that subset, throttled to one read per `usageMinIntervalSeconds`, with a trailing read after the last write of a burst (a turn writes many times; without it the widget freezes on whatever it caught mid-turn). `appendedText` pulls the delta back to a line boundary — the `type` is at the start of a line, so a delta beginning mid-line would hide what it was.

**Never wire this to `live-changed`**: that fires on every heartbeat under `~/.claude/sessions`, idle sessions included, and would silently become a permanent poll at the floor.

### Triggers and waits

**Which triggers fire is the user's call** — `usageOn{Activity,Interval,Focus,Reset}` in Settings, each read at fire time (`readUsageSettings`) rather than closed over, so a toggle takes effect at once.

- `usageIntervalSeconds` (default 300) is only the idle fallback, for usage burnt on another device.
- `usageFocusMaxAgeSeconds` (default 60) stops the focus trigger — which fires on every tab switch and unminimize — from re-reading figures that are seconds old.
- A one-shot read just after each window's `resets_at` covers the one change nothing local announces.
- Mount and reconnect have no switch: neither can be an unwanted read.

**Two waits, and exactly one thing bypasses them.** `usageMinIntervalSeconds` (default 60, hard floor `MIN_USAGE_INTERVAL_SECONDS` = 15) is the cache gate for every trigger and both readers. **A 429 replaces it** with `usageRateLimitBackoffSeconds` (default 300, hard floor `MIN_USAGE_RATE_LIMIT_SECONDS` = 60): the endpoint has said in so many words that we ask too often, and a 60 s answer to that is not an answer — during the cooldown nothing reaches the network and callers get the shared figures. Only the manual Refresh button (`force`) skips both, and a successful read clears the cooldown.

Never gate the cache on `usageIntervalSeconds` instead: that is the idle poll, and event-driven reads would be served stale for minutes.

How each read is logged, and why the trigger is on every line, is in [AI_LOGGING.md](AI_LOGGING.md).

## Auto-reload of the 5-hour window

`core/autoReload.ts`, off by default, `GET /api/auto-reload` + `POST /api/auto-reload/run`.

The window starts with the first message sent inside it, so an idle night leaves it unstarted and drags the next reset into the middle of the day. When a read reports **no** `five_hour.resets_at`, the server sends one throwaway prompt — `claude -p <message> --model <alias>` in the user-configured folder — to start it.

### It must never poll

Every successful read carries the expiry, so it sleeps until `resets_at` + 1 min: ~5 reads a day, and fewer while the app is open, since it re-plans from the widget's readings instead of asking again. Use the **30 s local clock tick, NOT one long `setTimeout`** — a timer is delayed by however long the machine was suspended, and this fires at 3 AM by design.

**The subscription only ever postpones the next check**; it must never bring one forward or trigger a prompt, or an unrelated browser tab would be driving the thing that spawns sessions.

**Timers freeze while the machine sleeps**, and a tick arriving much later than `TICK_MS` is the only notice we get. Use it: reset the backoff (whatever failed before the nap is history) and give the network `RESUME_GRACE_MS` before reading, or the first read after every resume is guaranteed to fail.

### A failed or stale read is never "no window"

That is the whole reason `UsageService.probeFiveHour()` exists (`{ok:false}` for every error, including 429 and the `stale` last-good fallback); deciding on `available:false` instead would spawn a session on every hiccup. The endpoint 429s easily — observed after ~a dozen reads in 15 minutes — so back off and never read an error as a signal.

- **A stale token is answered by sending, not by waiting** — the one exception, and the reason `ProbeFailure` splits `auth-stale` (a token that exists and is expired or 401-rejected) from `auth-missing` (no credentials at all). Only running Claude Code rotates the token in place, and running Claude Code is this feature's entire job: backing off 5 minutes guaranteed the identical failure 5 minutes later, with the fix sitting behind the wait. `auth-missing` still waits — `claude -p` cannot sign anybody in. The send goes through `waitOutCooldown` like every other, and if the token is STILL stale after the run that counts as a verified failure (the one thing that fixes it has happened and did not take), so `MAX_FAILURES` ends it instead of a prompt every half hour forever.
- **A wire failure is not a refusal and must not share its backoff** (`ProbeFailure`: `network` / `http` / `auth`). This cost a whole free window: the machine came out of modern standby, the tick fired *in the same second* as the Kernel-Power event, the adapter was not up, and the 5/10/30 min ladder meant for 429s then sat out the entire period the window was free. Wire failures retry in 45 s / 90 s / 3 min. Also unwrap `err.cause`: undici reports every one of them as the useless string `"fetch failed"` and hides `ECONNRESET` / `EAI_AGAIN` underneath.
- **A firm `resets_at` outranks every wait.** When a successful read reports no window, it sends — no cooldown, no floor. That date is first-hand evidence of when the window ends, it is what scheduled the check in the first place, and a wait that overrides it spends real window time to protect against nothing. This cost whole slices of window: a stale token found five minutes before an expiry we could not see sent then, and the *real* reload was made to wait out the remaining twenty-five, dragging the rest of the day with it.

### Anti-loop, in layers

The failure to fear is an endless stream of sessions:

- one scheduled operation at a time (`busy`), and never two prompts at once (`sending`);
- **`MAX_SENDS_PER_HOUR` = 4 automatic sends in a rolling hour, then it pauses itself**;
- +15 min after a verified failure, and a pause after 3 of them;
- `COOLDOWN_MS` = 30 min between two sends made **blind** — with no `resets_at` to go on, which today means only the stale-token path.

`pausedReason` is cleared by saving an auto-reload setting (unrelated saves are ignored — they would just spend a read); the save also clears the breaker's tally, or clearing its pause would be theatre.

**Every one of those layers is in-process, which is why the dev instance must not run this too.** Two servers watching the same 5-hour window each keep their own `busy`, their own hourly tally and their own cooldown, and neither can see the other's — the account, meanwhile, has one window. The usage reads are the same story one level down, and that is the half that bites first: they rate-limit per account, so a second reader on the same interval brings the 429 forward and blanks the release's widget too. Hence `DEV_SETTING_OVERRIDES`, which starts a dev instance with the interval read and the update check off. Auto-reload is already off by default and belongs to the release; switch it on here only to test it, and knowing what it will spawn.

**The breaker is what buys the "no floor" rule**, so do not swap it back for a wait. A floor delays on suspicion, before there is anything to go on, and in the one case that actually happens it delays a send that was right; the breaker looks at sends already made and acts only when the answer is beyond argument. Four an hour is unreachable legitimately (a window lasts five hours; a stale token plus that window's expiry is two). It also covers the one runaway nothing else sees: sends that read back a live window every time — so `MAX_FAILURES` counts nothing — and yet achieve nothing. Manual sends are never counted, and `tooManySends` is checked AFTER the cooldown so it can only fire on a send we were really about to make.

**A window found afterwards that predates the run did not start it** (`windowAlreadyRunning`, decided by the five-hour arithmetic with slack). The usual case is a stale-token send while a window happens to be running: it refreshed the token, full stop. Both count as success, but only one started something, and the difference is not cosmetic — it is the reload still owed at that expiry, which is exactly what no wait may push back. The panel must not say "started a window" there.

### "Send it now"

**Every one of those layers guards the schedule, so none of them may stop the button.** It is refused only by the validations and by a prompt genuinely in flight (seconds) — never by a cooldown, a backoff, a check that happens to be running or a pause, all of which exist to tame a loop and have no business stopping the user asking for one message.

**The reason lives in ONE place, `runBlockedReason()`**: `POST /api/auto-reload/run` refuses with that exact string, and the UI both disables the button by it and shows it. The button was once disabled by `running` while the only text it could show came from `configError`, so a scheduled check left it dead and *silent* for a minute at a time.

A manual send takes no mutex of its own and may overlap a check: that is safe because it stamps `lastRunAt` before spawning (which puts the scheduler's own send behind the cooldown) and `sending` stops the two prompts overlapping.

### The prompt, and reading the window back

`claude -p` **exits on its own** once the answer is out: there is no session to kill, and the 120 s timeout only covers a hung process (killed with `taskkill /T`, since it spawns children). Spawn with `cleanEnv()`: inheriting our own `CLAUDE_CODE_*` markers makes the child treat itself as a nested session and stop persisting its transcript (verified — the reload would leave no trace and the hide option would have nothing to hide). `--mcp-config` needs `{"mcpServers":{}}`; plain `{}` is rejected.

**The read-back waits 60 s and is detached** (`verify()`): the send answers its caller as soon as Claude has answered — a few seconds — and the read-back finishes later on the same `AutoReloadRun` object, where the panel picks it up by polling. Awaiting it inside the request is what made "Send it now" sit at "Sending…" for over a minute and hold the mutex that greyed the button out for just as long.

**Until `verifiedAt` is set, `windowStarted: false` means "not known yet", NOT "no window"** — the UI must not pass a verdict on a reading nobody has taken. If that read fails, blame the read and not the prompt: no failure is counted (the window may well be running) and the cooldown keeps it from becoming a stream. `verify()` catches its own exceptions, because nothing awaits it and a throw would leave the run frozen at "reading the window back" forever.

### Hiding those sessions

`autoReloadHideSessions` filters that folder's project out of `index.list()` / `projects()` — hence the list, the filters, the counts, search and the stats — plus `/api/prompts`. `index.get(id)` stays unfiltered so a direct link still opens them, and nothing is ever deleted. It is gated on `autoReloadEnabled` as well as on its own flag: the UI disables the whole settings block when the feature is off, and a greyed control that still hid sessions would be a trap.

## The composer: sending a prompt from the app

`core/sessionChat.ts`, off by default behind `chatEnabled`, `GET`/`POST /api/sessions/:id/chat` plus `POST /api/chat/new`. One Claude Code session per conversation, driven through the **Agent SDK** (`query()` with a streaming-input generator, `resume: <id>` — or `sessionId: <id>` for one that does not exist yet, below — and `permissionMode` from the composer, `auto` unless plan mode was asked for), kept alive between turns. Where the box sits on screen — inside the conversation's own scroller — is in [AI_VIEWER.md](AI_VIEWER.md#the-end-of-the-conversation).

### Starting one that does not exist yet

The two halves want the id at different moments. Claude Code mints it when the CLI starts; the browser needs it *before* that, to mount a composer against it and to know which transcript to open afterwards. `Options.sessionId` settles it — "use a specific session ID for the conversation instead of an auto-generated one", mutually exclusive with `resume` — so the id is minted here and the page is already standing where the file will land.

A **draft** is that reservation and nothing else: an id, a folder, no process, no file. `POST /api/chat/new` creates one and spawns nothing; the CLI comes up with the first prompt, down the same road as every other session. It is dropped once `index.get(id)` answers, and `DRAFT_TTL_MS` (an hour) covers a tab closed on the picker.

- **Which of the two options applies is asked of the disk** (`transcriptExists`: one readdir of `projects/`, one `existsSync` per folder, and only ever for an id the index has never seen). A flag would have been cheaper and wrong: **Claude Code writes no transcript when the process starts, only when the first turn does** — measured, by opening a draft to read the model list and finding zero files — so the effort restart that can follow it must still mint rather than resume. The index cannot answer either; it is a rescan behind at exactly the wrong moment.
- **Everything downstream is untouched.** The watcher sees the file, `rescan()` indexes it, `sessions-changed` invalidates `['session', id]`, and `/new` — which reads that same key — hands over to `/session/<id>`. The viewer never learns that a session can be unborn, because by the time it is asked, it is not.
- **The composer needs no new behaviour for the first prompt.** The question panel, plan mode, the slash commands and Stop never depended on a transcript; the routes just had to stop answering 404 for an id only the chat service knows (`knows()`), and `sendBlockedReason` had to take the folder from `cwdFor` instead of a summary. A session started straight into `plan` produces a real `ExitPlanMode` with its plan file — the mode picker earning the one case it was built for, a first prompt with no CLI to ask.
- **The two-writers guard costs nothing here** and is left in place: a freshly minted uuid cannot be open in a terminal, so the check simply passes.
- **`/new` is the session view a second before its first line**, and that is a layout requirement rather than a flourish: the same header shell, the same `useViewPrefs` width and zoom, the same column, the same sticky composer at the foot of the same scroller. The handover happens under the reader, and a page that changed its width or jumped a zoom level as it did announced itself as a different screen — which it is not. Checked by measuring both against each other, not by eye (check 37). It carries only what a session with no transcript can honestly offer: where it will run, the folder actions, and `ViewButton`. No title — Claude names it — no counts and no fold controls.
- **The pickers must never be empty there**, which is what `lastCapabilities` is for; the one case it cannot answer is a server that has run no CLI at all since it started, and then — and only then — the page opens one to go and ask. Opening a process to fill a dropdown that is already filled would be a `claude` spawned for nothing.
- **The model and effort of the LAST new session are remembered** (`ch:newSessionModel`), and that is not the configured default this file rules out above. That rule is about *continuing* a conversation, where a global setting would quietly switch the model of a session you only meant to reply to; a session that does not exist yet has nothing to switch, and starting every one of them on whatever the fallback happens to be is its own kind of wrong. The composer reports what it actually sent (`onSent`) rather than the page re-deriving it, because the resolution — running CLI, then transcript, then fallbacks — lives in one place and should stay there.

### The folder, which is the one path that comes from the request

`create()` takes a `projectKey` the index resolves — the ordinary road, and the rule the rest of this app keeps ([AI_ARCHITECTURE.md](AI_ARCHITECTURE.md)) — or a folder the user typed. That second one is a deliberate exception, and the reason is that the rule has no answer for the case: **a folder Claude Code has never run in is in no index by definition**, so without it the app could only ever continue what a terminal began, which is most of what this feature exists to stop.

It is validated rather than trusted, and each failure says which of the three things is wrong, because the box someone is typing into is the only feedback they get: absolute, existing, a directory. Quotes come off first — Windows' "Copy as path" wraps the path in them, the same lesson `autoReloadCwd` learned. What already stood in front of it stands there still: the same-origin hook, and a remote browser that has signed in — which could already run Claude with auto-approved tools in any indexed project, so the folder is not what was guarding anything.

Beside the box, **`POST /api/pick-folder` opens the system folder browser on the server's own desktop** (`pickFolder`, and the four Windows traps it steps around are in [AI_WINDOWS.md](AI_WINDOWS.md#asking-windows-for-a-folder)). It is local-only for the ordinary reason — a dialog opened for a browser on another machine is a window nobody is looking at — and **only the button goes**: typing the path still works from anywhere, so what is refused remotely is the convenience and never the action. `path: null` is Cancel, which leaves what was typed alone.

### Why the SDK, and what it must produce

**The SDK is used for the control channel, not for convenience.** `AskUserQuestion` does not exist in a plain `--print` run — measured: **33 tools without the SDK, 36 with it** — so Claude notices it is missing and asks in prose instead, a behaviour change caused purely by using the app. Through `canUseTool` the question arrives structured (header, options, descriptions) and `QuestionPanel` renders it; anything the auto classifier will not approve arrives the same way instead of being denied in silence.

**Answering has to produce what the terminal produces**, or the app is a poorer client for the same conversation. `askedAnswers` builds the `updatedInput` in the transcript's own shape ([AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md)): picks joined with `", "` into ONE string with the free text appended after them — never an array, never replacing them — the `(notes only)` sentinel for a bare note, and `annotations[q] = {preview?, notes?}` omitted where there is neither. **The pending questions are also the authority on which keys exist**, which is what stops an arbitrary map reaching a tool's input: the route cannot check that, and used to pass whatever it was given.

- **`toolConfig: {askUserQuestion: {previewFormat: 'markdown'}}` is pinned, not inherited.** The SDK documents `markdown` as its default and as what the CLI asks for, but a default is documentation rather than a promise, and this decides whether the drawings arrive at all. `html` is the other value and this app will not take it: it would mean rendering markup the model wrote.
- **`askedQuestions` copies the SDK's array field by field instead of casting it.** The cast let a malformed item reach React, where it announced itself by throwing inside `options.map` — with the turn already held open by a promise nobody could then resolve. Copying is also what makes `preview` part of the contract rather than a field that happened to survive.
- **The turn is held open by an unresolved promise** while a question is on screen, which is exactly what keeps the CLI waiting. So `TURN_SILENCE_MS` skips a session with `ask` set: that silence is ours, not the CLI's, and killing it would throw away the answer the user is typing.
- **`ExitPlanMode` arrives through `canUseTool` like `AskUserQuestion`**, and gets the three answers Claude Code itself offers rather than allow/deny. Approving carries a `setMode` `PermissionUpdate` — or the CLI's own `options.suggestions` when it sends them, which beat anything built here. "Keep planning" is a **deny**, and its message is the note the user typed: that is what reaches the transcript, and what the plan card then prints under "the user said". The panel renders the plan as markdown; escaped inside the generic permission `<pre>` it was unreadable at exactly the moment it has to be read.

### The process

- **Never let the SDK use its own vendored CLI.** `pathToClaudeCodeExecutable` points at `findClaudeCli()` ([AI_WINDOWS.md](AI_WINDOWS.md) for why resolving that path is not trivial), and the 293 MB per-platform package is excluded in `pnpm-workspace.yaml` (`ignoredOptionalDependencies`). The lockfile must stay free of it.
- **`spawnClaudeCodeProcess` exists solely to learn the pid**, which nothing else exposes and two things need: excluding our own process from the two-writers guard, and killing the tree. Pass the SDK's own forwarded `signal` through — ours would race ahead of its graceful stdin-EOF path and hard-kill the CLI.
- **The packaged build needs the `import.meta.url` shim** in `scripts/package.mjs`: the SDK calls `createRequire(import.meta.url)` at module scope and esbuild's CJS output has no import.meta to give it, so without the banner+define the bundle throws `ERR_INVALID_ARG_VALUE` before a line of ours runs.
- **`system/init` is emitted at the start of EVERY turn**, not once at startup, so it can never mean "the process is ready". Measured on CC 2.1.229: 1.45 s from spawn to the first one, 38 ms to the second — which is the whole reason the process outlives the turn.
- Cleanup goes through `onShutdown()` in `logger.ts`, where every exit path already lives (there are no Fastify close hooks). Closing stdin turns out to be enough on its own — the child exits on EOF, so even a hard `Stop-Process` of the server leaves nothing behind — but the hook covers the paths where the pipe might outlive us. `taskkill /T` for the rest: `claude` spawns children.
- **That cleanup is why the server answering a composer session must not be the one being rebuilt.** Stopping it ends the turn in flight, and no care inside this file can change that. It is the reason the source tree runs as a [dev instance on its own port](../CLAUDE.md#two-instances-and-the-line-between-them): the composer talks to the release on 7433, which nothing in the repo restarts, while 7434 is restarted as often as the work needs.
- Prompts sent while a turn is in flight **queue**, they are not refused. `TURN_SILENCE_MS` kills a wedged process, and skips a session with a question waiting.
- MCP servers are deliberately **not** skipped (no `--strict-mcp-config`, unlike the auto-reload): a prompt that needs Jira or SQL has to work the same here as in a terminal, and the startup is paid once because the process is reused.

### Model, effort and permission mode

- **The model and command lists come from the running session** (`supportedModels()` / `supportedCommands()`), not from a constant: the live list carries `opus[1m]` and `claude-fable-5[1m]`, which the hand-written one never had. `CLAUDE_MODELS` remains the fallback for before a process exists.
- **What the last CLI reported is kept** (`lastCapabilities`) and served to sessions with no process of their own. Still read from a running session and never written by hand — that is the rule this keeps — but the answer is a fact about the INSTALL rather than about one session, and throwing it away left the pickers absent exactly where they matter most: the first prompt of a new conversation, where there is nothing to continue from and so nothing to fall back on either. Any live CLI's own list wins again the moment it arrives, and a failed read never blanks what was right a minute ago. **Measured: the second new session fills all three pickers in 1 ms, with no `claude` spawned.**
- **Effort levels are per model, and one model has none.** `supportedModels()` returns `supportsEffort` and `supportedEffortLevels` per row, and `haiku` carries neither while everything else takes all five — so a fixed list was wrong on screen AND on the wire (it handed `--effort` to a model with no such setting). The picker is filled from the chosen model and hidden entirely when the list is empty; `effort: null` reaches `query()` as no `effort` key at all. The same rows carry `displayName`, `description` (which leads with the version and says `with 1M context` where it applies) and `resolvedModel`, which maps a transcript's `claude-sonnet-5` back onto the `sonnet` alias exactly instead of guessing by family.
- **There is no configured default model or effort, deliberately.** The composer starts from how that session was last answered, read backwards from its own transcript — continuing a conversation should continue it, and a global setting would quietly switch the model of a session you only meant to reply to. `ChatStatus.model` / `effort` are therefore null when nothing is running: they report what IS, not what would be. The transcript records full ids while the CLI offers aliases, so the picker matches on the family or it would open on an empty box.
- `setModel()` switches live; **effort still needs a fresh process** (a startup flag with no control message), so only restart when it actually changed. `interrupt()` is what Stop uses.
- **The permission mode is live too** (`setPermissionMode()`), so plan mode costs no restart. The picker offers `auto` and `plan` and no more: the SDK's `PermissionMode` has six values and `bypassPermissions` is not something an HTTP body should be able to reach, so the route narrows the string rather than trusting it. It is the one picker shown even with **no process running**, because plan mode matters most on the first prompt of a piece of work — exactly when there is no CLI to ask. The initial value comes from the transcript like the model and effort; only `plan` is restored, and anything else opens as `auto` rather than claiming a mode the picker cannot represent.
- **Claude Code changes the mode by itself when a plan is approved**, and says so on its `system`/`status` messages (`SDKStatusMessage.permissionMode`, also on `system/init`). `pump()` follows both, or the picker goes on showing `plan` after the session has left it.

### Two writers on one transcript

That is the thing being prevented — it is what produces the duplicated uuids and replayed segments the parser has to undo — so the blocks are real, not advisory. They also keep a race in them: a terminal opened in the second between the check and the write.

- **A `--print` run registers itself in `~/.claude/sessions/<pid>.json` exactly like an interactive one** (`entrypoint: "sdk-cli"`, and the pid is the `claude.exe` we spawned), so the guard must exclude our own pids or **the feature blocks itself the moment it starts working**. That file carries no `status` field for these, though, so `/api/live` never reports them busy however long they work — hence the synthesised `LiveInfo` in `SessionViewPage` rather than a second indicator.
- **`index.liveSessions` is only rebuilt when something writes to that directory**, and a CLI killed outright writes nothing on the way out. Its file stays, no event ever announces it, and a guard that trusts the list stays blocked forever with nothing running (measured). **Re-check `pidAlive` at the moment of the decision.**
- **The guard holds across instances, and only because it is written where both can see it.** With the release and a dev instance up at once, each knows nothing of the other's chat processes — but the CLI they spawn registers its pid in `~/.claude/sessions`, the one directory they share, so the second one to try is blocked by the first exactly as it would be by a terminal. Nothing in either server's memory could have answered that.
- **One string, `sendBlockedReason()`**, for the endpoint and the composer both: the same shape as `runBlockedReason()`, and for the same reason — a disabled control with nothing to say is the bug.
- **Both doors are guarded, not only the composer's.** `POST /api/sessions/:id/resume` used to launch a terminal on a session already open in one, which is the same corruption the composer refuses — through the door that is likelier to be used twice, with a window open per monitor. It answers 409 as well: **our own process first** (`chat.status(id).running`), because the CLI we spawn registers a pid file like any other and the live check would otherwise blame a terminal that does not exist, and a live pid after that. Only the launch is refused — **"Copy resume cmd" stays live**, so doing it anyway remains possible and deliberate. The button says which of the two it is before the click, from `summary.live`; the 409 is the authority, because that field takes a moment to appear.

### Rendering

**The answer is NOT rendered from the SDK's message stream.** Claude Code writes its own transcript, the watcher sees the file grow, the viewer re-reads it — the path that already draws every live session, with its folding, its cost pills and its context figures. So the loop follows only enough to know when a turn ends (`result`), nothing is accumulated, and an unrecognised message costs nothing. Rendering from the stream would mean a second, poorer viewer for the same data.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 8 (auto-reload), 19 (the composer, and the rules for testing it safely), 23 (plan mode round trip), 24 (answers written back), 37 (starting a session from the app).
