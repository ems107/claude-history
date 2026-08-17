# CLAUDE.md

## Read this first

The detail lives in `docs/`, one document per area. **Load the ones that match what you are about to touch, before touching it** — each opens with an `Invariants` list you can read in seconds.

| Document | Load it when |
| --- | --- |
| [Transcripts](docs/AI_TRANSCRIPTS.md) | anything that reads `~/.claude`: the JSONL format, who wrote a line, the tree a `/rewind` leaves, forks, replays, live sessions, retention |
| [Tokens, cost and context](docs/AI_COST_AND_CONTEXT.md) | counting tokens, pricing a message, cost/context pills, re-cached context, compaction |
| [Subagents, questions and plans](docs/AI_AGENTS_QUESTIONS_PLANS.md) | the ⑂ panel, `AskUserQuestion`, plan mode, offloaded tool output |
| [The viewer](docs/AI_VIEWER.md) | anything under `web/src/`: folding, deep links, highlighting, the find bar, file references, the working indicator |
| [Search](docs/AI_SEARCH.md) | the index, the deep scan, folding/matching, the paged match list |
| [Architecture](docs/AI_ARCHITECTURE.md) | the scan → summarize → cache → enrich pipeline, a new endpoint, where state lives, containment rules |
| [Running Claude](docs/AI_RUNNING_CLAUDE.md) | subscription usage, the auto-reload, the composer — anything that talks to Anthropic or spawns `claude` |
| [Logging](docs/AI_LOGGING.md) | adding logging, or working out what an installed instance did |
| [Distribution](docs/AI_DISTRIBUTION.md) | packaging, the installer, self-update, cutting a release |
| [Windows](docs/AI_WINDOWS.md) | resolving an executable, spawning a process, opening a terminal or Explorer |
| [Verifying a change](docs/AI_TESTING.md) | proving something works — and finding a fixture with the property you need |

Two rules about the documents themselves: **one home per fact** (if it is already written down, link to it instead of repeating it), and **never restate what the code says** — the API shape is `shared/src/api.ts` and the domain is `shared/src/types.ts`.

## What this project is

**claude-history** is a personal, local-only web app that browses ALL Claude Code conversations across ALL projects on this machine — a global version of the `/resume` picker with rich filtering, a full conversation viewer, full-text search, live-session badges and "resume in terminal" actions.

It is a standalone personal tool, **NOT part of the PCCOM ecosystem** (no Jira, no PCCOM conventions beyond the language rule: everything in this repo is written in English).

`~/.claude` is an undocumented internal format, and the rules for reading it — verified empirically, one bug at a time — are the most valuable thing in the repo. That is what `docs/AI_TRANSCRIPTS.md`, `AI_COST_AND_CONTEXT.md` and `AI_AGENTS_QUESTIONS_PLANS.md` hold.

## Commands

Package manager **pnpm**, workspace `shared` + `server` + `web`.

| Command | What it does |
| --- | --- |
| `pnpm install` | install all workspace deps |
| `pnpm dev` | Fastify API on `http://127.0.0.1:7433` (tsx watch) + Vite UI on `http://localhost:5173` (proxies `/api`) |
| `pnpm build` | build the web app to `web/dist` |
| `pnpm start` | the Fastify server serves `web/dist` and the API on `http://localhost:7433` |
| `pnpm start:bg` / `pnpm stop` | launch detached (hidden window) / kill the port-7433 listener |
| `pnpm typecheck` | `tsc --noEmit` in all packages |
| `pnpm package` | build the portable zip — always version `dev`; see [Distribution](docs/AI_DISTRIBUTION.md) |
| `pnpm release -- --version X.Y.Z --notes-file <path>` | cut a release — **only when asked**; see [Distribution](docs/AI_DISTRIBUTION.md) |

The server has no build step in dev: TypeScript runs via `tsx`, and `@claude-history/shared` is consumed as TS source by both sides. Logging needs no flag in any mode ([Logging](docs/AI_LOGGING.md)); `start:bg` runs detached with a hidden window, so the log files are the only trace of anything a background job does.

