# Windows gotchas

**Load this when:** you resolve an executable, spawn a process, open a terminal or Explorer, or format a date — `util/launcher.ts` above all.

## Invariants

- **Never get a path out of a console tool's stdout** — resolve executables in Node.
- **Ask the DIRECTORY, not the file, whether an exe is there.**
- **Treat `EPERM` from `process.kill(pid, 0)` as "alive".**
- Absolute datetimes in the UI are always `dd/MM/yyyy HH:mm:ss` (local time), usually paired with a relative time.

## Resolving an executable

**NEVER get a path out of a console tool's stdout — resolve executables in Node** (`whichExe` in `util/launcher.ts` walks `process.env.PATH` and lists each directory).

`where.exe` writes in the **console output codepage** and Node decodes stdout as UTF-8, so a path through a non-ASCII profile does not arrive misspelt, it arrives **destroyed**: `C:\Users\JavierAñón\...\claude.exe` came back as `C:\Users\JavierA\uFFFD\uFFFDn\...` (bytes `A4 A2`, cp850) and spawning it fails ENOENT. Measured, same machine, same command: CP 850 → `JavierA��n`, CP 65001 → `JavierAñón`.

**The installed app is always on the wrong side of that**: `wscript //B` from a scheduled task has no console, so it inherits the system OEM codepage — while a dev server started from pwsh 7 (UTF-8) never reproduces it. It cost a user with `ñ` in his username the entire auto-reload feature, reported as "found" throughout. `process.env` is safe (Node reads the environment as UTF-16); anything crossing a process boundary as **bytes** is not.

**PATH is a snapshot taken at logon** for a task-started server, so a CLI installed afterwards is invisible to any PATH search (`where` inherited the same stale env — shelling out never helped). Hence the explicit fallbacks: `~\.local\bin`, `%LOCALAPPDATA%\Microsoft\WinGet\Links`, and the `Anthropic.ClaudeCode*` portable-package folder.

**Ask the DIRECTORY, not the file, whether an exe is there.** App-execution aliases (`%LOCALAPPDATA%\Microsoft\WindowsApps\*.exe` — Windows Terminal, and anything winget-installed) are ACL-blocked for stat: `fs.existsSync` answers **false** for a file that `readdirSync` lists and `spawn` launches without complaint (verified: `statSync` → EACCES). An `existsSync` guard silently skips exactly the executables this app has to launch — the old `findWt` alias-dir fallback was dead code for that reason and nobody noticed, because `where` was covering for it.

## Terminals

- `wt.exe` (Windows Terminal) is a Store-app execution alias (reparse point) that Node `spawn` cannot launch via PATH lookup — resolve the real path from `%LOCALAPPDATA%\Microsoft\WindowsApps` (listing the dir, per the rule above), and keep the classic `cmd /c start` window as fallback.
- **This machine's Terminal app is `Microsoft.IntelligentTerminal`**, which exposes aliases `wtai.exe` (windowed — accepts the classic wt CLI: `-d <dir> <command...>`) and `wtcli.exe` (a HEADLESS bridge — opens no window; never use it to launch a terminal). There is no `wt.exe`. The packaged exes under `Program Files\WindowsApps` are ACL-blocked (spawn EPERM).

## Explorer

**`explorer /select,<path>` needs `windowsVerbatimArguments`.** Explorer wants the switch OUTSIDE the quotes (`/select,"C:\a b\c.ts"`), and Node quotes any argument containing a space, which produces `"/select,C:\a b\c.ts"` — an argument Explorer does not recognise at all, so it silently opens Documents and the bug reads as ours. `revealInExplorer` writes that command line itself and falls back to opening the plain folder, answering `selected: false` so no button can claim a selection that did not happen (verified through `Shell.Application`: right folder, right file selected, on a path with three spaces in it).

## Asking Windows for a folder

`pickFolder` in `util/launcher.ts` puts the system folder browser on the server's own desktop and answers what was chosen. Five things make it work, and every one of them was the difference between a button that works and one that looks broken:

