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

## Features

- Global session list across all projects with colored project tags, badges (LIVE, PR, subagents, resumed, background) and rich metadata.
- Filters (project, date, source, model, badges) and sorting, all persisted in the URL.
- Full-text search over every conversation, case- and accent-insensitive, with deep-linking snippets.
- Conversation viewer: markdown, collapsible tool calls, optional thinking blocks, token stats, subagent transcripts.
- Live updates via SSE — running sessions show a pulsing LIVE badge.
- Resume: copy the `claude --resume` command or open a terminal directly in the project.

## Keyboard shortcuts

- `/` focus search · `j`/`k` or arrows move selection · `Enter` open session · `Esc` back / close drawer.

See `CLAUDE.md` for architecture and the verified Claude Code data-format rules.
