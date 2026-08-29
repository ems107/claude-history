# CLAUDE.md

## Read this first

The detail lives in `docs/`, one document per area. **Load the ones that match what you are about to touch, before touching it** — each opens with an `Invariants` list you can read in seconds.

| Document | Load it when |
| --- | --- |
| [Transcripts](docs/AI_TRANSCRIPTS.md) | anything that reads `~/.claude`: the JSONL format, who wrote a line, the tree a `/rewind` leaves, forks, replays, live sessions, retention |
| [Tokens, cost and context](docs/AI_COST_AND_CONTEXT.md) | counting tokens, pricing a message, cost/context pills, re-cached context, compaction |
| [Subagents, questions and plans](docs/AI_AGENTS_QUESTIONS_PLANS.md) | the ⑂ panel, `AskUserQuestion`, plan mode, offloaded tool output |
| [The viewer](docs/AI_VIEWER.md) | anything under `web/src/`: folding, deep links, highlighting, the find bar, file references, the working indicator, the settings page |
| [Search](docs/AI_SEARCH.md) | the index, the deep scan, folding/matching, the paged match list |
| [Architecture](docs/AI_ARCHITECTURE.md) | the scan → summarize → cache → enrich pipeline, a new endpoint, where state lives, containment rules |
| [Running Claude](docs/AI_RUNNING_CLAUDE.md) | subscription usage, the auto-reload, the composer, the embedded terminal — anything that talks to Anthropic or spawns `claude` |
| [Remote access](docs/AI_REMOTE_ACCESS.md) | the bind address, signing in, the local/remote split, anything that acts on the server's own desktop |
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
| `.\dev.ps1` | **start the dev instance** on `http://127.0.0.1:7434` (builds if needed, detached, opens the browser). `-Build` `-Restart` `-Stop` `-Foreground` `-Seed` |
| `.\preview.ps1` | **start a release-shaped instance** on `7435`, own data folder, subject to the same bind gate a release is — the only way to try [remote access](docs/AI_REMOTE_ACCESS.md) without publishing a release. Same flags |
| `pnpm dev` | Fastify API on `http://127.0.0.1:7434` (tsx watch) + Vite UI on `http://localhost:5173` (proxies `/api`) |
| `pnpm build` | build the web app to `web/dist` |
| `pnpm start` | the Fastify server serves `web/dist` and the API on `http://127.0.0.1:7434` |
| `pnpm start:bg` / `pnpm stop` | launch detached (hidden window) / kill the **dev** port's listener (refuses 7433) |
| `pnpm typecheck` | `tsc --noEmit` in all packages |
| `pnpm package` | build the portable zip — always version `dev`; see [Distribution](docs/AI_DISTRIBUTION.md) |
| `pnpm release -- --version X.Y.Z --notes-file <path>` | cut a release — **only when asked**; see [Distribution](docs/AI_DISTRIBUTION.md) |

The server has no build step in dev: TypeScript runs via `tsx`, and `@claude-history/shared` is consumed as TS source by both sides. Logging needs no flag in any mode ([Logging](docs/AI_LOGGING.md)); `start:bg` runs detached with a hidden window, so the log files are the only trace of anything a background job does.

### Two instances, and the line between them

