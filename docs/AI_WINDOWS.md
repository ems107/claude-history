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

## Odds and ends

- `process.kill(pid, 0)` throws `EPERM` for alive-but-protected processes — treat EPERM as "alive".
- `fs.watch` recursive works natively on Windows; no chokidar needed.
- Absolute datetimes in the UI are always `dd/MM/yyyy HH:mm:ss` (local time), usually paired with a relative time.

PowerShell encoding rules for the installer scripts are in [AI_DISTRIBUTION.md](AI_DISTRIBUTION.md).

## Verify

[AI_TESTING.md](AI_TESTING.md) — check 13 (executable resolution), and the Explorer half of check 21.
