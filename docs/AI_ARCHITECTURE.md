# Architecture

**Load this when:** you add or move a module, touch the scan → summarize → cache → enrich pipeline, add an endpoint, or need to know where a piece of state lives.

## Invariants

- **`~/.claude` is read-only to this app** — never write, create or lock anything inside it.
- **Our writes go to exactly four places**: the cache dir, `userdata.json`, its `backups\` and `logs\`.
- **A release binds `0.0.0.0`, a dev instance `127.0.0.1`** — and a request from another machine gets nothing until it signs in ([AI_REMOTE_ACCESS.md](AI_REMOTE_ACCESS.md)).
- **Every state-changing request must come from our own pages** (`isSameOrigin`, 403 otherwise).
- **A path or a cwd never comes from the request** — it comes from the index. One exception, and it is named below: the folder a new session is started in.
- **The API shape lives in `shared/src/api.ts`** and the domain in `shared/src/types.ts`; documentation points at them instead of restating them.
- **Never hardcode a user path** — `config.ts` resolves them.

## Packages

`pnpm` workspace: `shared`, `server`, `web`. The server has no build step in dev (TypeScript runs through `tsx`), and `@claude-history/shared` is consumed as TS source by both sides.

### `shared/src/`

What both sides must agree on: `types.ts` (domain), `api.ts` (endpoint response shapes), `prices.ts`, `recache.ts`, `fold.ts` and `match.ts`.

**The search fold lives here** because a hand-kept copy in the web app drifted from the server's within an hour of being written; `match.ts` applies the same argument to finding a term ([AI_SEARCH.md](AI_SEARCH.md)). Same reasoning for `recache.ts` (enricher and viewer) and `prices.ts` (see [AI_COST_AND_CONTEXT.md](AI_COST_AND_CONTEXT.md) for the model-key rule, which is the one that has bitten).

### `server/src/config.ts`

Data root: `--data-root` flag → `CLAUDE_CONFIG_DIR` env → `~/.claude`. Cache dir: `CLAUDE_HISTORY_CACHE` env → `%LOCALAPPDATA%\claude-history\cache`. Logs dir: `--logs-dir` → sibling `logs\`. Port: `PORT` env → `--port` → 7433.

**`--dev-instance` moves the port and the data folder together, and nothing else knows.** It swaps one folder name — `claude-history-dev` — and the cache, `userdata.json`, its `backups\` and the logs all follow, because all four are resolved from it here; the port default follows too (7434). That is the whole mechanism behind [two instances side by side](../CLAUDE.md#two-instances-and-the-line-between-them): no second install, no second scheduled task, no code path that asks which instance it is except the two places that must say so out loud (`/api/meta`'s `devInstance`, and the settings defaults in `DEV_SETTING_OVERRIDES`).

**Argument problems go into `config.warnings` instead of being printed**: config is resolved before logging exists, so a `console.warn` here would never reach the log files.

### `server/src/core/` — the pipeline

```
scanner      enumerate transcript files
  ↓
summarizer   cheap head/tail metadata per session
  ↓
cache        keyed by (path, size, mtimeMs) — plus subagentBytes, see below
  ↓
