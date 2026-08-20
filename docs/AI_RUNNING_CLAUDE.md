# Running Claude: usage, auto-reload, the composer and the embedded terminal

**Load this when:** you touch `core/usage.ts`, `core/autoReload.ts`, `core/sessionChat.ts`, `core/sessionTerminal.ts`, `core/writerGuard.ts`, the usage widget, the auto-reload panel, the composer or the terminal — i.e. anything that talks to Anthropic or spawns a `claude` process.

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
- **The embedded terminal runs `claude.exe` with no shell around it** — that is what keeps the pid guard honest and a remote browser no more powerful than the composer already makes it.
- **A pseudo-terminal belongs to the server, not to the tab.** Closing a browser detaches; it never kills anything.
- **A terminal outlives the CLI inside it**, because the last screen is the only diagnosis a failed start leaves.

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

## Two ways to talk to Claude, and one switch between them

`chatEnabled` decides whether the app talks to Claude at all. `chatMode` decides HOW, and is meaningless while the first is off — nothing is drawn at the foot of a session either way, so nothing reads it there:

| | `composer` (default) | `terminal` |
| --- | --- | --- |
| What runs | the Agent SDK driving `claude` | `claude.exe` in a pseudo-console |
| Owns | `core/sessionChat.ts` | `core/sessionTerminal.ts` |
| Questions and plans | structured panels, plan comments | whatever the TUI draws |
| Model / effort / mode | pickers beside Send | `/model` inside the CLI |
| Idle timeout | `chatIdleTimeoutMinutes` | none, ever |
| Survives closing the tab | the process does; nothing is drawn | the process AND the screen |

**They are exclusive and must stay so**: both at once is two writers on one transcript, which is the corruption everything around this feature exists to prevent. Each refuses while the other holds a session, and both say which one it is.

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

Beside the box, **`POST /api/pick-folder` opens the system folder browser on the server's own desktop** (`pickFolder`, and the Windows traps it steps around are in [AI_WINDOWS.md](AI_WINDOWS.md#asking-windows-for-a-folder)). It is local-only for the ordinary reason — a dialog opened for a browser on another machine is a window nobody is looking at — and **only the button goes**: typing the path still works from anywhere, so what is refused remotely is the convenience and never the action. `path: null` is Cancel, which leaves what was typed alone.

### Why the SDK, and what it must produce

**The SDK is used for the control channel, not for convenience.** `AskUserQuestion` does not exist in a plain `--print` run — measured: **33 tools without the SDK, 36 with it** — so Claude notices it is missing and asks in prose instead, a behaviour change caused purely by using the app. Through `canUseTool` the question arrives structured (header, options, descriptions) and `QuestionPanel` renders it; anything the auto classifier will not approve arrives the same way instead of being denied in silence.

**Answering has to produce what the terminal produces**, or the app is a poorer client for the same conversation. `askedAnswers` builds the `updatedInput` in the transcript's own shape ([AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md)): picks joined with `", "` into ONE string with the free text appended after them — never an array, never replacing them — the `(notes only)` sentinel for a bare note, and `annotations[q] = {preview?, notes?}` omitted where there is neither. **The pending questions are also the authority on which keys exist**, which is what stops an arbitrary map reaching a tool's input: the route cannot check that, and used to pass whatever it was given.

