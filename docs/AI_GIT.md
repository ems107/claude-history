# The GIT tab

**Load this when:** you touch `server/src/core/gitService.ts`, `gitRepos.ts`, `gitParse.ts`, `gitUndo.ts`, `server/src/util/git.ts`, `routes/git.ts` or anything under `web/src/components/git/` — i.e. the one feature of this app that writes to something that is not its own.

A visual git client over the repositories on this machine (`/git`). `~/.claude` stays read-only, the cache, `userdata.json` and the logs stay ours, and a checkout or a commit changes a folder of the **user's**. That is the category every rule below exists for.

## Invariants

- **Never verify this feature against a real repository — not a write, not even a read.** `node scripts/git-fixture.mjs --reset` builds a bench under `%TEMP%\claude-history-git-fixture`, served by a SECOND instance with its own data root, cache and `userdata.json` on port **7436** (7433 is the release, 7434 the dev instance, 7435 `preview.ps1`). Real repositories are for the user to drive by hand.
- **Every git process starts in `runGit()` and nowhere else.** The flags and the environment are not decoration, and the command panel records from inside the runner — so a command missing from the panel means the runner was bypassed.
- **A repository IS its work tree's top level, never its remote.** Ten clones of one project share an `origin` on this machine; keying on the URL would fold ten working trees into one entry and make status, staging and checkout meaningless.
- **`GitRepo.id` is the only thing that travels in a URL or a body.** The path is looked up from it, which makes "a path never comes from the request" structural rather than a validation someone can forget ([CLAUDE.md](../CLAUDE.md#hard-rules)).
- **A non-zero exit is a result, not an error.** `diff --quiet` answers 1 for "there are changes", `merge` answers 1 for "conflicts", `rev-parse --verify --quiet` answers 1 for "no such ref".
- **One lock per repository, covering reads as well as writes** — but a read arriving while the repository is held by a MUTATION does not queue behind it: it answers with the last figures, marked `stale`.
- **`blocked` is one map per status read, and the endpoint recomputes the same function**, so the disabled button and the 409 cannot drift apart. Nothing here is stricter than git.
- **Discarding is the only thing in this tab git cannot undo**, so it is made recoverable instead: `GitUndoStore` copies the bytes first, beside `userdata.json` and never in the cache dir — "Clear cache" must not be a way to lose work.
- **Network calls are user-triggered only.** `fetch`, `pull` and `push` run when somebody presses one of those buttons and at no other time. The `.git` watcher is local and invalidates local state — **it must never lead to a fetch** ([AI_ARCHITECTURE.md](AI_ARCHITECTURE.md)).
- **The tab has no keyboard shortcuts, deliberately.** Everything in it can change a repository. Escape closing a dialog and Enter submitting a path field are the only key handlers, and neither can run git.
- **A phone gets every verb this tab has**, one pane at a time and in WORDS — a glyph with its meaning in a `title` is a glyph with no meaning at all on Android. `components/git/RowActions.tsx` is the one home for "what can be done to this row", and the desktop does not move for any of it ([AI_MOBILE.md](AI_MOBILE.md)).
- **Every sheet this tab opens answers Android's Back**, and the layer whose openness is a search param is a ROUTE rather than a marker: the commit sheet pushes, Back pops it, and its ✕ pops it too. Having both — a `?c=` and a `useBackDismiss` marker — is what made Close-then-Back reopen the commit you had just closed ([AI_MOBILE.md](AI_MOBILE.md)).
- **Nothing here is a one-way door.** The tab's own hidden list (`gitHidden` in `userdata.json`, and not the project one `visible()` reads) is a tick per row in *Settings › Git* and nowhere else. The server had always accepted `hidden: false` and nothing had ever sent it, so a mis-tap on the picker's old `✕` meant editing `userdata.json` by hand — the shape of fault to look for is a verb with no inverse anywhere in the UI, not a missing endpoint.
- **Nothing in this tab is drawn twice.** A list of changed files and a diff with a fold header per file are the same list; a strip of glyphs and a sheet of the same actions are the same actions. Where two controls answer one question, one of them goes — and the one that stays is the one that can do the job without throwing the other's state away.

## Where each rule lives

| File | What it owns |
| --- | --- |
| `server/src/util/git.ts` | `runGit()` — the one door out to a git process: the flags, the environment, the credential lockdown, the recorder |
| `server/src/core/gitRepos.ts` | what counts as a repository, and finding them (projects, scan roots, manual paths) |
| `server/src/core/gitParse.ts` | every porcelain format this reads, and the traps in them |
| `server/src/core/gitService.ts` | the locks, `blocked`, the modes, the watcher, and every verb |
| `server/src/core/gitUndo.ts` | the bin: the bytes taken before a working-tree write |
| `server/src/routes/git.ts` | the REST surface; `repoOf` is the only place an id becomes a path |
| `web/src/lib/gitGraph.ts` | the lane layout — pure, and checkable with no browser |
| `web/src/lib/refTree.ts` | a branch name read as the folder path it is — pure, same reason |
| `web/src/components/git/RowActions.tsx` | what can be done to one ROW, in both spellings: the desktop's glyph strip and the phone's sheet of sentences |
| `web/src/components/git/SectionAction.tsx` | the small verb beside a section title (`+ New`, `stage all`), and the fold chevron both panels share |

## The credential lockdown is not optional and cannot be added later

A `git push` that needs credentials, on a server running hidden under wscript, does not fail: it **hangs for ever** holding the repository lock. Four independent doors, each covering what the others do not:

- `GIT_TERMINAL_PROMPT=0` — git's own prompt.
- `GIT_ASKPASS` / `core.askPass` — the askpass protocol.
- `GCM_INTERACTIVE=Never` / `credential.interactive=false` — Git Credential Manager, whose prompt is a **separate GUI process** and therefore untouched by `windowsHide`.
- `ssh -o BatchMode=yes`, `SSH_ASKPASS_REQUIRE=never`, an empty `DISPLAY`.

The inherited `GIT_*`/`GCM_*` family is stripped: a `GIT_DIR` in the environment retargets every command at whatever repository started the server — in dev, this one.

**The auth-failure pattern is MEASURED, not guessed, and the first draft was wrong.** Git for Windows with Credential Manager says `Cannot prompt because user interactivity has been disabled`; with no helper it says `unable to get password from user`. Neither contains "could not read Username" or "terminal prompts disabled", which is what the pattern originally looked for — so the one case the whole lockdown exists for would have shown raw git output instead of the sentence telling you what to do. Re-measure before editing that regex.

This is also the reason the tab can open a terminal at all: an authentication failure is answered by running the command once by hand. That window opens on the server's own desktop, so it is a local-only action and is refused over the network ([AI_REMOTE_ACCESS.md](AI_REMOTE_ACCESS.md)); how it is opened at all is [AI_WINDOWS.md](AI_WINDOWS.md)'s.

## Reading git's output is a series of traps, each one measured

- **Decode stdout once, at the end.** `Buffer.concat(...).toString('utf8')`, never `.toString()` per chunk: a chunk boundary at 64 KB splits a UTF-8 sequence and destroys exactly the accented paths and author names git output is full of.
- `-c core.quotepath=false` keeps paths as bytes rather than `acci\303\263n.txt`; `--literal-pathspecs` keeps `foo[1].txt` a filename; `-c gc.auto=0` stops a read repacking a user's repo; `--no-optional-locks` on reads stops a background `status` fighting the terminal's `index.lock`.
- **In `--porcelain=v2 -z` a rename puts the original path in its own NUL-terminated field** (tab-separated without `-z`). Read as one field it mislabels every rename.
- **`for-each-ref` spells a hex escape `%1f` while `log` and `stash list` want `%x1f`.** The wrong one does not fail, it prints itself.
- **A merge is diffed against its first parent, explicitly.** `git show` on a merge prints nothing by default, which renders as "this commit changed no files".
- **An operation in progress is read from the gitdir**, never by matching git's English: `MERGE_HEAD`, `rebase-merge/`, `rebase-apply/` (whose `applying` file is the only thing separating a rebase from an `am`), `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG` — via `--absolute-git-dir`, so a linked worktree reads its own.
- **A rebase is never reported as "interactive".** `.git/rebase-merge/interactive` sounds like the discriminator and is not: git writes it for every rebase since the merge backend became the default (verified on 2.55 with a plain `pull --rebase`).
- **A repository with no commits is an ordinary state.** `rev-parse … --abbrev-ref HEAD` fails on an unborn HEAD and fails the WHOLE invocation, so the probe reported "not a repository". HEAD is asked separately with `symbolic-ref --short -q`. `log` needs the same forgiveness: an empty clone says `bad revision 'HEAD'`.
- **Cloning an empty repository configures an upstream that does not exist yet**, so `status.upstream` is set from the first moment. Configured and existing are not the same thing.
- **`fs.watch` on the gitdir needs its quiet period set BEFORE the command as well as after**, and checked again when the debounce fires. git touches the gitdir while it works, so our own first event arrives with the timer already armed; testing only on arrival let every commit echo straight back at the page.

## `git log --graph` is never used

Its art is for people, it has changed between versions, and it cannot be turned back into edges. `%P` is the graph. `--date-order`, not `--topo-order`: topo order must walk the whole history before emitting the first commit.

**Lane layout happens in the browser** (`web/src/lib/gitGraph.ts`, pure): it depends on the viewport, it re-runs whenever a page is appended, and doing it server-side would mean per-viewer layout state and an uncacheable payload.

**One `<svg>` per row, inside the row.** A single absolutely-positioned drawing over a virtualised list has to keep the window index, the scroll offset and every row height in agreement, and breaks the first time a row is not the height it assumed. This cannot drift, because the picture is part of the row — which is also why the row height is passed in rather than read from the module: a phone's rows are taller.

**A lane keeps its index for its whole life, so a `through` segment is always vertical.** Resolving it by sha instead (`after.indexOf(sha)`) is wrong in the most ordinary shape there is — a FORK, where both sides wait for the same commit: every row between the branch point and that commit drew the second lane curving into the first, one identical hook per row, each ending in mid-air. The lanes converge exactly ONCE, at the commit, and that is what `incoming` is for.

**The invariant that catches this whole class, and the only one worth checking:** every lane leaving the bottom of a row is met by a lane entering the top of the next. It is checkable on the pure layout AND on the rendered picture — read the `d` of every `<path>`, collect the x at y=0 and y=`ROW_H`, compare consecutive rows — so a drawing bug cannot hide behind a correct layout.

## Writing: what reaches git, and what cannot

- **Paths reach git only if they were in the status we just read**, NUL-separated on stdin (`--pathspec-from-file=- --pathspec-file-nul`): no argv limit, no quoting, and 400 files stage in one call. `git clean` is the exception — it will not read a pathspec from stdin, so deletions go in argv in batches of 100.
- **A conflicting merge is a 200, not an error.** It did what it was asked; the repository is now in a state the UI must render. Same for a rebase or a cherry-pick that stops — `writeAllowingConflict` is where that distinction lives.
- **`--continue` needs `core.editor` back.** `BASE_FLAGS` sets it to `false`, which exits non-zero and aborts the continue; continuation operations must override it (`GIT_EDITOR=true`, or `--no-edit` where the subcommand takes it).
- **A remote must be one the repository already has** (checked against `git remote`), which makes "push to a URL of my choosing" structurally impossible. There is no plain `--force` and there must never be: `--force-with-lease` refuses when the remote moved since the last fetch, and that is the entire difference between overwriting your own mistake and overwriting somebody else's work.
- **Arguments that could stop being arguments**: a stash index is turned into `stash@{n}` from a NUMBER, never taken as a string, and a worktree path must match one `git worktree list` already reports — so removing one cannot delete an arbitrary folder.
- **A conflicted file is three files, not a diff.** `:1:`/`:2:`/`:3:` are the ancestor, ours and theirs; any of them can be absent. Diffing it instead renders the merge markers as content.
- Staging and committing are deliberately allowed during a merge: staging is how a conflict is resolved and a commit is how a merge is concluded.

### A hunk is staged with git's OWN bytes

The file is re-diffed and its raw output split on the `@@` lines (`splitRawHunks`), never re-emitted from the parsed structure. Measured, so the reason is the real one rather than the plausible one: git **forgives a wrong `@@` count** (it recounts and still applies correctly), but it refuses a context line that lost its leading space (`corrupt patch`) and a hunk that lost its trailing newline (`patch failed`) — and a patch whose line endings were touched in transit makes every line of the file read as changed, observed for real by piping one through `awk` in Git Bash. So the patch is assembled in memory from raw bytes and handed to `git apply` on **stdin**, never through a shell pipeline. The hunk index is resolved against a diff taken at that moment, so a file that moved on since the page drew it fails to apply, which is the right answer.

### Line-level staging is a patch git never wrote, and its ORDER is the danger

`buildLineSelectionPatch` turns unselected lines into context and drops the rest — but emission must be driven by ONE SIDE OF THE FILE, pairing each removal with the addition at the same position in its run. git writes a replaced run as every `-` then every `+`, so transforming in place puts a surviving old line *before* the addition that should precede it: measured, that produced an index reading `line 5, line 7, line 6 CHANGED` from a patch git accepted with exit 0.

- **Which side is `against` the thing being patched, and it is not always the old one.** `git apply` matches the patch's old side; `--reverse` matches its new side. So staging (forward, against an index still holding the old side) drives from the OLD file and turns unselected removals into context, while unstaging and discarding (both `--reverse`) drive from the NEW one. Getting it backwards is a flat refusal, not a corruption (`error: patch does not apply`) — which is how **unstaging a partial run had been failing unnoticed**: a whole run or a single pair works either way, so only a partial selection shows it.
- **Three runtime checks were tried and all three deleted; do not rebuild them.** Comparing the lines left pending misses it (a transposition leaves the same SET of differences). Requiring the two halves to add back up to the whole hunk refuses everything (both patches are built against the same base). Comparing what CHANGED misses it too, and this is the one worth remembering: git computes a MINIMAL diff, so deleting line 6 and re-adding it after line 7 yields exactly the same `+`/`-` lines as doing it correctly. **The corruption is positional and no text comparison can see it.** The protection is the unit check on the pure function. Keep it.
- A file with **no trailing newline** carries git's `\ No newline at end of file` marker, and the marker belongs to the line ABOVE it — so it travels with that line instead of being emitted where it was found.
- **Line-level discard exists, and it is the one operation here that writes the file.** No check can make it safe: a wrong discard destroys exactly as much as a right one. What makes it offerable is the bin below. In the UI a picked line brings its pair with it — taking the added line out without putting the removed one back would delete content nobody chose — and the dialog lists exactly what goes and what comes back.
- A selection spanning several hunks is sent as **one request per hunk**, in order: a patch mixing two hunks would describe a file that never existed.

## The bin, and the rules that were bought rather than guessed

`GitUndoStore` copies the exact bytes before every working-tree write (whole file, hunk, lines, and the `git clean` of an untracked file), and **if the copy cannot be made the discard does not happen**: an undo that might not be there is worse than none.

- It lives **beside `userdata.json`, never in the cache dir**, and never inside the repository, where it would show up as untracked files in the very status it exists to protect.
- **A copy taken for an operation git then refused is dropped again** (`withUndo`). The bin is the only list of what was lost, so an entry for a discard that never happened is a lie in it.
- Pruned at **40 entries per repo and 7 days**, whichever comes first; a file over 8 MB is refused rather than half-copied.
- **Restoring keeps the entry** instead of consuming it, so restoring the wrong one is itself undone by restoring the right one.
- A missing id is a **400 with a sentence**, not a 500: pruned, or a page left open past it, is an answer rather than a crash.
- Lines picked across two hunks are two calls and two copies; the undo bar offers the **FIRST** — the file before any of it.

## Each button's main click is a SETTING, and the server applies it

`gitFetchDefault` / `gitPullDefault` / `gitPushDefault` / `gitMergeDefault` are ordinary `AppSettings` keys, and `GitService.mode()` applies them whenever a request names none — so a bare `POST /api/git/repos/:id/pull` from anywhere does what the user chose, and there is one answer to "what does Pull do in this app" instead of one per caller.

The lists live in `shared/src/git.ts` and their ORDER is load-bearing twice: it is the menu order, and the FIRST entry is the shipped value that a stored garbage value falls back to (`oneOf` in `core/index.ts` falls back to the shipped one, never to the stored one — once something unknown has been written there, the stored value is itself suspect). What each mode MEANS is `GIT_*_LABELS` in the same file, because two screens say it: the `▾` beside the button, and the row in Settings ([AI_VIEWER.md](AI_VIEWER.md#the-settings-page-is-a-catalogue-and-seven-areas)).

- Shipped: `fetch --prune --all`, `pull --ff-only`, push straight away, `merge` letting git fast-forward — the conservative reading in each case. **Never `--prune-tags`**: it deletes local tags that are not on the remote, including ones made here and never pushed.
- **The alternatives are one click away, not behind a refusal or a settings page.** `SplitButton`'s main click runs the configured variant; the `▾` lists them all with **the exact git command under each label**, and marks which one the settings point at. The main button grows a `(rebase)`-style suffix exactly when it is not doing the shipped thing.
- **Nothing destructive can be a default.** Force pushing and deleting a remote branch exist only as menu entries behind their confirmation; the settings cannot name them.
- Push's variants are a flow rather than a command, which is why its setting is the odd one and why the server has no push mode to apply.

## The command panel is the feature's own audit

One global ring of 300 — global, not per repo, because the failures worth returning to are the ones where you no longer remember which repository it was. `redact()` runs on argv, stdout, stderr and the stdin preview before anything is stored or logged: the realistic leak is a remote URL carrying a token, which shows up in `git remote -v` and in a push's argv. The SSE event carries only the newest seq, never the entries, so a closed panel costs nothing.

In the daily log the split is **mutations at `info`, failures at `warn`, reads at `debug`** — so at the default level the log reads as everything that CHANGED a repository and nothing else ([AI_LOGGING.md](AI_LOGGING.md)).

## The refs panel is a tree, and the commit is two panes

Both are the same observation: a list with structure in it should be drawn with that structure, and a screen should answer one question at a time.

**A branch name is a path.** `lib/refTree.ts` groups on the slash and gives back folders and leaves; the panel renders them recursively with 14px of indent per level, a tint on the folder rows and one fold state for the lot in `localStorage` — the **OPEN** set, because closed is the default and a set of what is closed cannot express that for a folder nobody has met. Three rules keep it from being worse than the flat list it replaces: a single-child chain merges into one row (`feat/api/`); **a folder that would hold exactly one branch is not a folder** — `release/2026.09` stays a row, because a chevron you have to open to find one thing is two taps for nothing; and **folders come first, alphabetically, then the loose refs**, since a folder is a decision you make once and a branch is a row you act on. The filter above it is a plain substring, deliberately: you are typing the part of a name you remember, every character must narrow the list, and a fuzzy matcher that answers `edgar/DES-32683` to `dst` then has to explain itself. While it has text in it every folder is open and every section with no hit is gone.

**Which repositories the tab shows is decided in Settings, not in the picker.** The picker is a list you open to CHOOSE from; the one control that removes an entry has no business sitting beside the eleven that select one, and it was a `✕` drawn permanently on a phone. *Settings › Git* lists every repository with a tick, the shape *Settings › Projects* already uses for the same question. Nothing else in the picker rows carries a fact that needs a tooltip either: the `+N` sibling badge is gone (it is `GitRepo.siblings`, still there for anything that wants it) and the three origin words — `project`, `scanned`, `added` — are explained in one line at the foot of the panel.

**A commit is a message and a list of files**, and they are two panes of a segmented control rather than one scroll. The files are drawn once — the strip of path chips that used to filter the diff is gone, and the fold headers it duplicated are what remain — closed, each **fetching its own diff on opening**. That is not only tidier: `GET /api/git/repos/:id/diff?sha=…` with no path reads the whole commit, so a forty-file commit was forty diffs fetched to draw forty file names.

**Checking out is a split button.** `git checkout <sha>` detaches HEAD, which is the right default from a commit row and a surprise to anybody who has not met it. When a local branch is standing on that very commit, checking THAT out gives the same files with HEAD still attached, and it is almost always what was meant — so it is an entry in the menu, one per branch at the commit, each printing the command it runs. `commit.refs` already carries them; the one whose `isHead` is set is left out, being where you already are.

## Going away mid-rebase

`ctx.git.busy` joins the active-session guard on the four endpoints that end this process — `/api/server/stop`, `/api/server/restart`, `/api/update/apply`, `/api/uninstall`. A rebase interrupted by its own server disappearing leaves a repository in a state nothing in this app put it in, with no `--continue` and no `--abort` left running to offer either.

Its own helper (`util/gitBusy.ts`) and a plain sentence rather than a second `GuardedAction`: the active-session refusal hands the browser a LIST to go and close, and a half-finished rebase is not something anybody can close — only something to wait for ([AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md)).

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 61 (the bench and discovery), 62 (encoding and state), 63 (the graph and its seams), 64 (diffs and the word-diff), 65 (the command panel), 66 (writing, and `blocked`), 67 (the network half and credentials), 68 (hunks, lines and the bin), 69 (the tab on a phone).