enricher     background full parse: tokens (own and subagents'), PR links,
             ancestry, plans, search text
  ↓
watcher      fs.watch → SSE
```

`parser` builds the full conversation for the viewer on demand. `index` orchestrates everything and owns `rescan()`, `list()`, `get()` and `liveSessions`.

The rest, each documented where it belongs: `updates` (self-update lifecycle — [AI_DISTRIBUTION.md](AI_DISTRIBUTION.md)), `usage` and `autoReload` — the only thing besides the watcher that runs on a schedule of its own — and `sessionChat` ([AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md)), `logger` / `logReader` / `updateLogImport` ([AI_LOGGING.md](AI_LOGGING.md)), `searchText` / `search` / `deepSearch` ([AI_SEARCH.md](AI_SEARCH.md)), `retention` and `contextSnapshot` ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md), [AI_COST_AND_CONTEXT.md](AI_COST_AND_CONTEXT.md)).

**A session that has just grown answers WITHOUT its enrichment.** The write invalidates the cached entry and the full parse runs in the background, so `GET /api/sessions/:id` carries `enrichment: null` until it lands — **measured at ~105 ms** on a live session's own transcript, once per message. That is the pipeline working as intended; what must not happen is the LAYOUT depending on it. Anything whose height changes when those figures go has to hold the previous ones instead — the session header does, because dropping its counts row moved the page twice per message ([AI_VIEWER.md](AI_VIEWER.md#nothing-above-the-conversation-may-change-height)). A row that merely swaps text inline, as the list's does (`N prompts` for `~N msgs`), reflows nothing and is left alone.

**Cache invalidation has two keys, not one.** (path, size, mtimeMs) cannot see an agent writing another answer, which changes what a session cost without touching a byte of its file — hence `ScannedSession.subagentBytes`, compared by both `rescan()` and `enrichOne()`. Schema changes are handled by bumping `CACHE_VERSION`, after which `/api/meta` must report `cacheHits: 0` and a full re-enrich.

**An event that fires often has to say what moved.** `sessions-changed` is the busiest one — every write of every live session — and it carries two classifications so the browser can refetch narrowly: `assistantIds`, the sessions where Claude actually answered (the only ones worth a subscription read), and `agents`, the subagent transcripts that grew, each with its session. `ScannedSession.subagentSizes` is what answers the second, because the total above can only say *some* agent wrote, and a session with eleven of them is eleven separate conversations of 350-500 KB behind their own query keys ([AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md#a-running-agent)). Neither field is a payload: they name what to ask for.

**A service that watches another service subscribes; it does not get called.** `NotificationsService` needs the previous status of every live session, which no event carries — `live-changed`'s `ids` are the membership difference, deliberately, because a busy/idle flip changes nobody's `blockedReason`. So it listens to `live-changed` and `chat-changed`, re-reads `index.liveSessions` itself and keeps its own memory of what each session was doing. `refreshLive()` is untouched and that event goes on meaning exactly what it meant: the alternative was widening a payload six readers depend on, for one of them.

### `server/src/routes/`

REST endpoints; the response shapes are in `shared/src/api.ts` and are not restated here.

`files` is the one endpoint that leaves `~/.claude` — see below. Every state its `read` can report — missing, a folder, binary, truncated — is a 200 the panel draws, because the path is still worth showing and the folder still worth opening.

Its `image` sibling serves the bytes of one picture to an `<img src>`, and **diverges on exactly that point**: a missing file is a **404** there, because the consumer is an `<img>` with no state to draw, only `onError`. It exists because `read` structurally cannot do this — a PNG has NUL bytes in its signature, so it is a `binary: true` with nothing attached — and because bytes must not ride in the conversation payload ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md)): `SendUserFile` keeps none, so the payload would read disk on every parse and a live session re-parses on every event. Its own `isSameOrigin` is what makes it safe to point an `<img>` at rather than a hole opened by one — a subresource of our page sends `Sec-Fetch-Site: same-origin`, a foreign page embedding the same URL sends `cross-site` and gets 403.

The third, `stats`, answers `stat` and nothing else for a BATCH of paths, and is the only read here that is a POST. Two reasons, both structural: these are absolute scratchpad paths of 130–400 characters and a session's worth of them does not fit in a request line, and the method is what earns it the global same-origin hook instead of a private `isSameOrigin` — on a GET the absence of `Origin` means nothing, on a POST it means plenty. It caps the batch (`MAX_STAT_PATHS`) so it cannot become a filesystem scanner, refuses the whole request only over the session id (which every path is resolved against), and reports an unresolvable or unreadable path as a 200 entry with `error` beside the other twenty. It echoes each `ref` back verbatim so the caller joins on identity rather than re-deriving the resolution rule.

### `web/src/`

React 19 + Vite + Tailwind v4, TanStack Query, SSE — see [AI_VIEWER.md](AI_VIEWER.md).

### `installer/` and `scripts/`

The scripts shipped inside the release zip, and the packaging/release tooling — see [AI_DISTRIBUTION.md](AI_DISTRIBUTION.md).

## Where state lives

| What | Where | Regenerable |
| --- | --- | --- |
| List summaries, enrichment, search text | `%LOCALAPPDATA%\claude-history\cache\` | yes — deleting it is always safe |
| Renames, pins, starred messages, price table, settings | `userdata.json`, **beside** the cache dir | **no** |
| Remote-access username, password hash and cookie-signing key | `userdata.json`, under `auth` — **never** inside `settings`, which is served whole to any signed-in browser | **no** |
| Dated copies of that file | `backups\`, beside it | yes — but they are the only way back to a lost `userdata.json` |
| Logs | `logs\`, beside the cache dir | yes (pruned by `logRetentionDays`) |
| Filters, scroll position, view toggles | browser `localStorage` / `sessionStorage`, and the URL | yes |
| Which sessions have stopped (the bell) | in memory, `core/notifications.ts` | **no — and deliberately** |
| What a tab has READ of a session (the row's unread count) | in memory, `web/src/lib/unread.ts` | **no — and deliberately**, same argument |

**The last two rows are the ones that could have been persisted and must not be.** A notification is raised by a TRANSITION — a session seen to leave `busy` — and a restart loses the transitions along with the rows, so a saved row would outlive its own evidence and claim to have watched something happen that nobody watched. Emptying on restart is the honest behaviour, and it also keeps this out of the five places in `index.ts` that a new kind of user data has to be added to at once. **A read mark is the same fact one layer up**: "what has arrived since you read it" is a transition a PAGE watched, so a reload empties it for the reason a restart empties the bell ([AI_VIEWER.md](AI_VIEWER.md#what-a-list-row-says-you-have-not-seen)).

The index itself is in memory and rebuilt on every start. Every path in that table is relative to the instance's data folder, so a dev instance has its own set of all four — none of it is shared, and a dev run cannot corrupt or lose what the release holds.

**Retired settings are dropped on load**: `SessionIndex.build` keeps only keys still in `DEFAULT_SETTINGS`. `chatModel` and `chatEffort` outlived their own removal in `userdata.json` and were still being served by `/api/settings`.

### `userdata.json` is the one file a write may not lose

It holds the only state that cannot be rebuilt, and **several browser windows write it at once** — a star in one and a pin in the other land in the same tick, through the same in-memory index.

- **Writes are serialized per path** (`writeTextAtomic` in `cache.ts`). Two overlapping writes shared one `.tmp`, and the old path failed both ways at once — **measured with 8 concurrent 4 MB writes: 4 of the 8 rejected with ENOENT** (their `rename` found the tmp already moved away by another) **and ~40% of the rows in the file came from a different writer**. It parsed there only because every document happened to be the same length; two of different lengths leave JSON nothing can read. With the queue: 0 failures, 0 mixed rows. The queue is per path and keeps the fixed tmp name, which cleans itself up — a unique name left behind by a process that died between the write and the rename would stay on disk for good. `DiskCache` writes through the same queue, which also keeps its debounced `index.json` write off whatever wrote it last.
- **Every write to it needs an event of its own**, because a browser cannot see a file. Renames and pins ride `session-updated`, stars ride `stars-changed`, and settings and the price table have `settings-changed` / `prices-changed`. Those two were added when a second window was found running the OLD settings for as long as it stayed open — `['settings']` is mounted for the life of the page by the usage widget in the header, so the query never remounts, and `refetchOnWindowFocus` is off — and that included the switches deciding whether this app touches the network at all. **`settings-changed` must never invalidate `['usage']`**: that turns one person's toggle into a network read in every open window, and the window that saved already does its own labelled read.
- **An unparseable one is kept, not stepped over** (`readJsonFileOrQuarantine`): it becomes `userdata.json.corrupt-<stamp>` and the failure is logged at `error`. Answering null for "broken" the way the cache readers do meant the defaults loaded silently and the first write of the run buried the evidence. The app still opens — refusing to start over one bad file is the worse failure — so the log line is the only notice, which is why it is an `error` and names what was replaced.
- **And there is something to put back** (`core/userdataBackups.ts`, `backups\` beside the file — never inside the cache dir, which is documented as safe to delete). A start-up that finds the file broken restores **the newest copy that parses**, writes it back so a crash cannot lose it twice, and reports it on `GET /api/userdata/backups` as well as in the log.

### What each copy is for

The triggers are not a schedule, they are one per way of losing the file, and each is deduplicated against the newest copy held — a day on which nothing changed costs nothing.

| Copy | Taken when | Guards against |
| --- | --- | --- |
| `initial` / `daily` | first write of a day, and at start-up | a change made days ago and noticed now (kept for 14 days) |
| `version-X` | start-up under a version that did not write last (`backups\state.json`) | a regression arriving with a new build, including one installed by hand |
| `pre-update-X` | the moment an update is accepted, by the version still running | the same, for our own updater — taken by code known to work |
| `pre-loss` | a write about to zero renames, pins, stars or the remote-access credentials that had content | **a valid but incomplete file**, which nothing else can catch |
| `pre-restore` | restoring a copy | picking the wrong line in a list of dates |
| `manual` | `POST /api/userdata/backups` | about to edit prices, about to try something |

- **`pre-loss` is the one that matters most**, because it is the only guard against the accident the quarantine structurally cannot see: `saveUserdata()` writes the whole file from one literal, so a key missing from it parses perfectly and is simply gone. The write is never refused — clearing every star by hand is a real thing to do — only preceded by a copy and a `warn`.
- **A copy's name is its clock** (`userdata.json.<yyyy-mm-dd_hh-mm-ss>.<reason>.bak`, local time). Never the mtime: copying the folder or restoring the machine rewrites every mtime at once, which would make the newest copy look like all of them and the 14-day window meaningless. The reason lives in the name too, so the folder answers "why do I have this" with no index file that could itself go bad.
- **Retention counts KINDS, not reasons**: `pre-update-1.0.0` and `pre-update-1.0.1` are the same kind, and counting by the full reason kept one copy per version for ever (measured: four survived a rule that keeps three). Plus a total-size ceiling, because a starred message can be 200,000 characters — and the newest copy is never pruned whatever the rules say.
- **Restoring happens in place** (`SessionIndex.restoreBackup`): it takes its `pre-restore` copy, re-reads through the same `applyUserdata` the start-up uses, and announces itself with the ordinary events (`sessions-changed` for the ids whose row can differ, then `stars-changed`, `settings-changed`, `prices-changed` — whose listeners re-apply the log level and the auto-reload signature). A restore that needed a restart is a restore nobody performs.

## Security and containment

- **The app only reads from `~/.claude`** — never write, create or lock anything inside it, `.credentials.json` included. Three features indirectly add files there (the auto-reload, the composer and the embedded terminal) and only because **Claude Code itself** writes its own transcript when we spawn it; we still never touch that data and never delete what it leaves behind.
- **`~/.claude` is the only place it reads on its own initiative.** The file viewer (`routes/files.ts`) reads a path a transcript names, anywhere on disk and with no containment rule — a session links to another repo, to `~/.claude/settings.json`, to a file since moved — but only when the user clicks the link, and it still **never writes**. Two things pay for that, and both must survive any change to the endpoint: the reference is resolved against the session's project path taken from the **index**, never from the request (the `/resume` model), and the GET carries **its own `isSameOrigin` check**, because the hook in `app.ts` guards only the methods that change state while this one can read anything the user can.
- **A served file's `Content-Type` comes from our own extension allowlist, never from the transcript.** `attachments[].media_type` is written by another process into a file we only read, and echoing it back as a header would serve arbitrary content **from our own origin**. `svg` is off the list on purpose: it is a document that can carry script, and `image/svg+xml` from `127.0.0.1:7433` is same-origin execution reached from a transcript. Plus `nosniff`, a size cap answering **413 and never a truncated image** (half a PNG draws as a broken one and reads as a deleted file), and 415 for anything not on the list — not 404, because the file may be right there and "we do not serve this" is a different fact.
- **Every state-changing request must come from our own pages** (`util/sameOrigin.ts`, an `onRequest` hook in `app.ts`, 403 otherwise). Reaching the server says nothing about the browser already running on this machine: any page the user has open can POST to `127.0.0.1:7433`, and these endpoints open terminals, stop the server and run Claude with auto-approved tools. It cannot read the reply and does not need to — **the side effect is the attack**. `Sec-Fetch-Site` answers it (the browser sets it and a page cannot forge it), `Origin` covers the rest, and neither present means it is not a browser at all (curl, the installer's health check) — allowed **from this machine**, refused from any other, where "a session cookie but no browser" is not a shape our own UI takes.
- **The bind is wide and the door is the session check**, not the socket: a release listens on `0.0.0.0` so a remote request can be answered and explained, and everything from a non-loopback address is refused until it signs in. Local requests never authenticate — being at the machine already grants everything a password would protect. The whole model, and the twelve endpoints that stay local-only whatever happens, are in [AI_REMOTE_ACCESS.md](AI_REMOTE_ACCESS.md).
- `POST /api/sessions/:id/resume` validates the id (UUID regex + membership in the index) and takes `cwd` **only from the index**, never from the request.
- **`POST /api/chat/new` is the one endpoint that may be handed a folder**, and it is a considered exception rather than a gap: a folder Claude Code has never run in appears in no index, so the rule as written would mean the app can only ever continue sessions a terminal started. It is validated instead of trusted — absolute, existing, a directory, quotes stripped — and the id it mints is checked against the index before it is handed out. A `projectKey` remains the ordinary road and resolves through `index.projects()`. Nothing else about the reservation comes from the browser, and the same-origin hook and the remote sign-in stand in front of it as before. → [AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md#the-folder-which-is-the-one-path-that-comes-from-the-request)
- The tool-results endpoint accepts a bare filename and must verify the resolved path stays inside that session's `tool-results/` dir.
- **A turn in flight refuses `POST /api/server/stop`, `POST /api/server/restart`, `POST /api/uninstall` and `POST /api/update/apply` with 409**, the same way an update in flight already refused the others.
- **Network policy**: exactly two automatic calls exist — see the summary in [CLAUDE.md](../CLAUDE.md#hard-rules), the update check in [AI_DISTRIBUTION.md](AI_DISTRIBUTION.md) and the usage read in [AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md). Never add a third.

## Session renames are LOCAL overrides only

There is NO official CLI or API to rename a stored session; the only Claude-level mechanism is `/rename` from inside the session, which appends a `custom-title` sidecar line. Appending that line ourselves was evaluated and **rejected**: appends can race with an active session writing the same file, and the file may not end with a newline — a nonzero corruption risk.

When overridden, summaries expose `originalTitle` (what Claude Code still shows) and `titleSource: 'local'`, and **the UI must always surface both**. (The Agent SDK's `renameSession()` / `tagSession()` would write into the transcript — see the reading/running line in [AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md).)

## A star keeps its own copy of the message

The third local override after renames and pins, and the only one that stores
CONTENT: `stars` in `userdata.json` holds the message's text, its role, its
clock, and the session title and project as they were.

**Two things pay for that duplication.** The Starred page then parses nothing —
reading the text back out of the transcripts would mean one `parseSession` per
starred session on every visit (~100-200 ms each; 208 ms on the 16 MB one) and
the cost would grow with use. And a star **outlives its transcript**: everything
in `~/.claude` expires ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md)), while the whole
point of starring something is to keep it. Nothing can go stale meanwhile —
transcript lines are append-only, so a message's text never changes once
written.

- **The copy is bounded** (`STAR_TEXT_MAX`, 200,000 characters) and says when it
  was cut: this file is read whole at startup and rewritten in full on every pin,
  and a prompt can carry a pasted log of any size.
- **The key is the message's CANONICAL uuid.** A streamed answer merges its
  chunks, so the endpoint resolves an alias before storing, and the viewer asks
  `isStarred` with the aliases too.
- **Where it came from is re-read from the index whenever the session is still
  there**, so a local rename shows on the Starred page as well; the stored title
  and project are the fallback for a session that has gone.
- **Starring emits `stars-changed`, never `session-updated`** — that event
  invalidates `['session', id]`, which is a full re-parse of the transcript in
  every open tab for a write that touched nothing in it.
- **Unstarring asks nothing about the session.** A star whose transcript has gone
  is exactly the one that has to stay removable, so only the starring path needs
  the session in the index.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 1, 5, 21 (the files endpoint), 25 (starred messages), 28 (the image endpoint), and the same-origin cases in 19.