- **A single-choice question has ONE answer slot, and the panel is where that is enforced** ([AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md#splitting-an-answer)). Typing your own answer takes the slot: the pick is dropped as the first character lands and the options go flat until the box is empty again. Sending both wrote `"<label>, kk"` into the one slot — a string Claude has to guess at, drawn by the transcript card as two picks on a question that had one. On a `multiSelect` both stay allowed, because there it is a real answer the corpus holds.
- **`toolConfig: {askUserQuestion: {previewFormat: 'markdown'}}` is pinned, not inherited.** The SDK documents `markdown` as its default and as what the CLI asks for, but a default is documentation rather than a promise, and this decides whether the drawings arrive at all. `html` is the other value and this app will not take it: it would mean rendering markup the model wrote.
- **`askedQuestions` copies the SDK's array field by field instead of casting it.** The cast let a malformed item reach React, where it announced itself by throwing inside `options.map` — with the turn already held open by a promise nobody could then resolve. Copying is also what makes `preview` part of the contract rather than a field that happened to survive.
- **The turn is held open by an unresolved promise** while a question is on screen, which is exactly what keeps the CLI waiting. So `TURN_SILENCE_MS` skips a session with `ask` set: that silence is ours, not the CLI's, and killing it would throw away the answer the user is typing.
- **A plan can be commented passage by passage, and the anchor is the QUOTE.** Select any part of the rendered plan and a `✎ Comment` button appears under the selection; what you write is filed against that passage (`PlanReview`), painted through the CSS Custom Highlight API — never `<mark>` nodes, the markdown belongs to React ([AI_VIEWER.md](AI_VIEWER.md)) — and listed under the plan with an × each. They go out with *Keep planning* in Claude Code's own shape, `[Re: "<quote>" · under "<heading>"] <comment>`, appended to the note under a `Comments on the plan:` line. **No line numbers**, because the model is holding prose and not a file with a gutter — which is also what the IDE panel does ([AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md#what-the-ide-does-with-a-plan)). Measured end to end: Claude came back and rewrote exactly the two quoted passages of its plan file.

- **A quote is the RENDERED text, not the markdown**, so a selection crossing `**bold**` reads back without the asterisks. It still locates the passage, and the IDE has the same limitation for the same reason.
- **The selection is grown out to whole words** (`snapToWords`) and put back on screen before it is quoted. A drag ends where the mouse came up, so real selections start and finish mid-word — `d porque, según CLAUDE.md d` was a live one — and that is both ugly to read and a worse anchor, since the quote is what Claude is asked to find in its own plan. Only the two ends move, and only while both sides of them are word characters.
- **Two numbers, not a `Range`.** Each comment keeps its offsets in the rendered text beside the quote, because going full screen builds those nodes again and a `Range` into the old ones points at nothing. Ends that were not both text nodes store `-1`: the comment stands, unpainted.
- **Approving with comments pending is REFUSED**, with the reason on the buttons and above them. The approval's tool_result is a fixed template — there is no `userFeedback` on that side for them to travel in, and `userComments`, which the IDE sends on approval, appears nowhere in the CLI binary — so a button that took them would be a button that ate them. Remove them, or send them back.

**The comments come back apart, on the page and in the export.** The transcript keeps ONE string — the note and the remarks glued together in the shape Claude was given them — so the plan card used to print a wall of `[Re: "…" · under "…"]`, which is a wire format on a page. `parsePlanFeedback` splits it again and the card draws each remark the way the composer's list does; `parsePlan` is pure, so the export and the per-message copy do the same. **The format itself is not touched for the card's sake**: it is what the model reads. Anything that does not parse — a refusal typed in a terminal, another client's wording — is printed exactly as before, which is also what the fallback is for.

**A plan is read full screen or not at all.** The panel lives above the composer, and a 25 KB plan in a 40vh strip is the one thing here nobody can answer without reading all of it — so the header carries `⤢ full screen`, which portals the WHOLE panel (buttons, note box and all) over the page: the decision is taken with the plan on screen, not after closing it. Esc comes back, and it must `stopPropagation` — the page's own Escape handler ends in `navigate(-1)`, so letting it through would leave the session as well as the overlay. The strip keeps its place with one line saying where the panel went, because two live copies of the same form would be two answers to one question.

**The overlay carries its own ground.** The card's background is a 5% accent tint, which is a tint over the page it normally sits on and nothing at all over a portal: the conversation showed straight through the plan, at 70% black, and the plan was the thing being read. So the wrapper under it is opaque `--bg` and the tint composites over that.

**`ExitPlanMode` arrives through `canUseTool` like `AskUserQuestion`**, and gets the three answers Claude Code itself offers rather than allow/deny. Approving carries a `setMode` `PermissionUpdate` — or the CLI's own `options.suggestions` when it sends them, which beat anything built here. "Keep planning" is a **deny**, and its message is the note the user typed: that is what reaches the transcript, and what the plan card then prints under "the user said". The panel renders the plan as markdown; escaped inside the generic permission `<pre>` it was unreadable at exactly the moment it has to be read.

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
- **Every door is guarded, not only the composer's.** `POST /api/sessions/:id/resume` used to launch a terminal on a session already open in one, which is the same corruption the composer refuses — through the door that is likelier to be used twice, with a window open per monitor. It answers 409 as well: **our own processes first** (`appHolderOf`), because the CLIs we spawn register a pid file like any other and the live check would otherwise blame a terminal that does not exist, and a live pid after that.
- **There are three doors now, so who-owns-which-pid has one home**: `core/writerGuard.ts`. Both services register as a `TranscriptWriter`; `pidOwnedByApp` answers for all of them at once and `appHolderOf` names the holder, which is what lets a refusal say *through the composer* or *through the embedded terminal* rather than blaming "a terminal". As a private field on one service the answer was correct; with two it would have had to be mirrored, and the day one copy fell behind, the app would have blocked itself and pointed at a window that does not exist. Only the launch is refused — **"Copy resume cmd" stays live**, so doing it anyway remains possible and deliberate. The button says which of the two it is before the click, from `summary.live`; the 409 is the authority, because that field takes a moment to appear.

### Rendering

**The answer is NOT rendered from the SDK's message stream.** Claude Code writes its own transcript, the watcher sees the file grow, the viewer re-reads it — the path that already draws every live session, with its folding, its cost pills and its context figures. So the loop follows only enough to know when a turn ends (`result`), nothing is accumulated, and an unrecognised message costs nothing. Rendering from the stream would mean a second, poorer viewer for the same data.

## The embedded terminal: the other half of `chatMode`

`core/sessionTerminal.ts`, reached when `chatEnabled` is on **and** `chatMode` is `terminal`. One `claude.exe` per session inside a Windows pseudo-console (`@lydell/node-pty`), drawn in the page by `web/src/components/viewer/SessionTerminal.tsx` with xterm.js, over a WebSocket at `/api/sessions/:id/terminal/ws`.

It is the same CLI a terminal window would run, so everything the TUI does works and **nothing the composer adds exists**: no structured `AskUserQuestion` panel, no plan review with comments anchored to a quote, no model/effort/mode pickers. All of those come from the SDK's control channel, and there is no SDK here. That is the trade the radio in Settings offers, and it is why neither mode is a better default than the other.

### No shell, and why that is load-bearing

The PTY's direct child is `claude.exe` itself — not `pwsh` with the CLI inside it, which is what "Resume in terminal" launches. Three things follow, and the second is the one that would have cost real bugs:

- **The environment is the composer's, exactly.** `cleanEnv()`, no profile, inherited from this server — which runs as the user in their own interactive logon session, because the release is a scheduled task and [deliberately not a service](AI_DISTRIBUTION.md). So Credential Manager, DPAPI and everything else a `git pull` needs work here for the same reason they already work in the composer. A PowerShell profile that adds to `PATH` would NOT be loaded; the composer has never loaded one either, and the `PATH`-at-logon snapshot in [AI_WINDOWS.md](AI_WINDOWS.md) bites both the same way.
- **The pid we know IS the pid Claude Code registers.** `~/.claude/sessions/<pid>.json` carries the pid of the process the CLI runs as, so `ownsPid` works on the pid ConPTY hands back and the two-writers guard needed no new idea. With a shell in between, ours would be the shell's and Claude's a grandchild — a process-tree walk on every check, and a guard that gets that wrong blocks the app against itself.
- **A signed-in remote browser gains nothing it did not have.** The composer already runs Claude with auto-approved tools in any indexed project ([Remote access](AI_REMOTE_ACCESS.md)); `claude.exe` with no shell around it is that and no more. A shell would have been strictly more, and that is the whole reason this is reachable remotely at all.

**Read `pty.pid` from the live getter, never from a snapshot.** ConPTY reports the child on `ready_datapipe`, about 100 ms after `spawn` returns; until then it is 0. Measured.

### The terminal declares what it is, because it knows

Everywhere else this app spawns `claude` it passes `cleanEnv()` and nothing more. A terminal is the one case where the environment describes a *screen*, and we drew that screen — so `terminalEnv()` corrects three variables on the way in, and each one is load-bearing:

- **`NO_COLOR` is deleted.** Not hypothetical: it is persisted nowhere on this machine, and **Claude Code injects it into the environment of the subprocesses it runs**. So a dev server started from inside a Claude Code session inherits it, hands it to the CLI, and the embedded terminal comes up monochrome — no colour, and no grey bar behind the user's own prompts. Measured on the socket: **ONE SGR sequence, against 62 for the same CLI spawned by hand**, and 19 truecolor sequences afterwards. The variable is a statement about the device that launched the server; the device the CLI is drawing on is an xterm.js panel that renders 24-bit colour. Same shape as the `CLAUDE_CODE_*` strip — an inherited fact about somebody else's terminal, corrected rather than passed on.
- **`TERM` and `COLORTERM` are set.** node-pty on Windows takes a `name` and keeps it on the terminal object but **never writes it into the child's environment** (`windowsTerminal.js` reads `opt.name` and stores it), so without this the CLI is told nothing at all about what it is talking to.

This is deliberately NOT in `cleanEnv()`, which the composer and the auto-reload also use: neither of them renders ANSI, so for them `NO_COLOR` is at worst harmless.

### Looking like a terminal, and behaving like one

Three things separate "a CLI running in a web page" from "the CLI", and all three were visible side by side against a real Windows Terminal before they were fixed:

- **The renderer has to be the WebGL one, and that is not about speed.** xterm.js draws with the DOM by default — one span per cell — and `customGlyphs`, which draws box-drawing and block characters geometrically so they tile perfectly at any size, **exists only in the canvas and WebGL renderers**. With the DOM renderer those glyphs are whatever the font makes of them. Loaded after `term.open()`, which the addon requires, and disposed on context loss so a browser without WebGL falls back to the DOM rather than showing nothing.
- **`lineHeight` must be exactly 1.** The logo is half-block characters meant to tile edge to edge; 1.2 puts a stripe of background through every row of it. Leading is for prose.
- **The font still has to be a terminal font**, because the fallback path is the DOM renderer: `Cascadia Mono` leads the stack, ahead of the generic `ui-monospace`.
- **Widths must be Unicode 11.** xterm.js defaults to the Unicode 6 tables, where an emoji is one cell wide; every terminal written this decade makes it two. One cell of error shifts everything drawn after it on the line, which is what a panel border landing in a different column each row is. `@xterm/addon-unicode11` plus `term.unicode.activeVersion = '11'`.
- **Shift+Enter is a newline, and needs a protocol to be one.** A terminal sends a bare CR for Enter and, historically, the same bare CR for Shift+Enter — the modifier has nowhere to go, so the CLI saw two identical keys and sent the prompt. The **kitty keyboard protocol** is what gives the modifier somewhere to go, and Claude Code pushes it at startup (`CSI > 1 u`, alongside `modifyOtherKeys`); xterm.js implements neither, so the client sends `CSI 13;2u` itself. **Only while the protocol is actually active** — tracked by watching the output stream for the push and the matching `CSI < u` pop, because a program that never asked for it would receive the sequence as text typed into its prompt, which is a worse bug than the one being fixed.

  **The custom key handler must answer for the `keypress` too, and that is the whole fix.** Returning false from it makes xterm's `_keyDown` bail *before* it calls its own `cancel()`, so nothing stops the browser firing `keypress` — and `_keyPress` consults the same handler again. Answering only for `keydown` let that through, xterm sent `\r` from the char code, and the CLI got the sequence AND a carriage return: a newline, then the prompt submitted, which is the exact behaviour the fix was for. `preventDefault` on the keydown suppresses the keypress at source and either line alone is enough in Chrome; both stay because they fail differently.

### The PTY belongs to the server, not to the tab

There is no idle timeout, deliberately, and unlike the composer's `chatIdleTimeoutMinutes`: a process between turns has nothing to lose, and a terminal left half way through a sentence does. It ends when it is closed, when the CLI exits, or when the server does.

- **A closed tab detaches and nothing more.** Coming back replays a bounded scrollback (`SCROLLBACK_BYTES`, 256 KB, trimmed whole chunks from the front) and the terminal is where it was. That is also what makes `/new` work in terminal mode: the handover to `/session/<id>` remounts the component and it comes back attached.
- **The replay is raw bytes and can begin mid-escape**, so it is prefixed with a reset (leave the alternate screen, stop mouse reporting, show the cursor, drop the colour) and the client follows it by sending its real size, which makes a full-screen TUI repaint everything. Keeping a rendered screen server-side (`@xterm/headless`) is the alternative, and has not been needed.
- **The terminal outlives the CLI inside it, on purpose.** `open && !running` is a panel holding a dead process's last screen, with its exit code beside it. A `claude.exe` that fails to start has that screen as the only diagnosis there is, and clearing it on exit is what would turn a readable error into a flash of something.
- **`busy` is the CLI working, not the terminal existing.** An interactive session writes `status` into its pid file — verified: `entrypoint: "cli"`, `status` moving `idle` → `busy`, which a `--print` run does not do and is why the composer needs its own answer — so `busyWith(ctx)` reads it. Gating stop, restart, uninstall and update on a terminal merely being OPEN would, with no idle timeout, be a feature that quietly stops the app being maintainable.

### The socket, and what guards it

Starting is a **POST**, never the socket: a refusal has to arrive as `blockedReason` in the page, not as a socket that opens and closes again for reasons nobody can read. The socket only ever attaches.

Output goes down as **binary frames** and control messages as JSON text — output is 99% of the traffic, and wrapping it would cost a parse per keystroke echoed back. Input comes up as JSON (`{t:'i'}` / `{t:'r'}`), length-bounded.

The upgrade is an ordinary GET, so the session hook in `app.ts` covers it and a remote browser without a cookie never arrives. **Same-origin is checked in the route itself**, because the global hook exempts GET on purpose — a plain-HTTP page sends neither `Sec-Fetch-Site` nor `Origin` on an ordinary same-origin GET ([Remote access](AI_REMOTE_ACCESS.md)) — while a browser always sends `Origin` on a WebSocket upgrade, so there its absence means something.

### What the page had to learn

The slot at the foot of the conversation is shared with the composer, and everything it imposes stays in `SessionViewPage` ([AI_VIEWER.md](AI_VIEWER.md#the-end-of-the-conversation)). Two of its properties turned out to be traps:

- **Full screen cannot be a portal.** `term.open()` attaches xterm's whole DOM to the host div, and a portal is a different place in the tree — React unmounts that div and takes the terminal with it. Measured: a full screen with zero rows in it. So full screen is a class on the element that is already there, and the strip left behind says where the panel went.
- **`position: sticky` creates a stacking context**, so a `fixed inset-0 z-50` panel rendered inside that slot is numbered only against its siblings, and the follow pill — a later sibling of the scroller, with no z-index at all — paints straight over it. `elementFromPoint` in the middle of a full-screen terminal answered with the pill. The page lifts the whole slot instead, which is the only reason `SessionTerminal` reports its full-screen state upwards.
- **The keys belong to the CLI.** `isFromTerminal` asks the DOM, and the find bar's Ctrl+F and the page's Escape both stand aside for anything born inside `[data-terminal]`. Asked of the DOM rather than tracked in state, because xterm moves focus between its helper textarea and its own elements as it pleases, and a boolean beside that would be wrong exactly when it mattered.

### The native dependency

`@lydell/node-pty` — prebuilt, N-API, never node-gyp — is the first native dependency this project has, and the only reason a release carries a `node_modules` at all ([Distribution](AI_DISTRIBUTION.md)). It is imported **dynamically and caught**: a binary that will not load is a broken feature, not a server that refuses to start, and the reason has to come back through `blockedReason`, which stays the one string the endpoint and the button both read.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 8 (auto-reload), 19 (the composer, and the rules for testing it safely), 23 (plan mode round trip), 24 (answers written back), 37 (starting a session from the app), 38 (the embedded terminal, end to end).
