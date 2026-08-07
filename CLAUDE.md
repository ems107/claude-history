# CLAUDE.md

## What this project is

**claude-history** is a personal, local-only web app that browses ALL Claude Code conversations across ALL projects on this machine — a global version of the `/resume` picker with rich filtering, a full conversation viewer, full-text search, live-session badges, and "resume in terminal" actions.

It is a standalone personal tool. It is **NOT part of the PCCOM ecosystem** (no Jira, no PCCOM conventions beyond the language rule: everything in this repo is written in English).

## Commands

- Package manager: **pnpm** (workspace: `shared`, `server`, `web`).
- `pnpm install` — install all workspace deps.
- `pnpm dev` — dev mode: Fastify API on `http://127.0.0.1:7433` (tsx watch) + Vite UI on `http://localhost:5173` (proxies `/api`).
- `pnpm build` — build the web app to `web/dist`.
- `pnpm start` — production-ish mode: the Fastify server serves `web/dist` and the API on `http://localhost:7433`.
- `pnpm start:bg` / `pnpm stop` — launch detached (hidden window) / kill the port-7433 listener.
- `pnpm typecheck` — `tsc --noEmit` in all packages.
- `pnpm package -- --version X.Y.Z` — build the distributable portable zip (`scripts/package.mjs`): esbuild-bundles the server to `server.cjs` (CJS — `main.ts` must stay free of top-level await), embeds a pinned Node runtime, and assembles the versioned layout + installer scripts into `dist/`.
- `pnpm release -- --version X.Y.Z --notes-file <path>` — cut a release (`scripts/release.mjs`): state checks → typecheck → build → package → annotated tag → push → `gh release create`. `--dry-run` stops before tagging.

The server has no build step in dev: TypeScript runs via `tsx`. Shared types (`@claude-history/shared`) are consumed as TS source by both server and web.

**Releases are cut locally, not by CI** (there is no GitHub Actions workflow — it was removed deliberately: `pnpm release` is faster, debuggable, and unaffected by Actions outages). The **annotated tag message becomes the release notes** (`gh release create --notes-from-tag`), which the in-app update popup renders as markdown — never create a release tag with `git tag` without `-a`/`-F`, and always pass **`--cleanup=verbatim`**: git otherwise strips every line starting with `#`, silently deleting markdown headings from the notes.

### Writing release notes

The notes are not a changelog nobody reads: they are what the user sees in the update popup while deciding whether to install, and the popup shows **every version between theirs and the newest**, stacked. Write them accordingly.

- **Cover the whole release.** Before writing, read `git log <previous-tag>..HEAD` and account for every user-visible change. Skip pure refactors, docs and internal tooling unless they change what the user sees or does.
- **Group under `### Added` / `### Changed` / `### Fixed`**, only the sections that apply, `###` being the top level (the tag line above them is the title). Keep it to a handful of one-line bullets.
- **Lead with the user-visible effect**, then the cause only if it explains something surprising: "In-app updates now actually apply" beats "fixed helper process spawning".
- **Call out anything requiring manual action** in its own line, e.g. a version that cannot self-update and needs a manual `install.ps1` re-run.
- English, markdown, no external links needed. Bold sparingly for the one thing that matters most in each bullet.

## Architecture

- `shared/src/` — API contract: `types.ts` (domain), `api.ts` (endpoint response shapes).
- `server/src/config.ts` — data root resolution: `--data-root` flag → `CLAUDE_CONFIG_DIR` env → `~/.claude`. Cache dir: `CLAUDE_HISTORY_CACHE` env → `%LOCALAPPDATA%\claude-history\cache`. Never hardcode user paths.
- `server/src/core/` — the pipeline: `scanner` (enumerate transcript files) → `summarizer` (cheap head/tail metadata per session) → `cache` ((path,size,mtimeMs)-keyed) → `enricher` (background full parse: tokens, PR links, ancestry, search text) → `watcher` (fs.watch → SSE). `parser` builds the full conversation for the viewer on demand. `index` orchestrates everything. `updates` handles the self-update lifecycle (GitHub release check + apply).
- `installer/` — the scripts shipped inside the release zip (install/uninstall, hidden launcher, update helper). They MUST stay pure ASCII: Windows PowerShell 5.1 reads BOM-less `.ps1` as ANSI and a single multibyte character breaks parsing on target machines (`package.mjs` enforces this).
- `server/src/routes/` — REST endpoints (see `shared/src/api.ts`).
- `web/src/` — React 19 + Vite + Tailwind v4 (dark-only UI), TanStack Query for data, SSE (`EventSource`) for live invalidation.

## Claude Code data format rules (verified against CC 2.1.222)

