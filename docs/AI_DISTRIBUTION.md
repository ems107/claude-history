# Packaging, installing, self-update and releases

**Load this when:** you touch `scripts/package.mjs`, `scripts/release.mjs`, anything in `installer/`, `core/updates.ts` / `core/updateLogImport.ts` — or the user asks for a release.

Everything here was verified on this machine. The user-facing half (what the installer does, how to start/stop it, what an update looks like) is in [README.md](../README.md) and is not repeated.

## Invariants

- **NEVER cut a release on your own initiative.**
- **A local build is always version `dev`** — never hand a real version number to `pnpm package`.
- **Nothing here is how you develop.** Packaging and installing exist to verify the shipped artifact, not to run your changes: that is the [dev instance](../CLAUDE.md#two-instances-and-the-line-between-them) on 7434, which installs nothing. Installing over the user's release replaces the copy that always works — only do it when the installer itself is what is being tested, and say so first.
- **Scheduled task, never a Windows service.**
- **Installer scripts stay pure ASCII and Windows PowerShell 5.1 compatible.**
- **Anything that must outlive the server has to be started by the Task Scheduler, not spawned by us.**
- **After restarting the app, verify `/api/meta` reports the expected VERSION** — not just that something answers.
- **The client never declares an update failed on a deadline of its own.**

## Building the zip

`pnpm package` (`scripts/package.mjs`) esbuild-bundles the server to `server.cjs` — CJS, so **`main.ts` must stay free of top-level await** — embeds a pinned Node runtime, and assembles the versioned layout plus the installer scripts into `dist/`. It also carries the `import.meta.url` shim the Agent SDK needs ([AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md)).

### The one thing that cannot go in the bundle

A compiled `.node` binary is not JavaScript, so the embedded terminal's pseudo-console is `external` in the esbuild call and copied beside `server.cjs` instead — **`versions/v<version>/node_modules/@lydell/node-pty*`, which is the only `node_modules` a release carries**. **`prebuilds/win32-x64/conpty/` inside it is load-bearing, not ballast**: `conpty.dll` and `OpenConsole.exe` are the pseudo-console the app actually runs (`useConptyDll: true`, [AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md)), because the one in Windows differs on every build and cost four bugs on a Windows 10 machine. Drop them and every terminal falls back to the machine's own. Per version, so an update brings its own and two versions never share one; the updater extracts `versions/` whole, so nothing in `update-helper.ps1` had to learn about it.

- **Finding the packages is the fiddly half.** `require.resolve` answers with an entry point, and these export only `./lib/index.js`, so neither its dirname nor `resolve('<pkg>/package.json')` is the package directory — `packageDirOf` walks up until a manifest says its own name. pnpm links rather than copies, so `dereference: true` is not optional.
- **The `.pdb` files are dropped.** They are debug symbols for a debugger nobody here is running, and they are 10.6 of the package's 12 MB. What is left costs the zip 0.9 MB.
- **The prebuild is N-API**, so bumping `NODE_VERSION` does not invalidate it — which is the whole reason that fork was chosen over building from source. Verify it against the PINNED runtime rather than the machine's: from the staged layout, `versions/v<version>/node/node.exe` must resolve `@lydell/node-pty` and spawn a console.

**A local build is always version `dev`** (folder `versions/vdev`); only `release.mjs` passes `--release --version X.Y.Z`. Never hand a real version number to a local build: an install reporting `1.3.1` would treat the actual 1.3.1 release as already installed and never offer it. A `dev` install is still a managed install (updates apply) and is offered every published release, since `dev` has no place in the version order.

## The installed layout

```
<install-root>\
├── install.ps1 / uninstall.ps1 / launch.vbs   <- stable, never touched by updates
├── install.json                               <- marker; the updater detects installed mode by it
├── update.log
├── current  -> junction -> versions\vX.Y.Z    <- the scheduled task points THROUGH this
└── versions\vX.Y.Z\{node\node.exe, server.cjs, node_modules\, web\, start-hidden.vbs, update-helper.ps1}
```

`install.ps1` **relocates** the app to `%LOCALAPPDATA%\Programs\claude-history` (overridable with `-InstallTo`), so the user can extract the zip anywhere and delete it afterwards. `-Portable` skips the managed install entirely and just runs the server in the console — no task, no shortcut, no `install.json`, so the updater reports `installed: false` and refuses to apply. A **dev instance is not an install either** and is detected the same way: `detectInstall()` resolves from the running entry path, so a source run can never find — let alone swap — the release's `current` junction, whatever port it is on. **`Program Files` is deliberately NOT supported**: self-update writes into the install folder and would need elevation on every update.

### Scheduled-task rules

- **A scheduled task, NOT a Windows service.** Services live in Session 0: anything they spawn (Windows Terminal, Explorer, VS Code) opens invisibly. The task (`claude-history`) runs at logon in the interactive session, so the resume/open launchers keep working.
- **`ExecutionTimeLimit` must be `PT0S`** — the Task Scheduler default silently kills tasks after 72 hours.
- **Every task we register needs `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`**, including the one-shot update and uninstall helpers. Without it a laptop on battery leaves the task `Queued` forever — it does not fail, it just never runs, and then fires unexpectedly when the machine is plugged in (this exact bug swallowed an uninstall).
- The action is `wscript.exe //B <root>\current\start-hidden.vbs` — wscript is the only zero-flash way to start a console app hidden at logon, and the vbs waits (`bWaitOnReturn:=True`) so node stays in the task's tree.
- **The Start Menu shortcut wears the app's own icon, and there is only one copy of it.** `IconLocation` is `<root>\current\web\favicon.ico` — the same file the browser tab uses, because `web/public/` is copied into `web/dist` and staged as `versions/vX.Y.Z/web/`. Two things follow: the path goes THROUGH the junction, so an update swaps the icon without rewriting the `.lnk`; and a drawing is never duplicated between the frontend and the installer. It used to point at `node\node.exe,0`, which is why every install until now had Node's logo in the Start Menu.
- **Ending the task only kills the wscript wrapper, not node** (the process tree is NOT terminated, verified). The server therefore runs with `--exit-with-parent`: it watches `process.ppid` every 3 s and exits when the parent dies. **Never remove that flag** from `start-hidden.vbs`.
- **Port 7433 is released a few seconds AFTER the task ends** (that watchdog polls every 3 s). Anything that restarts the app must wait for the port to be free, then verify `/api/meta` reports the expected **version** — never just that something answers `/api/health`, because the outgoing instance answers too and makes a failed start look successful. That bug made installs silently die minutes later.
- Junctions (`New-Item -ItemType Junction`) need no admin; deleting one via `(Get-Item).Delete()` removes the reparse point only. The helper swaps `current` only after the old server pid is dead.

### Installer scripts

- **They MUST stay pure ASCII.** Windows PowerShell 5.1 reads a BOM-less `.ps1` as ANSI, and a single multibyte character breaks parsing on target machines (`package.mjs` enforces this).
- **That rule is about the SOURCE, never about what they write.** The logs they produce are BOM-less UTF-8, written with `[System.IO.File]::AppendAllText` and a `UTF8Encoding($false)`, because neither `Add-Content` encoding will do: `-Encoding ASCII` turns every non-ASCII character into a literal `?` (on an install under `C:\Users\JavierAñón\` that is the root, the junction targets, the script path and the user name, i.e. nearly every line), and 5.1's `-Encoding UTF8` opens the file with a BOM that the importer would read as part of the first record. Both verified byte by byte.
- **Everything must be Windows PowerShell 5.1 compatible** (target machines may lack pwsh 7): no ternaries, no `??`, `Invoke-WebRequest -UseBasicParsing`.

## Self-update

**Availability check**: `GET api.github.com/repos/<repo>/releases?per_page=50` with `If-None-Match`, so unchanged answers are free 304s against the 60/h unauthenticated limit. The **full list** rather than `/releases/latest`, so the popup can show every version newer than the running one with its notes; drafts and prereleases are filtered out. Repo overridable via `CLAUDE_HISTORY_UPDATE_REPO` for testing. `POST /api/update/apply` takes an optional `version` and only ever accepts one newer than the running build.

**Applying is fire-and-forget and the SERVER owns the truth about it.** The POST answers as soon as the release is validated and the work continues in the background; the UI follows `state`, `progress`, `applyingVersion` and `lastApplyError` on `GET /api/update` (pushed over SSE, polled once a second while an apply is in flight because SSE dies with the server at the handover).

> **The client must NEVER declare failure on a deadline of its own.** It cannot tell a slow download from a dead server, and a 150 s timer that started at the click did exactly that — it reported "the update did not complete" while the download was alive, and the natural reaction (stop the server, restart it) is what actually destroyed the update. The only client-side deadlines allowed are the ones after the handover, when nothing but the local helper can still move: the previous version answering again for `ROLLBACK_GRACE_MS` means a rollback, and `HANDOVER_DEADLINE_MS` covers the helper dying outright.

- **The download must be resumable and retried** (`.part` file, `Range`, 5 attempts). The 35 MB asset used to be one non-resumable `fetch` buffered whole into memory, so a single reset connection lost everything: when a CDN edge served it at 17 KB/s and then dropped, the update died with no file, no log and no way back. **The deadline is on silence** (`DOWNLOAD_STALL_MS`), never on total time — a slow line is not a failure, and an overall timeout only guarantees that the biggest downloads fail on the worst days.
- `tar.exe` on Windows 10+ is bsdtar and extracts zip files natively, including selective paths (`tar -xf x.zip -C dest versions/vX.Y.Z`). **Spawn it by absolute path** (`%SystemRoot%\System32\tar.exe`): a bare `tar` goes through PATH, where Git for Windows' GNU tar can win — and GNU tar cannot read a zip at all.
- **Stopping the server, restarting it and uninstalling are refused (409) while an apply is in flight.** Stopping kills the download and leaves nothing behind, and "it looks stuck, I'll restart it" is precisely what a user does.
- **Task Scheduler kills the task's whole process tree when the task ends**, so a helper spawned by the server dies with it — `detached: true` and `.unref()` notwithstanding (verified: the update silently did nothing, no `update.log` at all). The server therefore runs `update-helper.ps1 -Register` **synchronously**, which registers and starts a one-shot `claude-history-update` task; the Task Scheduler *service* then starts the real helper outside our tree. Never go back to spawning it directly — and the same trap applies to anything else that must outlive the server.
- **`update-helper.ps1 -RestartOnly` is the same detour for a plain restart**, which exists because the bind address is chosen at startup and cannot change under a running server ([Remote access](AI_REMOTE_ACCESS.md#restarting-because-a-socket-cannot-be-re-addressed)). It skips the junction swap and the pruning, health-checks the version that was already there, and registers itself as `claude-history-restart` so a restart from Settings cannot collide with an update in flight. `-NewVersion` is optional in that mode and required in every other.
- `update-helper.ps1` always runs from a `%TEMP%` copy (never from a folder being swapped), health-checks `/api/meta` for the new version and **rolls back** to the previous junction target on failure. It prunes `versions\` to the 3 newest releases — anything not named `vX.Y.Z`, a local `vdev` build included, is not a release and goes too — and unregisters its own one-shot task. It waits for the app task to leave `Running` before starting it: **`Start-ScheduledTask` on a task that is still running does nothing**, silently, and the outgoing server keeps its task Running for a moment after node exits.

### Reading an update afterwards

**An update spans two processes and both must be readable in one place.** The server logs every step under source `updates` — release and URL, each download attempt with the bytes it moved, the checksum, the tar command line and its exit code, the helper registration and its output, and every refusal. The helper logs its half to `<root>\update.log` (`yyyy-MM-dd HH:mm:ss  [lvl] msg`, BOM-less UTF-8; older helpers wrote ASCII, a subset, so both read alike).

`updateLogImport.ts` copies those lines into the daily log under source `update-helper`, **keeping their original timestamps**, so the whole operation reads as one ordered timeline in the viewer. It sweeps repeatedly after startup, not once: the helper finishes AFTER the new server is up — its health check is what waits for us — so a single pass would always miss the ending, rollback lines included.

The installed server runs hidden, so the daily log files are the only trace of a failure and the first thing to check when an installed instance misbehaves ([AI_LOGGING.md](AI_LOGGING.md)). Releases up to 1.3.2 instead wrote `server.log` in the install root, via a `--log-file` flag that no longer exists; those files are legacy and nothing reads them.

## Cutting a release

> **NEVER cut a release on your own initiative** — the rule, and why, is in [CLAUDE.md](../CLAUDE.md#commands). Commit and push freely; tag and release only when the user asks for it in that turn.

`pnpm release -- --version X.Y.Z --notes-file <path>` (`scripts/release.mjs`): state checks → typecheck → build → package → annotated tag → push → `gh release create`. `--dry-run` stops before tagging.

**Releases are cut locally, not by CI.** There is no GitHub Actions workflow — it was removed deliberately: `pnpm release` is faster, debuggable and unaffected by Actions outages.

**The annotated tag message becomes the release notes** (`gh release create --notes-from-tag`), which the in-app popup renders as markdown. Never create a release tag with `git tag` without `-a`/`-F`, and always pass **`--cleanup=verbatim`**: git otherwise strips every line starting with `#`, silently deleting the markdown headings from the notes.

### Choosing the version number

The user asks for "a release", not for a number — **you decide it**, and you say which you picked and why when reporting.

- **Patch — `1.3.X`**: small changes, visual tweaks, bug fixes. The test: the user can do the same things as before, only better.
- **Minor — `1.X.0`**: new functionality. The test: there is something the user can now do, see or configure that did not exist before.
- **Major — `X.0.0`**: never bumped. This is a personal tool with one installation and no API to break, so a major would signal nothing.
- **Mixed release: the highest wins.** One new feature among five fixes is still a minor.
- **Reworking how an existing job is done is a patch**, however much of the code is new: what counts is whether the *capability* is new, not the diff. And giving back something that was simply missing reads as a fix, not as a feature.
- Calibration (the user's own call): **v1.3.2 was right as a patch** — the usage refresh already existed and only changed *when* it fires, and the per-setting default markers fixed there being no way back to a default. Judgement calls like that are the user's to settle; ask if a release sits on the line.

### Writing the notes

They are not a changelog nobody reads: they are what the user sees in the update popup while deciding whether to install, and the popup shows **every version between theirs and the newest**, stacked.

- **Cover the whole release.** Before writing, read `git log <previous-tag>..HEAD` and account for every user-visible change. Skip pure refactors, docs and internal tooling unless they change what the user sees or does.
- **Group under `### Added` / `### Changed` / `### Fixed`**, only the sections that apply, `###` being the top level (the tag line above them is the title). Keep it to a handful of one-line bullets.
- **Lead with the user-visible effect**, then the cause only if it explains something surprising: "In-app updates now actually apply" beats "fixed helper process spawning".
- **Call out anything requiring manual action** in its own line, e.g. a version that cannot self-update and needs a manual `install.ps1` re-run.
- English, markdown, no external links needed. Bold sparingly for the one thing that matters most in each bullet.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 6 (installer) and 7 (update end to end, and the parts that need no release).