> **Always leave the app running after changing it.** The user browses `http://127.0.0.1:7433` and expects to find his edits there — never end a turn with that port dead or serving the old code. After any change: `pnpm build`, then leave the source server up on 7433.
>
> **If you are Claude and the user is talking to you through the composer, restarting the server kills you.** Your own session is being answered by a `claude` process this server spawned, so `chat.shutdown()` takes it down with everything else — mid-turn, mid-sentence, and the work in flight is lost. `POST /api/server/stop` refuses with 409 while a turn is running, but `pnpm stop` bypasses the API and kills the port's owner outright. Check first (`GET /api/sessions/<your-session-id>/chat` — `running: true` means you are the one about to die), and if the server really must be reloaded, make it the LAST action of the turn, after everything is committed. Verified the hard way, twice.
>
> That port belongs to the installed release, started by the `claude-history` scheduled task, so the sequence is: `Stop-ScheduledTask claude-history` → wait until nothing listens on 7433 (the old process needs a moment to release it) → `pnpm start:bg` → poll `/api/meta` until it answers, and check it reports version `dev` (proof the source instance won the port, not a surviving release one). To hand the port back: `pnpm stop` then `Start-ScheduledTask claude-history`. A logon does it anyway — the detached dev process does not survive one, and the task's AtLogOn trigger fires.

> **NEVER cut a release on your own initiative.** `pnpm release` publishes a public GitHub release and makes every installed instance offer the update — that is the user's call, always. Commit and push freely; tag and release ONLY when the user explicitly asks for it in that turn. "Finish this feature" is not a request to release it.

## Workspace map

```
shared/src/     types.ts · api.ts · prices.ts · recache.ts · fold.ts · match.ts · searchText.ts
                (anything both sides must agree on lives here, and only here)
server/src/
  config.ts     data root / cache dir / logs dir resolution
  core/         scanner → summarizer → cache → enricher → watcher, parser, index,
                search · deepSearch · searchText, usage · autoReload · sessionChat,
                updates · updateLogImport, logger · logReader, retention
  routes/       the REST surface (shapes in shared/src/api.ts)
  util/         launcher (executable resolution), sameOrigin, fetchError
web/src/        React 19 + Vite + Tailwind v4, TanStack Query, SSE
                components/viewer/ is where the conversation is drawn
installer/      what ships inside the release zip (pure ASCII, PowerShell 5.1)
scripts/        package.mjs · release.mjs
```

## Hard rules

- **The app only READS `~/.claude`.** Never write, create or lock anything inside it — `.credentials.json` included. Our writes go to the cache dir, `userdata.json` and `logs\`, and nowhere else. → [Architecture](docs/AI_ARCHITECTURE.md)
- **Exactly two automatic network calls exist**, both switchable off in Settings: the update-availability check (a conditional GET to `api.github.com`, downloads nothing) and the subscription-usage read. Everything else is user-triggered: fetching prices (`POST /api/prices/fetch` scrapes `platform.claude.com/docs/en/about-claude/pricing.md` — there is no pricing API; preview only, nothing persists until saved, and the parser fails loudly so the UI can fall back to manual editing), applying an update (confirmed, SHA-256 verified) and the auto-reload's "Send it now". **Never add a third.**
- **Subscription usage is read-only**: never refresh the token, never write `.credentials.json`. → [Running Claude](docs/AI_RUNNING_CLAUDE.md)
- **The server binds `127.0.0.1` only**, and every state-changing request must come from our own pages (403 otherwise). A path or a cwd never comes from the request — it comes from the index. → [Architecture](docs/AI_ARCHITECTURE.md)
- **Session renames are local overrides**; the UI always surfaces `originalTitle` beside them. → [Architecture](docs/AI_ARCHITECTURE.md)
- **A starred message keeps its own copy of the text**, keyed on the message's canonical uuid, and starring never invalidates `['session', id]`. → [Architecture](docs/AI_ARCHITECTURE.md)
- **The reading half is ours; the Agent SDK is only used to run Claude.** → [Running Claude](docs/AI_RUNNING_CLAUDE.md)
- **Everything in `~/.claude` has an expiry date** (`cleanupPeriodDays`), fixtures included. → [Transcripts](docs/AI_TRANSCRIPTS.md)
- **Never log with `console.*`** in new code. → [Logging](docs/AI_LOGGING.md)
- **Wrap every `JSON.parse` of a transcript line in try/catch.** Lines can be corrupt or half-written, and active files grow while being read.

## Verifying a change

There is no automated test suite: this is a personal tool and it is checked against real data. [docs/AI_TESTING.md](docs/AI_TESTING.md) holds the 28 checks, grouped by area and referenced by number from the other documents, plus the fixture survey — **the session ids used as fixtures expire**, so start there rather than trusting an id you read elsewhere.
