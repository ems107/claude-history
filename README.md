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

The server checks the GitHub releases feed on start and every 10 minutes — a tiny conditional GET (ETag) against `api.github.com`, and one of the app's **only two automatic network calls** (the other is the subscription-usage read; both switchable off in Settings). Nothing is ever downloaded or installed without your confirmation.

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

## Use it from another machine

Off by default, and turning it on is deliberate in **Settings → Remote access**: set a username and password — only possible while you are at this machine — and then tick *Let other machines on this network use claude-history*. The switch cannot be turned on before the credentials exist.

Turning the switch on does not open anything by itself, and that is on purpose. Windows asks "do you want to allow this app to access your networks?" the moment a program listens on the network without a firewall rule permitting it — every update, because the rule Windows writes is tied to a path that changes with each version. So **the server listens on the network only once Windows already allows it**, and never asks you anything on its own: installing, updating and starting at logon are silent, always.

That makes remote access three steps in the panel instead of one. The credentials, then **Open the port** — the one moment Windows asks for administrator approval, once, on this machine — and then **Restart the server**, because where a server listens is settled when it starts. The rule covers the `Private` profile, so a LAN address and a WireGuard/VPN tunnel alike while `Public` stays shut, and it is a *port* rule with no program in it, which is what makes one approval enough for every future version. The panel says which of the three steps is missing, lists this machine's own addresses once it is actually listening — `http://<address>:7433` — and offers to clean up the blocking rules Windows leaves behind if that dialog was ever answered with Cancel, since those override the rule and would otherwise leave an open port with nothing coming through.

What guards the port is not the bind but the session check: **a request from anywhere other than this machine gets nothing until it signs in** — not the session list, not the version, not the paths in Settings. A request from this machine never asks for a password, exactly as before.

A few things are refused over the network rather than half-done. The greyed-out button and the 409 behind it give the same reason, because they read it from the same place:

| Refused when remote | Why |
| --- | --- |
| Explorer, VS Code, a terminal, the firewall buttons | they would open a window on a screen nobody is looking at |
| Stopping the server, restarting it, uninstalling | they cut the very connection they arrived through — and a restart can come back listening on that machine alone |
| Setting the username and password | standing at the machine *is* the recovery path for forgetting them |

Applying an update is deliberately **allowed** from another machine: it restarts and comes back on its own.

**Sign out** ends this device's session. **Sign out everywhere** replaces the signing key, so every signed-in device — including the one that clicked it — has to sign in again; that is the button for a phone you no longer have.

> There is no HTTPS, so the password crosses the network in clear: this is for a home LAN or a VPN tunnel and for nothing else. And restoring a `userdata.json` backup replaces the credentials and this switch along with everything else, so a copy taken before this feature existed switches remote access off and signs every device out.

The trust model the whole thing rests on is written down in [`docs/AI_REMOTE_ACCESS.md`](docs/AI_REMOTE_ACCESS.md).

## Run from source (development)

Everything you run from the source tree is a **dev instance**: port `7434` and its own data folder, `%LOCALAPPDATA%\claude-history-dev`. Your installed release keeps port `7433` and `%LOCALAPPDATA%\claude-history` and is never stopped, rebuilt or read from — so it stays up, working, and usable while you develop.

```
pnpm install
.\dev.ps1     # build if needed, start detached on http://127.0.0.1:7434, open it
```

`-Build` rebuilds the web app first, `-Restart` replaces a running dev instance, `-Stop` stops it, `-Foreground` runs it in the window, `-Seed` copies your release's `userdata.json` and cache into the dev folder on first run (one way — nothing is ever copied back), `-Port` picks another port (7433 is refused).

By hand, if you prefer:

```
pnpm dev      # UI on http://localhost:5173 with HMR (API on 127.0.0.1:7434)
pnpm build && pnpm start    # everything on http://127.0.0.1:7434 (Ctrl+C stops it)
```

`pnpm start:bg` / `pnpm stop` are the detached pair, and `pnpm stop` only ever kills the dev port.

The dev instance starts with the automatic update check and the interval usage read **off**: neither belongs to a second instance running beside the release (updates cannot be applied from source, and usage reads rate-limit per account). Both are ordinary settings you can switch on.

