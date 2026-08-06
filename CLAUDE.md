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

The server has no build step: TypeScript runs via `tsx`. Shared types (`@claude-history/shared`) are consumed as TS source by both server and web.

## Architecture

- `shared/src/` — API contract: `types.ts` (domain), `api.ts` (endpoint response shapes).
- `server/src/config.ts` — data root resolution: `--data-root` flag → `CLAUDE_CONFIG_DIR` env → `~/.claude`. Cache dir: `CLAUDE_HISTORY_CACHE` env → `%LOCALAPPDATA%\claude-history\cache`. Never hardcode user paths.
- `server/src/core/` — the pipeline: `scanner` (enumerate transcript files) → `summarizer` (cheap head/tail metadata per session) → `cache` ((path,size,mtimeMs)-keyed) → `enricher` (background full parse: tokens, PR links, ancestry, search text) → `watcher` (fs.watch → SSE). `parser` builds the full conversation for the viewer on demand. `index` orchestrates everything.
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

## Hard constraints

- The app **only reads** from `~/.claude` — it must never write, create, or lock anything inside it. Its own writes go exclusively to its cache dir and `userdata.json` (sibling of the cache dir; holds local title overrides, pins and the price table).
- The app makes **exactly one outbound network call**, and only when the user clicks "Fetch current prices": `POST /api/prices/fetch` downloads Anthropic's public pricing docs as markdown (`platform.claude.com/docs/en/about-claude/pricing.md` — there is NO pricing API; the Models API has capabilities but no prices) and parses the "Model pricing" table (`server/src/core/officialPrices.ts`). It returns a preview only — nothing persists until the user saves. Never add automatic/background network calls. The parser targets docs, not an API contract: fail loudly with a clear error so the UI falls back to manual editing.
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
