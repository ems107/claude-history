# Architecture

**Load this when:** you add or move a module, touch the scan → summarize → cache → enrich pipeline, add an endpoint, or need to know where a piece of state lives.

## Invariants

- **`~/.claude` is read-only to this app** — never write, create or lock anything inside it.
- **Our writes go to exactly three places**: the cache dir, `userdata.json` and `logs\`.
- **The server binds `127.0.0.1` only.** Never `0.0.0.0`.
- **Every state-changing request must come from our own pages** (`isSameOrigin`, 403 otherwise).
- **A path or a cwd never comes from the request** — it comes from the index.
- **The API shape lives in `shared/src/api.ts`** and the domain in `shared/src/types.ts`; documentation points at them instead of restating them.
- **Never hardcode a user path** — `config.ts` resolves them.

## Packages

`pnpm` workspace: `shared`, `server`, `web`. The server has no build step in dev (TypeScript runs through `tsx`), and `@claude-history/shared` is consumed as TS source by both sides.

### `shared/src/`

What both sides must agree on: `types.ts` (domain), `api.ts` (endpoint response shapes), `prices.ts`, `recache.ts`, `fold.ts` and `match.ts`.

**The search fold lives here** because a hand-kept copy in the web app drifted from the server's within an hour of being written; `match.ts` applies the same argument to finding a term ([AI_SEARCH.md](AI_SEARCH.md)). Same reasoning for `recache.ts` (enricher and viewer) and `prices.ts` (see [AI_COST_AND_CONTEXT.md](AI_COST_AND_CONTEXT.md) for the model-key rule, which is the one that has bitten).

### `server/src/config.ts`

Data root: `--data-root` flag → `CLAUDE_CONFIG_DIR` env → `~/.claude`. Cache dir: `CLAUDE_HISTORY_CACHE` env → `%LOCALAPPDATA%\claude-history\cache`. Logs dir: `--logs-dir` → sibling `logs\`.

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

### `server/src/routes/`

REST endpoints; the response shapes are in `shared/src/api.ts` and are not restated here.

`files` is the one endpoint that leaves `~/.claude` — see below. Every state its `read` can report — missing, a folder, binary, truncated — is a 200 the panel draws, because the path is still worth showing and the folder still worth opening.

Its `image` sibling serves the bytes of one picture to an `<img src>`, and **diverges on exactly that point**: a missing file is a **404** there, because the consumer is an `<img>` with no state to draw, only `onError`. It exists because `read` structurally cannot do this — a PNG has NUL bytes in its signature, so it is a `binary: true` with nothing attached — and because bytes must not ride in the conversation payload ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md)): `SendUserFile` keeps none, so the payload would read disk on every parse and a live session re-parses on every event. Its own `isSameOrigin` is what makes it safe to point an `<img>` at rather than a hole opened by one — a subresource of our page sends `Sec-Fetch-Site: same-origin`, a foreign page embedding the same URL sends `cross-site` and gets 403.

### `web/src/`

React 19 + Vite + Tailwind v4, TanStack Query, SSE — see [AI_VIEWER.md](AI_VIEWER.md).

### `installer/` and `scripts/`

The scripts shipped inside the release zip, and the packaging/release tooling — see [AI_DISTRIBUTION.md](AI_DISTRIBUTION.md).

## Where state lives

| What | Where | Regenerable |
| --- | --- | --- |
| List summaries, enrichment, search text | `%LOCALAPPDATA%\claude-history\cache\` | yes — deleting it is always safe |
| Renames, pins, starred messages, price table, settings | `userdata.json`, **beside** the cache dir | **no** |
| Logs | `logs\`, beside the cache dir | yes (pruned by `logRetentionDays`) |
| Filters, scroll position, view toggles | browser `localStorage` / `sessionStorage`, and the URL | yes |

The index itself is in memory and rebuilt on every start.

**Retired settings are dropped on load**: `SessionIndex.build` keeps only keys still in `DEFAULT_SETTINGS`. `chatModel` and `chatEffort` outlived their own removal in `userdata.json` and were still being served by `/api/settings`.

## Security and containment

- **The app only reads from `~/.claude`** — never write, create or lock anything inside it, `.credentials.json` included. Two features indirectly add files there (the auto-reload and the composer) and only because **Claude Code itself** writes its own transcript when we spawn it; we still never touch that data and never delete what it leaves behind.
- **`~/.claude` is the only place it reads on its own initiative.** The file viewer (`routes/files.ts`) reads a path a transcript names, anywhere on disk and with no containment rule — a session links to another repo, to `~/.claude/settings.json`, to a file since moved — but only when the user clicks the link, and it still **never writes**. Two things pay for that, and both must survive any change to the endpoint: the reference is resolved against the session's project path taken from the **index**, never from the request (the `/resume` model), and the GET carries **its own `isSameOrigin` check**, because the hook in `app.ts` guards only the methods that change state while this one can read anything the user can.
- **A served file's `Content-Type` comes from our own extension allowlist, never from the transcript.** `attachments[].media_type` is written by another process into a file we only read, and echoing it back as a header would serve arbitrary content **from our own origin**. `svg` is off the list on purpose: it is a document that can carry script, and `image/svg+xml` from `127.0.0.1:7433` is same-origin execution reached from a transcript. Plus `nosniff`, a size cap answering **413 and never a truncated image** (half a PNG draws as a broken one and reads as a deleted file), and 415 for anything not on the list — not 404, because the file may be right there and "we do not serve this" is a different fact.
- **Every state-changing request must come from our own pages** (`util/sameOrigin.ts`, an `onRequest` hook in `app.ts`, 403 otherwise). Binding to `127.0.0.1` keeps other machines out and says nothing about the browser already running on this one: any page the user has open can POST to `127.0.0.1:7433`, and these endpoints open terminals, stop the server and run Claude with auto-approved tools. It cannot read the reply and does not need to — **the side effect is the attack**. `Sec-Fetch-Site` answers it (the browser sets it and a page cannot forge it), `Origin` covers the rest, and neither present means it is not a browser at all (curl, the installer's health check) and is allowed through.
- **The server binds `127.0.0.1` only. Never `0.0.0.0`.**
- `POST /api/sessions/:id/resume` validates the id (UUID regex + membership in the index) and takes `cwd` **only from the index**, never from the request.
- The tool-results endpoint accepts a bare filename and must verify the resolved path stays inside that session's `tool-results/` dir.
- **A turn in flight refuses `POST /api/server/stop`, `POST /api/uninstall` and `POST /api/update/apply` with 409**, the same way an update in flight already refused the first two.
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