> **The installed release owns port 7433 and `%LOCALAPPDATA%\claude-history`. Never take either.** It is the copy that always works and the one whose composer answers while everything else is being rebuilt, so no command in this repo may stop it, rebuild it, or bind its port. Stopping the `claude-history` scheduled task is the user's call alone.
>
> **Everything run from this checkout is the dev instance**, and one flag is what makes it so: `--dev-instance` (in `server/package.json`'s `dev` and `start` scripts) moves the port to **7434** and the whole data folder to **`%LOCALAPPDATA%\claude-history-dev`** — cache, `userdata.json`, its `backups\` and `logs\`, all four resolved from that one name in `config.ts`. `PORT` / `--port` and `CLAUDE_HISTORY_CACHE` still override. The packaged build never passes the flag, so a release is unaffected by all of this.
>
> The two share exactly one thing: `~/.claude`, which both only read. Nothing else is common — not the settings, not the stars, not the logs. The dev instance also starts with the two automatic network calls off (`DEV_SETTING_OVERRIDES`): checking for updates is pointless where none can be applied, and doubled usage reads rate-limit **per account**, i.e. a 429 earned here would blank the release's widget too.
>
> **Always leave the dev instance running after changing it.** The user browses `http://127.0.0.1:7434` and expects to find his edits there — never end a turn with it dead or serving the old code. After any change: `pnpm build`, then `.\dev.ps1 -Restart -NoBrowser`, and check `/api/meta` answers with `devInstance: true`.
>
> **If you are Claude and the user is talking to you through the composer, restarting the server that spawned you kills you.** `chat.shutdown()` takes your `claude` process down with everything else — mid-turn, mid-sentence, work in flight lost. `POST /api/server/stop` refuses with 409 while a turn is running, but `pnpm stop` and `dev.ps1 -Stop` bypass the API and kill the port's owner outright. This is what the split is for: the composer session normally belongs to the release on 7433, which nothing here restarts. Check anyway when in doubt (`GET /api/sessions/<your-session-id>/chat` — `running: true` on the port you are about to kill means you are the one about to die), and if that server really must be reloaded, make it the LAST action of the turn, after everything is committed. Verified the hard way, twice.

> **NEVER cut a release on your own initiative.** `pnpm release` publishes a public GitHub release and makes every installed instance offer the update — that is the user's call, always. Commit and push freely; tag and release ONLY when the user explicitly asks for it in that turn. "Finish this feature" is not a request to release it.

## Workspace map

```
shared/src/     types.ts · api.ts · prices.ts · recache.ts · fold.ts · match.ts · searchText.ts
                (anything both sides must agree on lives here, and only here)
server/src/
  config.ts     data root / cache dir / logs dir / port resolution, dev-instance split
  core/         scanner → summarizer → cache → enricher → watcher, parser, index,
                search · deepSearch · searchText, usage · autoReload,
                sessionChat · sessionTerminal · writerGuard,
                updates · updateLogImport, logger · logReader, retention, bind
  routes/       the REST surface (shapes in shared/src/api.ts)
  util/         launcher (executable resolution), sameOrigin, fetchError, firewall
web/src/        React 19 + Vite + Tailwind v4, TanStack Query, SSE
                components/viewer/ is where the conversation is drawn
installer/      what ships inside the release zip (pure ASCII, PowerShell 5.1)
scripts/        package.mjs · release.mjs
```

## Hard rules

- **The app only READS `~/.claude`.** Never write, create or lock anything inside it — `.credentials.json` included. Our writes go to the cache dir, `userdata.json`, its `backups\` and `logs\`, and nowhere else. → [Architecture](docs/AI_ARCHITECTURE.md)
- **Exactly two automatic network calls exist**, both switchable off in Settings: the update-availability check (a conditional GET to `api.github.com`, downloads nothing) and the subscription-usage read. Everything else is user-triggered: fetching prices (`POST /api/prices/fetch` scrapes `platform.claude.com/docs/en/about-claude/pricing.md` — there is no pricing API; preview only, nothing persists until saved, and the parser fails loudly so the UI can fall back to manual editing), applying an update (confirmed, SHA-256 verified) and the auto-reload's "Send it now". **Never add a third** — and the newest way to add one by accident is a voice: the notification narrator offers only voices with `localService`, because Edge's "Natural" ones are synthesised on Microsoft's servers. → [The viewer](docs/AI_VIEWER.md)
- **Subscription usage is read-only**: never refresh the token, never write `.credentials.json`. → [Running Claude](docs/AI_RUNNING_CLAUDE.md)
- **The wide bind is earned, never assumed** — a release listens on the network only with the switch on, credentials set and the Windows Firewall already allowing the port, because a listen with no rule is what makes Windows raise its "allow this app?" dialog. **Nothing this app does on its own may make Windows ask for permission**; the only dialog allowed is the UAC of the firewall button. A dev instance is always loopback, and `--host` is the one thing that skips the gate. The wide bind is still only safe because **a request from another machine gets nothing until it signs in** — those two remain one feature. → [Remote access](docs/AI_REMOTE_ACCESS.md)
- **Every state-changing request must come from our own pages** (403 otherwise). A path or a cwd never comes from the request — it comes from the index, with exactly one named exception: the folder a new session is started in, which no index could hold. → [Architecture](docs/AI_ARCHITECTURE.md)
- **Being at the machine is the root of trust**: a local request needs no password, the credentials can only be set locally, and anything that opens a window on that desktop answers 409 to anyone else. → [Remote access](docs/AI_REMOTE_ACCESS.md)
- **Session renames are local overrides**; the UI always surfaces `originalTitle` beside them. → [Architecture](docs/AI_ARCHITECTURE.md)
- **A starred message keeps its own copy of the text**, keyed on the message's canonical uuid, and starring never invalidates `['session', id]`. → [Architecture](docs/AI_ARCHITECTURE.md)
- **The reading half is ours; the Agent SDK is only used to run Claude.** → [Running Claude](docs/AI_RUNNING_CLAUDE.md)
- **Only one thing may hold a session's transcript at a time** — the composer, an embedded terminal or a real terminal window — and every door asks `core/writerGuard.ts`, never its own memory. → [Running Claude](docs/AI_RUNNING_CLAUDE.md)
- **Nothing that ends this server or changes how prompts are sent may run while the app is running Claude** — stop, restart, update, clear cache, restore userdata and the two chat settings all refuse while a CLI of ours is alive, **idle ones included**, and the 409 carries the list so the dialog can offer to close them. → [Running Claude](docs/AI_RUNNING_CLAUDE.md)
- **The embedded terminal runs `claude.exe` with no shell around it**, and the pseudo-terminal belongs to the server rather than to the tab. → [Running Claude](docs/AI_RUNNING_CLAUDE.md)
- **Everything in `~/.claude` has an expiry date** (`cleanupPeriodDays`), fixtures included. → [Transcripts](docs/AI_TRANSCRIPTS.md)
- **The installed release is never touched from here** — not its port, not its data folder, not its scheduled task. Everything this repo runs is the dev instance. → [Two instances](#two-instances-and-the-line-between-them)
- **A stop is a TRANSITION, and nothing on disk records one.** `idle` is the resting state of every open session, so the bell keeps its own memory of what each session was doing — in memory, never persisted, because a restart loses the transitions with it. → [Transcripts](docs/AI_TRANSCRIPTS.md)
- **What settings exist lives in `web/src/lib/settingsCatalog.ts`**, and adding one is three edits: the field in `AppSettings`, an entry there, the row in its area file. The rail, the search, the changed-from-default tally and the deep-link anchors all read that one list. → [The viewer](docs/AI_VIEWER.md#the-settings-page-is-a-catalogue-and-six-areas)
- **Never log with `console.*`** in new code. → [Logging](docs/AI_LOGGING.md)
- **Wrap every `JSON.parse` of a transcript line in try/catch.** Lines can be corrupt or half-written, and active files grow while being read.

## Verifying a change

There is no automated test suite: this is a personal tool and it is checked against real data. [docs/AI_TESTING.md](docs/AI_TESTING.md) holds the 47 checks, grouped by area and referenced by number from the other documents, plus the fixture survey — **the session ids used as fixtures expire**, so start there rather than trusting an id you read elsewhere.
