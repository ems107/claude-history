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
- **There are no `type:"summary"` lines** (pre-2.1 format). Titles are sidecar lines appended repeatedly over the session's life: `custom-title`, `ai-title`, `agent-name`. Always take the **last** occurrence. Title precedence: `customTitle` → `aiTitle` → `agentName` → last `last-prompt`.`lastPrompt` (pre-truncated ~200 chars) → first non-`isMeta` user message with string content → session UUID.
- Other sidecar line types: `last-prompt`, `mode`, `permission-mode`, `bridge-session`, `queue-operation`, `file-history-snapshot` (line ~2; its `snapshot.timestamp` ≈ session start), `file-history-delta`, `pr-link` (`prNumber`/`prUrl`/`prRepository`). Sidecar lines mostly have NO timestamp.
- Message lines (`user`/`assistant`/`system`/`attachment`) carry: `uuid`, `parentUuid`, `timestamp` (ISO-8601 UTC), `cwd`, `sessionId`, `version`, `gitBranch`, `slug`, `promptId` (groups a turn), `isMeta` (filter for previews!), `entrypoint` (`cli`/`claude-desktop`/`claude-vscode`), `sessionKind` (`"bg"` = background session). Assistant lines add `message.model`, `message.usage`, `effort`.
- `user` `message.content` is a **string** (a real typed prompt) or an **array** (tool_result carrier) — always distinguish.
- **~80% of files start with a timestamp-less line.** Session start = first timestamped line within head ~10 lines; last activity = last timestamped line within tail ~40 lines. File mtime is a reliable sort proxy.
- **Head-10 + tail-40 lines yield every list-view column** (title, dates, branch, model, entrypoint, slug, approx message count via `system` subtype `turn_duration`.`messageCount`, previews). Full parse is only needed for token totals, PR/ancestry badges, search text and the viewer.
- **Token usage: deduplicate assistant lines by `message.id` before summing `usage`** (streamed turns repeat the same usage object across lines). Exclude model `<synthetic>`.
- Resume ancestry: every message carries `sessionId` (file owner) and `session_id` (original producer); `distinct(session_id) − {file's UUID}` = ancestor chain (history is copied forward into the new file on resume/fork).
- Subagents: sibling dir `<sessionUuid>/subagents/agent-<17hex>.jsonl` + `agent-<17hex>.meta.json` (`agentType`, `description`, `toolUseId`, `spawnDepth`); `toolUseId` matches the parent's Task `tool_use` block. `<sessionUuid>/tool-results/*.txt` hold offloaded large tool outputs referenced in-line as "Output saved to: <abs path>".
- Global extras: `~/.claude/history.jsonl` (every typed prompt: `display`, epoch-**ms** `timestamp`, real `project` path, `sessionId`) and `~/.claude/sessions/<pid>.json` (currently-running sessions: `sessionId`, `cwd`, `status` idle/busy, `pid` — verify pid liveness with `process.kill(pid, 0)` before trusting).
- Many sessions are throwaway stubs (≤16 lines, only slash commands, no title) — flagged `isEmpty` and hidden by default.
- Wrap EVERY `JSON.parse` of transcript lines in try/catch: lines can be corrupt/partial and active files are appended while being read.

## Hard constraints

- The app **only reads** from `~/.claude` — it must never write, create, or lock anything inside it. Its own writes go exclusively to its cache dir.
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