Remote access cannot be tried from a dev instance — it binds `127.0.0.1`, so there is no remote request to make against it. `.\preview.ps1` is a third instance for exactly that: port `7435`, its own data folder `%LOCALAPPDATA%\claude-history-preview`, and no `--dev-instance`, so it decides its bind exactly as a release does — loopback until its own firewall rule exists. Same flags as `dev.ps1`, and it refuses to go near 7433 or 7434. Its first run writes a `userdata.json` with the update poll, the usage read and the auto-reload off — a safety measure rather than a preference, since a usage 429 is earned per *account* and would blank the real release's widget.

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
| Dev instance (port `7434`, data in `…\claude-history-dev`) | off | `--dev-instance` or `CLAUDE_HISTORY_DEV=1` |
| Update feed repo | `ems107/claude-history` | `CLAUDE_HISTORY_UPDATE_REPO` |

The app is read-only over `~/.claude`. An installed release listens on **every** interface and a dev instance on `127.0.0.1` only — the wide bind is safe because nothing answers a non-local request until it signs in (see [Use it from another machine](#use-it-from-another-machine)).

## Local data & state

Everything the tool persists lives under one directory (default `%LOCALAPPDATA%\claude-history`, relocatable via `CLAUDE_HISTORY_CACHE`):

```
%LOCALAPPDATA%\claude-history\
├── userdata.json            ← YOUR data (renames, pins, stars, prices, settings, credentials) — not regenerable
├── backups\                 ← dated copies of userdata.json; restore one from Settings
├── logs\YYYY-MM-DD.log      ← one JSONL file per day; read them in Settings → log viewer
└── cache\                   ← fully regenerable; safe to delete at any time
    ├── index.json           ← list-view summaries, keyed by (path, size, mtime)
    ├── enriched\<uuid>.json ← per-session tokens, subagent spend, plans, PR links, ancestry
    └── text\<uuid>.json     ← extracted text for full-text search
```

- `userdata.json` sits **next to** (not inside) the cache dir on purpose: wiping the cache never loses your renames. If you point `CLAUDE_HISTORY_CACHE` elsewhere, `userdata.json` is created next to that directory.
- `userdata.json` is the one file this app cannot regenerate, so it is defended three ways. Writes are **queued one at a time per file** (several windows starring and pinning at once could otherwise interleave into a document nothing can parse); a file that is present but broken is **quarantined** as `userdata.json.corrupt-<stamp>` and reported, instead of loading as the defaults and being overwritten by the next write; and `backups\` beside it keeps **dated copies** — the first write of each day, the first start under a new version, before an update is applied, before a write that would empty renames/pins/stars, before a restore, and whenever you ask (14 days, a total-size ceiling, and the newest copy never pruned).
- **Settings → *Your data, and how to get it back*** lists every copy with its clock, why it was taken and what restoring it would bring back ("3 renames · 5 pins · 12 stars · own prices"), and puts one back in place — no restart, every open window updated, and a `pre-restore` copy taken first so a wrong pick is undoable. A start-up that finds the file broken restores the newest copy that parses by itself and says so in a banner. A restore replaces *everything* in the file, remote-access credentials included.
- Deleting `cache\` is always safe — the next server start rebuilds it from `~/.claude` in seconds. Entries are schema-versioned and keyed by file size+mtime, so they self-invalidate when transcripts change or the format evolves.
- A **dev instance** (`--dev-instance`) keeps the same layout under `%LOCALAPPDATA%\claude-history-dev` instead: separate cache, `userdata.json`, backups and logs, so developing can neither disturb nor lose what the installed release holds. The only thing the two share is `~/.claude`, which both merely read.
- `logs\` holds one file per day, written by every way of running the app (installed, from source, portable) so the trail is never split across builds. Files older than the retention window (14 days by default) are deleted automatically, and **Settings → Logs** sets the level written and opens the viewer: filter by day, level and subsystem, search the text, and read the installer's `update.log` from the same screen.
- Minor UI state lives in the browser, not in files: `localStorage` (thinking toggle, sidebar width) and per-tab `sessionStorage` (list filters/scroll for back-navigation, and which message you had selected in a conversation). Active filters are also reflected in the URL.
- An **installed** instance additionally keeps app files (never your data) in its install folder: `versions\` (the app versions themselves), the `current` junction, `install.json` (install marker) and `update.log`. Reinstalling or updating never touches `%LOCALAPPDATA%\claude-history`.
- Guarantees: the tool **never writes** into `~/.claude` (read-only consumer) nor into its own repo folder; the server's index is in-memory only and is rebuilt on every start.

## Features

- Global session list across all projects with colored project tags, badges (LIVE, PR, subagents, resumed, background) and rich metadata.
- Filters (project, date, source, model, badges) and sorting, all persisted in the URL; resizable filter sidebar; list state (filters + scroll) survives navigating into a session and back.
- Full-text search over every conversation, case- and accent-insensitive, with deep-linking snippets and a scope selector (everywhere / titles / my prompts / responses). Plans are indexed too, and pasting a session or subagent id — whole, or just the few characters the app prints everywhere — finds what it names.
- **A session's own recap is a first-class thing**: the paragraph Claude Code writes at the end of a turn for whoever comes back later is labelled a *recap* rather than by its raw `AWAY_SUMMARY` identifier, drawn whole instead of cut off mid-sentence, and indexed — so a search finds it and lands on it, and the label's tooltip says when one does and does not get written.
- **A tool call says what it was for**: the one-line description the model writes for every Bash/PowerShell call leads the collapsed header, above the command itself — and it is exported and indexed too, so a command is findable by its purpose and not only by its text.
- **Find inside one conversation** (`Ctrl+F`, or `Ctrl+Shift+F` to open on the whole of it): it searches the conversation the page holds — tool output, thinking, compacted stretches and rewound branches included, i.e. everything folded away that the browser's own find cannot see — and Enter travels to a match by unfolding its way in. Choose the scope (the message you have selected / what is unfolded / all of it), narrow it with per-kind chips that count what they would remove before you remove it (prompts, answers, thinking, tools, plans, notices, system), or read the matches as a list where each row carries who wrote it and when. Every match stays marked while the bar is open, with the current one picked out.
- **A selected message stays selected**: click any message or tool call and it keeps its ring — while you read, after a reload, and when a deep link from search, Prompts or Starred lands you on it — and that is what `Ctrl+F` then offers to search inside.
- Conversation viewer: markdown, collapsible tool calls, optional thinking blocks (when the transcript contains visible thinking), token stats, per-session stats (prompts / responses / tool calls / turns), subagent transcripts.
- The turns that are decisions read as decisions rather than as tool calls: a **plan** is a card with its own heading, its verdict and — when it was refused — what you asked for instead; an **answered question** shows every option Claude offered with the one that was taken, the drawing that came with each and the note you wrote beside your pick; a **prompt typed while Claude was working** sits inside the turn it interrupted instead of being lost.
- **Subagents panel** (the ⑂ badge, or `?agents=1`): every agent a session sent out, nested under the one that spawned it, with when it left and came back, how long it ran, its messages, tool calls and cost, whether it failed, the brief it was given, the report it filed, and jumps straight to the call and to the report.
- Cost and context: a price pill on every message and a context curve, and **a session's cost now includes what its subagents spent** (the split is in the tooltip). Prompts that had to **re-cache context they already held** — an expired cache is re-sent at 2× input instead of read at 0.1× — are flagged in amber per message, totalled per session and priced across the whole corpus in Stats.
- **File viewer**: any local file a transcript names — in prose, on a Read/Edit/Write header, in the files-touched list — opens in a panel with syntax highlighting and the line it pointed at marked, and can be opened in your editor or revealed in Explorer. Read-only, and resolved against the session's own project folder. **Images are drawn as pictures** (click for full size) instead of the old "binary file — not shown"; SVG is shown as the XML it is.
- **Files Claude handed you** (`SendUserFile`) are lifted out of the tool run and drawn where the delivery happened, as a card naming each file with its size and where it came from — a click opens the picture, or the file in your editor. The transcript keeps no bytes, so a file already swept from disk says so instead of pretending.
- **Mentioned**: the third file question — what a session only *talked* about. The paths its answers named, each with the spelling it was written in, a click that opens the file and a jump that lands on the sentence **with the path underlined in it**, exactly as a search result does. The jump also leaves the find bar open on the filename, scope *All*, so Enter steps through every other naming — and `×N` says in how many messages the answers named it. A path that finds nothing is still listed, marked `not found` — most of what an answer names is written for a person to read, a partial path or a placeholder, and that is worth seeing rather than hiding — and the panel counts those out loud underneath.
- **Sent Files**: the whole session's worth of that in one panel, beside *Changed Files* (which is the other question — what the session edited). Everything it handed over: delivered with `SendUserFile`, published as an artifact, or written as a plan under `~/.claude/plans`. Each row says what it was when it left (type, size, the caption it came with) and **what is there now** — still on disk, changed since, or swept away — and jumps to the moment it happened.
- **Continue a conversation from the app** (experimental, off by default — Settings → *Send prompts from the app*): a composer at the foot of every session sends a prompt to Claude Code and streams the answer into the viewer. It picks the model, the effort and plan mode, puts Claude's questions to you with their drawings, notes and free text, and lets you approve a plan or send it back with a note. The conversation now runs to the foot of the window with the composer riding inside it, so nothing is left hidden behind the box when it grows.
- **Reading a turn while it happens**: the working bubble times it three ways — how long the turn has run, how long since the last message landed and since the last tool was called, which together tell a slow tool from a stuck turn — and the follow pill at the bottom keeps the view on the end, spins while a turn is in flight, and badges how many messages have arrived since you let go of it.
- Local session rename and ★ pins (stored in this tool's `userdata.json` — never writes into `~/.claude`).
- **Starred messages** (`/starred`): star any prompt of yours or any answer of Claude's from the ★ in its corner, and find them all on one page — searchable, filterable by project and by who spoke, ordered by the message's own date and groupable by session, each with a link that lands on the message inside its conversation. The star keeps its own copy of the text, so a starred message survives the transcript being swept.
- **Your data has a way back**: `userdata.json` — the renames, pins, stars, prices and settings, the only thing here that cannot be rebuilt from `~/.claude` — is written one writer at a time, kept rather than silently replaced when it is found broken, and copied into `backups\` at every point where it could be lost. Settings lists every copy in words and puts one back in place, no restart.
- Live updates via SSE — running sessions show a pulsing LIVE badge.
- Resume: copy the `claude --resume` command or open Windows Terminal/pwsh directly in the project; open the project in Explorer or VS Code. A session that already has a writer — a terminal, or the composer — reads *Already open* and the launch is refused, because two writers corrupt a transcript; copying the command stays available, so doing it anyway is possible but deliberate.
- **Reachable from another machine** (off by default): sign in from a phone or a laptop on your network and everything reads, searches, exports and even composes as it does here, while whatever would open a window on this desktop is refused instead of quietly doing nothing. See [Use it from another machine](#use-it-from-another-machine).
- Subscription usage in the header: the 5-hour and weekly windows, the same figures Claude Code's `/usage` shows, read from your stored session (read-only — the token is never refreshed or modified) and refreshed at most every 5 minutes. Switchable off in Settings.
- Settings page (`/settings`): update checking (on/off and interval), the usage widget, the composer, [remote access](#use-it-from-another-machine) with its firewall rule, the backups of your data, the log level and retention, the resolved data paths, clear-cache, open-data-folder and stop-server. Saving settings or prices reaches every other open window at once, so no window goes on running the previous ones.
- Grouping headers in the list (by day or by project) and collapsed tool-call groups in the conversation viewer, so long sessions read as prompts and answers.
- Stats dashboard (`/stats`): daily activity stacked by project, model mix, per-project totals, API-equivalent cost estimation with an editable price table (one-click fetch of the current official prices from Anthropic's public docs — user-triggered, previewed before saving), and what re-caching cost across the corpus.
- Prompt library (`/prompts`): every prompt ever typed, searchable, with copy and open-session actions.
- Plans page (`/plans`): every plan ever submitted, newest first, with its outcome, what you said when you refused one, whether the file it left in `~/.claude/plans` is still that plan, and a link that opens it where it was written. Same ordering controls as the Starred page: oldest-first, or grouped by the session that submitted them.
- Export any conversation to Markdown (tool calls / thinking / system optional); plans, answered questions and delivered files export as the prose they are, not as JSON.
- Resume lineage view and a per-session file-changes viewer (which files each session edited, with before/after diffs).
- Self-update from GitHub releases: automatic availability check (10 min), explicit-confirmation install with checksum verification and automatic rollback.

## Keyboard shortcuts

- In the list: `/` focus search · `j`/`k` or arrows move selection · `Enter` open session · `Esc` back / close drawer.
- In a conversation: `Ctrl+F` find in it (`Ctrl+Shift+F` searches all of it) · `Enter` / `Shift+Enter` next / previous match, wrapping · `Esc` closes whatever panel is on top, then the find bar.

See `CLAUDE.md` for the developer documentation index — architecture, the verified Claude Code data-format rules and how each part is checked all live under `docs/`.