- **It is a `.ps1` file run with `-File`, never a `-Command` one-liner.** This is the first thing to restore if it ever gets "tidied up": joined into one line with `;` separators, the identical code reached neither `ShowDialog` nor an error — the process sat there with no window, no output and nothing on stderr, and the request hung until the timeout. As a file, every statement ran first time. One line of PowerShell is a parser to be argued with; a file is not.
- **The answer comes back through a FILE, never stdout.** Same trap as `where.exe` above, one level worse: the path being chosen is arbitrary and may well be the one with `ñ` in it. PowerShell writes UTF-8 bytes with `[System.IO.File]::WriteAllText`, Node reads them, and the console codepage never enters into it. **No output file means Cancel**, which is an answer rather than a failure — unless the script wrote to stderr, which is captured for exactly that reason: a script that cannot run also writes no file, and reporting it as "cancelled" would turn a broken button into a silent one.
- **The two inputs travel as environment variables**, not inside the script. A folder can contain a quote or a `$`, and nothing the user types may become part of a program.
- **`-STA` is not optional.** WinForms needs a single-threaded apartment and pwsh does not start in one.
- **The dialog has to be raised after it exists, and an owner cannot do it for you.** A background process cannot take the foreground — that belongs to whatever the user last clicked, which is the browser — so the only lever is z-order. A topmost owner is not enough: Windows propagates `WS_EX_TOPMOST` to the windows an owner ALREADY has when it becomes topmost, never to ones created afterwards, and the dialog is always afterwards. Measured with an unshown owner and with a shown topmost one alike: `#32770 "Select Folder" visible=True topmost=False`, sitting behind the browser, invisible to the person who asked for it. So a `Timer` started before `ShowDialog` — which pumps messages, so it keeps ticking underneath — finds the dialog with `GetWindow(owner, GW_ENABLEDPOPUP)` and calls `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)`, which needs no foreground rights at all.
- **`GW_ENABLEDPOPUP` does not answer NULL when there is no popup — it answers the window you asked about.** This is the trap that made the raise look correct while doing nothing: on the first tick, before the dialog existed, it returned the 1×1 owner, the code raised THAT, stopped the timer, and the real dialog was born with nobody left to lift it. It therefore *appeared* to work whenever .NET happened to be warm enough to have the dialog up inside the first interval, and never on a cold start — which is exactly the shape of a bug that gets called flaky and left alone. Compare against the owner's own handle and keep ticking. Verified cold, first pick after a server restart: z-index **0**, nothing above it at all.

`findShell()` prefers pwsh here beyond taste: on .NET the dialog is the modern one (`Select Folder`, with a path box), while Windows PowerShell 5.1 draws the old `Browse For Folder` tree. Both work.

**The script ends with `[System.Environment]::Exit(0)`, and that is load-bearing.** A pwsh host holding a shown WinForms window has been observed outliving the closed dialog; while it lives, `picking` stays set and every later click is refused with "already open" about a window nobody can see. Exiting on the spot makes the lock last exactly as long as the dialog. One at a time is still the rule — a second dialog opens behind the first — and `PICK_FOLDER_TIMEOUT_MS` is a backstop for a dialog nobody will ever answer, not a pace: the thing at the other end is a person browsing a disk.

## Odds and ends

- `process.kill(pid, 0)` throws `EPERM` for alive-but-protected processes — treat EPERM as "alive".
- `fs.watch` recursive works natively on Windows; no chokidar needed.
- Absolute datetimes in the UI are always `dd/MM/yyyy HH:mm:ss` (local time), usually paired with a relative time.

PowerShell encoding rules for the installer scripts are in [AI_DISTRIBUTION.md](AI_DISTRIBUTION.md).

## Verify

[AI_TESTING.md](AI_TESTING.md) — check 13 (executable resolution), the Explorer halves of checks 21 and 48, and the folder browser in check 37.
