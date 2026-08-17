# claude-history

A local web app to browse **all** your Claude Code conversations across **all** projects — a global `/resume` with filters, full-text search, a rich conversation viewer, live-session indicators and one-click resume.

## Install (Windows, no prerequisites)

1. Download `claude-history-X.Y.Z-win-x64.zip` from the [latest release](https://github.com/ems107/claude-history/releases/latest).
2. Extract it anywhere (Downloads is fine — it does not stay there).
3. From that folder run:

   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

The zip is fully self-contained (it embeds its own Node runtime) — nothing else gets installed on the machine, and no admin rights are needed. The installer:

- copies the app to **`%LOCALAPPDATA%\Programs\claude-history`** (the standard per-user location; you can delete the extracted folder afterwards);
- registers a per-user **scheduled task** named `claude-history` that starts the server (hidden, no window) every time you log into Windows;
- creates a **Start Menu shortcut** that opens `http://localhost:7433` in your browser, first starting the server if it isn't running;
- starts the server right away and opens the UI.

Options: `-InstallTo <path>` installs somewhere else (it must be writable without admin — `Program Files` is a bad fit because self-updates write into the install folder), and `-Portable` installs nothing at all: no copy, no task, no shortcut — it just runs the server in that console window until you press Ctrl+C (in-app updates are disabled in this mode).

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

When newer releases exist, the upgrade button in the header shows how many. Clicking it opens a popup listing **every version newer than yours**, newest first, each with its release notes — so you see the whole set of changes, not just the last one — and you pick which to install (the newest is preselected). Press **Update** to apply, or **Check now** to poll on demand. The update then:

1. downloads the release zip and **verifies its SHA-256** against the release's `checksums.txt`;
2. extracts the new version into `versions\vX.Y.Z\` next to the current one;
3. restarts the server through a helper that repoints the `current` junction — with **automatic rollback** to the previous version if the new one fails to start.

The UI reloads itself when the new version is up (the whole swap takes a few seconds). Every step is logged to `update.log` in the install folder, which you can read from **Settings → Open the log viewer → update.log**; the 3 newest versions are kept in `versions\` so a manual rollback is always possible (repoint `current` or re-run `install.ps1`).

> Instances **1.2.3 and older cannot update themselves** — the fix has to be in the running version. Download the latest zip and re-run `install.ps1` once; from 1.2.5 on the button handles it.

### Uninstall

```
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Removes the scheduled task and the Start Menu shortcut. Your local data (renames, pins, starred messages, prices — see below) is only deleted if you confirm; the install folder itself is left for you to delete manually.

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
├── userdata.json            ← YOUR data (renames, pins, starred messages, prices, settings) — not regenerable
├── logs\YYYY-MM-DD.log      ← one JSONL file per day; read them in Settings → log viewer
└── cache\                   ← fully regenerable; safe to delete at any time
    ├── index.json           ← list-view summaries, keyed by (path, size, mtime)
    ├── enriched\<uuid>.json ← per-session tokens, subagent spend, plans, PR links, ancestry
    └── text\<uuid>.json     ← extracted text for full-text search
```

- `userdata.json` sits **next to** (not inside) the cache dir on purpose: wiping the cache never loses your renames. If you point `CLAUDE_HISTORY_CACHE` elsewhere, `userdata.json` is created next to that directory.
- Deleting `cache\` is always safe — the next server start rebuilds it from `~/.claude` in seconds. Entries are schema-versioned and keyed by file size+mtime, so they self-invalidate when transcripts change or the format evolves.
- `logs\` holds one file per day, written by every way of running the app (installed, from source, portable) so the trail is never split across builds. Files older than the retention window (14 days by default) are deleted automatically, and **Settings → Logs** sets the level written and opens the viewer: filter by day, level and subsystem, search the text, and read the installer's `update.log` from the same screen.
- Minor UI state lives in the browser, not in files: `localStorage` (thinking toggle, sidebar width) and per-tab `sessionStorage` (list filters/scroll for back-navigation). Active filters are also reflected in the URL.
- An **installed** instance additionally keeps app files (never your data) in its install folder: `versions\` (the app versions themselves), the `current` junction, `install.json` (install marker) and `update.log`. Reinstalling or updating never touches `%LOCALAPPDATA%\claude-history`.
- Guarantees: the tool **never writes** into `~/.claude` (read-only consumer) nor into its own repo folder; the server's index is in-memory only and is rebuilt on every start.

## Features

- Global session list across all projects with colored project tags, badges (LIVE, PR, subagents, resumed, background) and rich metadata.
- Filters (project, date, source, model, badges) and sorting, all persisted in the URL; resizable filter sidebar; list state (filters + scroll) survives navigating into a session and back.
- Full-text search over every conversation, case- and accent-insensitive, with deep-linking snippets and a scope selector (everywhere / titles / my prompts / responses). Plans are indexed too, and pasting a session or subagent id — whole, or just the few characters the app prints everywhere — finds what it names.
- Conversation viewer: markdown, collapsible tool calls, optional thinking blocks (when the transcript contains visible thinking), token stats, per-session stats (prompts / responses / tool calls / turns), subagent transcripts.
- The turns that are decisions read as decisions rather than as tool calls: a **plan** is a card with its own heading, its verdict and — when it was refused — what you asked for instead; an **answered question** shows every option Claude offered with the one that was taken, the drawing that came with each and the note you wrote beside your pick; a **prompt typed while Claude was working** sits inside the turn it interrupted instead of being lost.
- **Subagents panel** (the ⑂ badge, or `?agents=1`): every agent a session sent out, nested under the one that spawned it, with when it left and came back, how long it ran, its messages, tool calls and cost, whether it failed, the brief it was given, the report it filed, and jumps straight to the call and to the report.
- Cost and context: a price pill on every message and a context curve, and **a session's cost now includes what its subagents spent** (the split is in the tooltip). Prompts that had to **re-cache context they already held** — an expired cache is re-sent at 2× input instead of read at 0.1× — are flagged in amber per message, totalled per session and priced across the whole corpus in Stats.
- **File viewer**: any local file a transcript names — in prose, on a Read/Edit/Write header, in the files-touched list — opens in a panel with syntax highlighting and the line it pointed at marked, and can be opened in your editor or revealed in Explorer. Read-only, and resolved against the session's own project folder.
- **Continue a conversation from the app** (experimental, off by default — Settings → *Send prompts from the app*): a composer at the foot of every session sends a prompt to Claude Code and streams the answer into the viewer. It picks the model, the effort and plan mode, puts Claude's questions to you with their drawings, notes and free text, and lets you approve a plan or send it back with a note.
- Local session rename and ★ pins (stored in this tool's `userdata.json` — never writes into `~/.claude`).
- **Starred messages** (`/starred`): star any prompt of yours or any answer of Claude's from the ★ in its corner, and find them all on one page — searchable, filterable by project and by who spoke, ordered by the message's own date and groupable by session, each with a link that lands on the message inside its conversation. The star keeps its own copy of the text, so a starred message survives the transcript being swept.
- Live updates via SSE — running sessions show a pulsing LIVE badge.
- Resume: copy the `claude --resume` command or open Windows Terminal/pwsh directly in the project; open the project in Explorer or VS Code.
- Subscription usage in the header: the 5-hour and weekly windows, the same figures Claude Code's `/usage` shows, read from your stored session (read-only — the token is never refreshed or modified) and refreshed at most every 5 minutes. Switchable off in Settings.
- Settings page (`/settings`): update checking (on/off and interval), the usage widget, the composer, the resolved data paths, clear-cache, open-data-folder and stop-server.
- Grouping headers in the list (by day or by project) and collapsed tool-call groups in the conversation viewer, so long sessions read as prompts and answers.
- Stats dashboard (`/stats`): daily activity stacked by project, model mix, per-project totals, API-equivalent cost estimation with an editable price table (one-click fetch of the current official prices from Anthropic's public docs — user-triggered, previewed before saving), and what re-caching cost across the corpus.
- Prompt library (`/prompts`): every prompt ever typed, searchable, with copy and open-session actions.
- Plans page (`/plans`): every plan ever submitted, newest first, with its outcome, what you said when you refused one, whether the file it left in `~/.claude/plans` is still that plan, and a link that opens it where it was written. Same ordering controls as the Starred page: oldest-first, or grouped by the session that submitted them.
- Export any conversation to Markdown (tool calls / thinking / system optional); plans and answered questions export as the prose they are, not as JSON.
- Resume lineage view and a per-session file-changes viewer (which files each session edited, with before/after diffs).
- Self-update from GitHub releases: automatic availability check (10 min), explicit-confirmation install with checksum verification and automatic rollback.

## Keyboard shortcuts

- `/` focus search · `j`/`k` or arrows move selection · `Enter` open session · `Esc` back / close drawer.

See `CLAUDE.md` for the developer documentation index — architecture, the verified Claude Code data-format rules and how each part is checked all live under `docs/`.
