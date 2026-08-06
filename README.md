# claude-history

A local web app to browse **all** your Claude Code conversations across **all** projects — a global `/resume` with filters, full-text search, a rich conversation viewer, live-session indicators and one-click resume.

## Install (Windows, no prerequisites)

1. Download `claude-history-X.Y.Z-win-x64.zip` from the [latest release](https://github.com/ems107/claude-history/releases/latest).
2. Extract it anywhere you want the app to live (suggested: `%LOCALAPPDATA%\Programs\claude-history`).
3. From that folder run:

   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

The zip is fully self-contained (it embeds its own Node runtime) — nothing else gets installed on the machine, and no admin rights are needed. The installer:

- registers a per-user **scheduled task** named `claude-history` that starts the server (hidden, no window) every time you log into Windows;
- creates a **Start Menu shortcut** that opens `http://localhost:7433` in your browser, first starting the server if it isn't running;
- starts the server right away and opens the UI.

> The `-ExecutionPolicy Bypass` is needed because the downloaded scripts carry the Mark-of-the-Web; `install.ps1` unblocks the extracted files so this is only required once.

### Starting & stopping

The server runs as the scheduled task `claude-history`, so the standard Windows tooling applies:

| Action | GUI (Task Scheduler, `taskschd.msc`) | PowerShell |
| --- | --- | --- |
| Stop | right-click task → **End** | `Stop-ScheduledTask -TaskName claude-history` |
| Start | right-click task → **Run** (or the Start Menu shortcut) | `Start-ScheduledTask -TaskName claude-history` |
| Disable autostart | right-click task → **Disable** | `Disable-ScheduledTask -TaskName claude-history` |

Logging off stops the server with your session; the next logon starts it again automatically. Stopping it "hard" is always safe: every write the app makes is atomic.

### Updates

The server checks the GitHub releases feed on start and every 10 minutes — a tiny conditional GET (ETag) against `api.github.com`, and **the app's only automatic network call**. Nothing is ever downloaded or installed without your confirmation.

When a newer release exists, the ⟳ button in the header shows an amber dot. Clicking it opens a popup with your version, the new version and its release notes; press **Update** to apply (or **Check now** to poll on demand). The update then:

1. downloads the release zip and **verifies its SHA-256** against the release's `checksums.txt`;
2. extracts the new version into `versions\vX.Y.Z\` next to the current one;
3. restarts the server through a helper that repoints the `current` junction — with **automatic rollback** to the previous version if the new one fails to start.

The UI reloads itself when the new version is up. Every step is logged to `update.log` in the install folder; the 3 newest versions are kept in `versions\` so a manual rollback is always possible (repoint `current` or re-run `install.ps1`).

### Uninstall

```
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Removes the scheduled task and the Start Menu shortcut. Your local data (renames, pins, prices — see below) is only deleted if you confirm; the install folder itself is left for you to delete manually.

## Run from source (development)

```
pnpm install
pnpm dev      # UI on http://localhost:5173 (API on 127.0.0.1:7433)
```

Production-ish mode:

```
pnpm build
pnpm start    # everything on http://localhost:7433 (Ctrl+C stops it)
```

Run it detached (no terminal window): `pnpm start:bg` / `pnpm stop`.

Cut a release (build + tag + push + publish, all from this machine — there is no CI):

```
pnpm release -- --version X.Y.Z --notes-file notes.md
```

It refuses to run on a dirty tree, off `main`, behind `origin`, or with the tag already taken; then typechecks, builds, packages, creates the annotated tag, pushes and publishes the GitHub release with the zip and `checksums.txt` attached. The tag message becomes the release notes shown in the update popup. Add `--dry-run` to build the artifacts without tagging or publishing.

Just the zip, without releasing: `pnpm build && pnpm package -- --version X.Y.Z` (output in `dist/`).

A source instance reports version `dev` and can check for updates but not apply them (there is no installed layout to swap).

## Configuration

| Setting | Default | Override |
| --- | --- | --- |
| Claude data root | `~/.claude` | `--data-root <path>` or `CLAUDE_CONFIG_DIR` |
| Cache dir | `%LOCALAPPDATA%\claude-history\cache` | `CLAUDE_HISTORY_CACHE` |
| Port | `7433` | `PORT` or `--port` |
| Update feed repo | `ems107/claude-history` | `CLAUDE_HISTORY_UPDATE_REPO` |

The app is read-only over `~/.claude` and binds to `127.0.0.1` only.

## Local data & state

Everything the tool persists lives under one directory (default `%LOCALAPPDATA%\claude-history`, relocatable via `CLAUDE_HISTORY_CACHE`):

```
%LOCALAPPDATA%\claude-history\
├── userdata.json            ← YOUR data (local title renames, pins, prices) — not regenerable
└── cache\                   ← fully regenerable; safe to delete at any time
    ├── index.json           ← list-view summaries, keyed by (path, size, mtime)
    ├── enriched\<uuid>.json ← per-session tokens, PR links, resume ancestry
    └── text\<uuid>.json     ← extracted text for full-text search
```

- `userdata.json` sits **next to** (not inside) the cache dir on purpose: wiping the cache never loses your renames. If you point `CLAUDE_HISTORY_CACHE` elsewhere, `userdata.json` is created next to that directory.
- Deleting `cache\` is always safe — the next server start rebuilds it from `~/.claude` in seconds. Entries are schema-versioned and keyed by file size+mtime, so they self-invalidate when transcripts change or the format evolves.
- Minor UI state lives in the browser, not in files: `localStorage` (thinking toggle, sidebar width) and per-tab `sessionStorage` (list filters/scroll for back-navigation). Active filters are also reflected in the URL.
- An **installed** instance additionally keeps app files (never your data) in its install folder: `versions\` (the app versions themselves), the `current` junction, `install.json` (install marker) and `update.log`. Reinstalling or updating never touches `%LOCALAPPDATA%\claude-history`.
- Guarantees: the tool **never writes** into `~/.claude` (read-only consumer) nor into its own repo folder; the server's index is in-memory only and is rebuilt on every start.

## Features

- Global session list across all projects with colored project tags, badges (LIVE, PR, subagents, resumed, background) and rich metadata.
- Filters (project, date, source, model, badges) and sorting, all persisted in the URL; resizable filter sidebar; list state (filters + scroll) survives navigating into a session and back.
- Full-text search over every conversation, case- and accent-insensitive, with deep-linking snippets and a scope selector (everywhere / titles / my prompts / responses).
- Conversation viewer: markdown, collapsible tool calls, optional thinking blocks (when the transcript contains visible thinking), token stats, per-session stats (prompts / responses / tool calls / turns), subagent transcripts.
- Local session rename and ★ pins (stored in this tool's `userdata.json` — never writes into `~/.claude`).
- Live updates via SSE — running sessions show a pulsing LIVE badge.
- Resume: copy the `claude --resume` command or open Windows Terminal/pwsh directly in the project; open the project in Explorer or VS Code.
- Stats dashboard (`/stats`): daily activity stacked by project, model mix, per-project totals, and API-equivalent cost estimation with an editable price table (one-click fetch of the current official prices from Anthropic's public docs — user-triggered, previewed before saving).
- Prompt library (`/prompts`): every prompt ever typed, searchable, with copy and open-session actions.
- Export any conversation to Markdown (tool calls / thinking / system optional).
- Resume lineage view and a per-session file-changes viewer (which files each session edited, with before/after diffs).
- Self-update from GitHub releases: automatic availability check (10 min), explicit-confirmation install with checksum verification and automatic rollback.

## Keyboard shortcuts

- `/` focus search · `j`/`k` or arrows move selection · `Enter` open session · `Esc` back / close drawer.

See `CLAUDE.md` for architecture and the verified Claude Code data-format rules.