This is the most valuable knowledge in this repo. The app reads `~/.claude`, which is an undocumented internal format — these rules were verified empirically and the code MUST follow them:

- Transcripts live in `~/.claude/projects/<encoded-dir>/<sessionUuid>.jsonl`, one JSON object per line. Lines can be huge (~27 KB); files can be several MB.
- **Encoded dir names are lossy and MUST NOT be decoded** (`\ / . _ :` all collapse to `-`; drive-letter case is preserved so one real project can split across two dirs differing only in case). The real project path comes from the `cwd` field on message lines (or `history.jsonl`'s `project`). Group projects case-insensitively.
- **Use the FIRST `cwd` of a session** (the launch directory, which is what `/resume` groups by): the `cwd` field can change mid-session when the shell cd's around, and the last one may point at a subdirectory.
- **There are no `type:"summary"` lines** (pre-2.1 format). Titles are sidecar lines appended repeatedly over the session's life: `custom-title`, `ai-title`, `agent-name`. Always take the **last** occurrence. Title precedence: `customTitle` → `aiTitle` → `agentName` → last `last-prompt`.`lastPrompt` (pre-truncated ~200 chars) → first non-`isMeta` user message with string content → session UUID.
- Other sidecar line types: `last-prompt`, `mode`, `permission-mode`, `bridge-session`, `queue-operation`, `file-history-snapshot` (line ~2; its `snapshot.timestamp` ≈ session start), `file-history-delta`, `pr-link` (`prNumber`/`prUrl`/`prRepository`). Sidecar lines mostly have NO timestamp.
- Message lines (`user`/`assistant`/`system`/`attachment`) carry: `uuid`, `parentUuid`, `timestamp` (ISO-8601 UTC), `cwd`, `sessionId`, `version`, `gitBranch`, `slug`, `promptId` (groups a turn), `isMeta` (filter for previews!), `entrypoint` (`cli`/`claude-desktop`/`claude-vscode`), `sessionKind` (`"bg"` = background session). Assistant lines add `message.model`, `message.usage`, `effort`.
- `user` `message.content` is a **string** (a real typed prompt) or an **array** (tool_result carrier) — always distinguish.
- **~80% of files start with a timestamp-less line.** Session start = first timestamped line within head ~10 lines; last activity = last timestamped line within tail ~40 lines. File mtime is a reliable sort proxy.
- **Head-10 + tail-40 lines yield every list-view column** (title, dates, branch, model, entrypoint, slug, approx message count via `system` subtype `turn_duration`.`messageCount`, previews). Full parse is only needed for token totals, PR/ancestry badges, search text and the viewer.
- **Token usage: deduplicate assistant lines by `message.id` before summing `usage`** (streamed turns repeat the same usage object across lines). Exclude model `<synthetic>`.
- Resume ancestry: every message carries `sessionId` (file owner) and `session_id` (original producer); `distinct(session_id) − {file's UUID}` = ancestor chain (history is copied forward into the new file on resume/fork).
- Subagents: sibling dir `<sessionUuid>/subagents/agent-<17hex>.jsonl` + `agent-<17hex>.meta.json` (`agentType`, `description`, `toolUseId`, `spawnDepth`); `toolUseId` matches the parent's Task `tool_use` block.
- Offloaded tool outputs: `<sessionUuid>/tool-results/*.txt`. The carrying user line has the structured field `toolUseResult.persistedOutputPath` (absolute path) — use it as the primary source; the in-text form is `<persisted-output>\nOutput too large (NN KB). Full output saved to: <abs path>` (match "output saved to:" case-insensitively). A quoted reference (e.g. inside a subagent report) can point into a DIFFERENT session's dir — keep paths projects-relative and validate on serve.
- Global extras: `~/.claude/history.jsonl` (every typed prompt: `display`, epoch-**ms** `timestamp`, real `project` path, `sessionId`) and `~/.claude/sessions/<pid>.json` (currently-running sessions: `sessionId`, `cwd`, `status` idle/busy, `pid` — verify pid liveness with `process.kill(pid, 0)` before trusting).
- Many sessions are throwaway stubs (≤16 lines, only slash commands, no title) — flagged `isEmpty` and hidden by default.
- Wrap EVERY `JSON.parse` of transcript lines in try/catch: lines can be corrupt/partial and active files are appended while being read.
- `pr-link` (and every sidecar type) is re-appended per turn — always dedupe (by `prUrl`).
- **Thinking blocks are empty in recent CC versions**: `{"type":"thinking","thinking":"","signature":"..."}` — only the signature is persisted locally. Older sessions (~2.1.200, opus) carry plaintext thinking. The UI must not assume thinking text exists.
- `entrypoint` (`cli`/`claude-desktop`/`claude-vscode`) is a per-line field; resuming in another client creates a NEW session file, so files are uniform in practice (verified: no mixed files).
- `turn_duration.messageCount` counts CONTEXT ENTRIES (tool results, streamed chunks…), not conversational messages — label it accordingly.

## Windows gotchas

- `wt.exe` (Windows Terminal) is a Store-app execution alias (reparse point) that Node `spawn` cannot launch via PATH lookup — resolve the real path with `where` or check `%LOCALAPPDATA%\Microsoft\WindowsApps` directly, and keep the classic `cmd /c start` window as fallback.
- **This machine's Terminal app is `Microsoft.IntelligentTerminal`**, which exposes aliases `wtai.exe` (windowed — accepts the classic wt CLI: `-d <dir> <command...>`) and `wtcli.exe` (a HEADLESS bridge — opens no window; never use it to launch a terminal). There is no `wt.exe`. The packaged exes under `Program Files\WindowsApps` are ACL-blocked (spawn EPERM).
- Absolute datetimes in the UI are always `dd/MM/yyyy HH:mm:ss` (local time), usually paired with a relative time.
- `process.kill(pid, 0)` throws `EPERM` for alive-but-protected processes — treat EPERM as "alive".
- `fs.watch` recursive works natively on Windows; no chokidar needed.

## Distribution & self-update (verified on this machine)

The release zip installs a portable, self-contained layout:

```
<install-root>\
├── install.ps1 / uninstall.ps1 / launch.vbs   <- stable, never touched by updates
├── install.json                               <- marker; updater uses it to detect installed mode
├── update.log
├── current  -> junction -> versions\vX.Y.Z    <- the scheduled task points THROUGH this
└── versions\vX.Y.Z\{node\node.exe, server.cjs, web\, start-hidden.vbs, update-helper.ps1}
```

`install.ps1` **relocates** the app to `%LOCALAPPDATA%\Programs\claude-history` (overridable with `-InstallTo`), so the user can extract the zip anywhere and delete it afterwards; `-Portable` skips the whole managed install and just runs the server in the console (no task, no shortcut, no `install.json` — so the updater reports `installed: false` and refuses to apply). `Program Files` is deliberately NOT supported: self-update writes into the install folder and would need elevation on every update.

The updater reads the **full releases list** (`/releases?per_page=50`, drafts and prereleases filtered out) rather than `/releases/latest`, so the popup can show every version newer than the running one with its notes; `POST /api/update/apply` takes an optional `version` and only ever accepts one newer than the running build.

Hard-won rules — the code and scripts MUST follow them:

- **Scheduled task, NOT a Windows service.** Services live in Session 0: anything they spawn (Windows Terminal, Explorer, VS Code) opens invisibly. The task (`claude-history`) runs at logon in the interactive session, so the resume/open launchers keep working.
- **`ExecutionTimeLimit` must be `PT0S`** — the Task Scheduler default silently kills tasks after 72 hours.
- **Ending the task only kills the wscript wrapper, not node** (the process tree is NOT terminated, verified). The server therefore runs with `--exit-with-parent`: it watches `process.ppid` every 3 s and exits when the parent dies. Never remove that flag from `start-hidden.vbs`.
- The task action is `wscript.exe //B <root>\current\start-hidden.vbs` — wscript is the only zero-flash way to start a console app hidden at logon; the vbs waits (`bWaitOnReturn:=True`) so node stays in the task's tree.
- Junctions (`New-Item -ItemType Junction`) need no admin; deleting one via `(Get-Item).Delete()` removes the reparse point only. The helper swaps `current` only after the old server pid is dead.
- `tar.exe` on Windows 10+ is bsdtar and extracts zip files natively, including selective paths (`tar -xf x.zip -C dest versions/vX.Y.Z`). The GitHub runner (ubuntu) side uses adm-zip instead.
- **Task Scheduler kills the task's whole process tree when the task ends** — a helper spawned by the server dies with it, `detached: true` and `.unref()` notwithstanding (verified: the update silently did nothing, no `update.log` at all). The server therefore runs `update-helper.ps1 -Register` **synchronously**, which registers and starts a one-shot `claude-history-update` task; the Task Scheduler *service* then starts the real helper outside our tree. Never go back to spawning it directly. The same trap applies to anything else that must outlive the server.
- `update-helper.ps1` always runs from a `%TEMP%` copy (never from a folder being swapped), health-checks `/api/meta` for the new version and **rolls back** to the previous junction target on failure; it prunes `versions\` to the 3 newest and unregisters its own one-shot task.
- **Port 7433 is released a few seconds AFTER the task ends** (the server's parent-watchdog polls every 3 s). Anything that restarts the app must wait for the port to be free, then verify `/api/meta` reports the expected **version** — never just that something answers `/api/health`, because the outgoing instance answers too and makes a failed start look successful (this bug made installs silently die minutes later).
- The installed server runs hidden: it writes `server.log` (console output + `uncaughtException`/`unhandledRejection`) in the install root via `--log-file`. Without it, failures leave no trace at all — the first thing to check when an installed instance misbehaves.
- Everything must be **Windows PowerShell 5.1 compatible** (target machines may lack pwsh 7): no ternaries, no `??`, `Invoke-WebRequest -UseBasicParsing`.
- Update availability: `GET api.github.com/repos/<repo>/releases/latest` with `If-None-Match` (304s are free against the 60/h unauthenticated limit). `/releases/latest` ignores prereleases and drafts. Repo overridable via `CLAUDE_HISTORY_UPDATE_REPO` for testing.

## Hard constraints

- The app **only reads** from `~/.claude` — it must never write, create, or lock anything inside it (this includes `.credentials.json`). Its own writes go exclusively to its cache dir and `userdata.json` (sibling of the cache dir; holds local title overrides, pins, the price table and the user settings).
- **Network policy.** TWO automatic calls exist, both small, both switchable off in Settings: (1) the update-availability check (`core/updates.ts`) — a conditional GET to `api.github.com/.../releases` on the configured interval, downloads nothing; (2) the subscription-usage read (`core/usage.ts`, only while the widget is enabled) — see below. Everything else is user-triggered: "Fetch current prices" (`POST /api/prices/fetch` scrapes `platform.claude.com/docs/en/about-claude/pricing.md` — there is NO pricing API; preview only, nothing persists until saved; parser fails loudly so the UI falls back to manual editing) and applying an update (`POST /api/update/apply`, only after confirmation, SHA-256 verified before staging). Never add any other automatic network call.
- **Subscription usage is READ-ONLY, and that is a hard rule.** `core/usage.ts` reads `claudeAiOauth.accessToken` from `<dataRoot>/.credentials.json` and calls `GET api.anthropic.com/api/oauth/usage` with `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20` (verified against Claude Code 2.1.223; response fields `five_hour` / `seven_day` / `seven_day_{opus,sonnet}` with `utilization` as a **0-100 percentage** and `resets_at`, plus a `limits[]` array whose `weekly_scoped` entries carry per-model percentages). NEVER refresh the token and NEVER write that file: refreshing rotates it and writes back, racing with Claude Code and potentially killing the user's real session. Expired token → report it and let the user run Claude Code. Re-read the file before every call (Claude Code rotates the token in place) and refetch at most every 5 minutes (the endpoint is rate limited, and this mirrors Claude Code's own throttle). It is an undocumented endpoint: fail soft and hide the widget rather than showing errors everywhere.
- Session renames are LOCAL overrides only. There is NO official CLI/API to rename a stored session; the only Claude-level mechanism is `/rename` from inside the session (it appends a `custom-title` sidecar line). Appending that line ourselves was evaluated and rejected: appends can race with an active session writing the same file, and the file may not end with a newline — a nonzero corruption risk. When overridden, summaries expose `originalTitle` (what Claude Code still shows) and `titleSource: 'local'`; the UI must always surface both.
- The server binds `127.0.0.1` only. Never `0.0.0.0`.
- `POST /api/sessions/:id/resume` validates the id (UUID regex + membership in the index) and takes `cwd` only from the index — never from the request.
- The tool-results endpoint accepts a bare filename and must verify the resolved path stays inside that session's `tool-results/` dir.

## Testing

No automated test suite (personal tool). Verify against real data:

1. `pnpm dev` → list shows the real sessions; case-variant project dirs merge into one project tag.
2. Open the largest session (multi-MB) → viewer renders quickly, tool blocks collapsed.
3. Search a Spanish phrase with/without accents → same hits (diacritic-insensitive).
4. Start/stop a real Claude Code session → LIVE badge appears/disappears.
5. "Resume in terminal" opens Windows Terminal in the right cwd; unknown UUIDs → 4xx.
6. Installer: `pnpm build && pnpm package -- --version 0.0.1`, extract the zip to a temp folder, run `install.ps1` (stop any dev instance first — same port), verify the task in `taskschd.msc`, `Stop-ScheduledTask` frees port 7433 within ~5 s (parent-watchdog), `launch.vbs` cold-starts it, `uninstall.ps1` removes task+shortcut and keeps `%LOCALAPPDATA%` data.
7. Update E2E needs two published releases: install the older, wait ≤10 min (or "Check now") for the badge, apply, and check `update.log` + the versions\ pruning.
