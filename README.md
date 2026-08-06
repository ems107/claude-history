# claude-history

A local web app to browse **all** your Claude Code conversations across **all** projects — a global `/resume` with filters, full-text search, a rich conversation viewer, live-session indicators and one-click resume.

## Quick start

```
pnpm install
pnpm dev      # UI on http://localhost:5173 (API on 127.0.0.1:7433)
```

Production-ish mode:

```
pnpm build
pnpm start    # everything on http://localhost:7433 (Ctrl+C stops it)
```

Run it detached (no terminal window):

```
pnpm start:bg   # launch hidden in the background
pnpm stop       # stop whatever is listening on port 7433
```

## Configuration

| Setting | Default | Override |
| --- | --- | --- |
| Claude data root | `~/.claude` | `--data-root <path>` or `CLAUDE_CONFIG_DIR` |
| Cache dir | `%LOCALAPPDATA%\claude-history\cache` | `CLAUDE_HISTORY_CACHE` |
| Port | `7433` | `PORT` or `--port` |

The app is read-only over `~/.claude` and binds to `127.0.0.1` only.

## Local data & state

Everything the tool persists lives under one directory (default `%LOCALAPPDATA%\claude-history`, relocatable via `CLAUDE_HISTORY_CACHE`):

```
%LOCALAPPDATA%\claude-history\
├── userdata.json            ← YOUR data (local title renames) — not regenerable
└── cache\                   ← fully regenerable; safe to delete at any time
    ├── index.json           ← list-view summaries, keyed by (path, size, mtime)
    ├── enriched\<uuid>.json ← per-session tokens, PR links, resume ancestry
    └── text\<uuid>.json     ← extracted text for full-text search
```

- `userdata.json` sits **next to** (not inside) the cache dir on purpose: wiping the cache never loses your renames. If you point `CLAUDE_HISTORY_CACHE` elsewhere, `userdata.json` is created next to that directory.
- Deleting `cache\` is always safe — the next server start rebuilds it from `~/.claude` in seconds. Entries are schema-versioned and keyed by file size+mtime, so they self-invalidate when transcripts change or the format evolves.
- Minor UI state lives in the browser, not in files: `localStorage` (thinking toggle, sidebar width) and per-tab `sessionStorage` (list filters/scroll for back-navigation). Active filters are also reflected in the URL.
- Guarantees: the tool **never writes** into `~/.claude` (read-only consumer) nor into its own repo folder; the server's index is in-memory only and is rebuilt on every start.

## Features

- Global session list across all projects with colored project tags, badges (LIVE, PR, subagents, resumed, background) and rich metadata.
- Filters (project, date, source, model, badges) and sorting, all persisted in the URL; resizable filter sidebar; list state (filters + scroll) survives navigating into a session and back.
- Full-text search over every conversation, case- and accent-insensitive, with deep-linking snippets and a scope selector (everywhere / titles / my prompts / responses).
- Conversation viewer: markdown, collapsible tool calls, optional thinking blocks (when the transcript contains visible thinking), token stats, per-session stats (prompts / responses / tool calls / turns), subagent transcripts.
- Local session rename (stored in this tool's `userdata.json` — never writes into `~/.claude`).
- Live updates via SSE — running sessions show a pulsing LIVE badge.
- Resume: copy the `claude --resume` command or open Windows Terminal/pwsh directly in the project.

## Keyboard shortcuts

- `/` focus search · `j`/`k` or arrows move selection · `Enter` open session · `Esc` back / close drawer.

See `CLAUDE.md` for architecture and the verified Claude Code data-format rules.
