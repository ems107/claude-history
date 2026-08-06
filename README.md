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
pnpm start    # everything on http://localhost:7433
```

## Configuration

| Setting | Default | Override |
| --- | --- | --- |
| Claude data root | `~/.claude` | `--data-root <path>` or `CLAUDE_CONFIG_DIR` |
| Cache dir | `%LOCALAPPDATA%\claude-history\cache` | `CLAUDE_HISTORY_CACHE` |
| Port | `7433` | `PORT` or `--port` |

The app is read-only over `~/.claude` and binds to `127.0.0.1` only.

See `CLAUDE.md` for architecture and the verified Claude Code data-format rules.
