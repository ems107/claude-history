# Search

**Load this when:** you touch `server/src/core/search.ts`, `searchText.ts`, `deepSearch.ts`, `shared/src/fold.ts`, `shared/src/match.ts`, `shared/src/searchText.ts`, the search box, the results list or the paged match list. The find bar inside a session is a reader of the same fold and lives in [AI_VIEWER.md](AI_VIEWER.md#finding-a-word-in-the-conversation).

## Invariants

- **Tool calls and tool output are NEVER indexed** — with exactly one exception, a plan.
- **The deep scan re-matches the indexed text too**, so it is a superset of the plain search by construction.
- **One predicate decides what is searchable** (`skipBlock`), shared by the index, the deep scan and both paged match lists.
- **A find bar counts occurrences; a match page counts places.**
- **There is exactly one `normalize('NFD')` in the repo** (`shared/src/fold.ts`) and it must stay that way.
- **Every occurrence belongs to exactly one window** (`matchWindows`), or the counts stop adding up.
- **A partial answer must never read as a complete one** (`stoppedEarly`).
- **The advanced panel's tuning lives in the URL only** — no settings, no persistence.

## Two corpora, and the split is the whole design

Measured on this machine: the indexed text (titles, typed prompts, assistant prose) is **0.8% of the bytes** in `~/.claude/projects`, while `tool_result` output alone is **34% — forty-two times more text**, with 129 MB of it inside a single session. So:

**Tool calls and output are never indexed.** Doing it wholesale would take the cache from 6.5 MB to ~250 MB, hold the folded copy in memory for the process's life and force a re-enrich of 470 MB. They are read on demand instead (`deepSearch`), streamed chunk by chunk and never accumulated: the whole corpus costs ~4 s and no memory that outlives the request. `POST /api/search/deep` only ever runs from the button — never on a keystroke, never on a refocus (that query sets `staleTime: Infinity` and switches both refetch triggers off).

**The plan of an `ExitPlanMode` call IS indexed**, under a role of its own (`PLAN_ROLE`, `fillPlanText`). The rule above is about SIZE — plans are 17 documents and a quarter of a megabyte against the 34% of the corpus that justifies it — and they are the highest-value prose a session holds. A restriction to titles, prompts or responses leaves them out with no rule of its own, since `in=user` names the roles it wants and a plan is not something the user wrote.

- **That makes de-duplication the deep scan's problem, and there were TWO copies.** The call's input is the obvious one (`toolCallText` emits the bare tool name for `ExitPlanMode`). The other is the approval's own tool_result, which echoes the whole plan back after a fixed preamble — with the SAME `toolUseId` anchor as the indexed row, so a deep search showed one plan twice and sent both links to the same place. The echo is cut at `## Approved Plan:` and the preamble kept, because it names the file the plan was saved to. (Checked: `b343d4ac` went 7 → 6 deep matches, both page sets still closing.)

**The deep scan re-matches the indexed text**, rather than merging two result sets: only that way can "all words anywhere in the session" pair a word from a prompt with one that exists solely in a tool result. It is a superset of the plain search by construction, snippet budget included (6 a session against 3, so pressing the button never shows less than not pressing it).

It also reads what nothing else can: the outputs offloaded to `tool-results/` (path validated against `projectsDir` first — it comes out of a transcript, not from us) and **every subagent transcript**, 54 MB that no search could otherwise reach. Subagent snippets carry `uuid: null` on purpose: the viewer knows only the parent transcript, so an anchor there would resolve nowhere.

It is **cancellable and bounded, and says so**. The abort signal comes from the RESPONSE closing unfinished (`reply.raw`), not from the request — the body arrived long before and its close event says nothing about who is listening. `BUDGET_MS` and `MAX_HITS` set `stoppedEarly`, which the results header shows.

**There is a third reader of the same fold, and it holds neither corpus: the viewer's find bar.** It scans the copy of one conversation the browser already has — prose, tool input as it is rendered, and the first `MAX_RESULT_CHARS` of each result — so it reaches thinking and tool output, which the index never carries, and knows nothing of session or agent ids, which mean nothing inside a session. A subset of `deep=1` by construction, and it says what it cannot reach rather than implying it found everything. Behaviour is in [AI_VIEWER.md](AI_VIEWER.md#finding-a-word-in-the-conversation); what matters here is that the matcher is the same one, so its idea of a match cannot drift from the server's.

**`matchWindows` deliberately stayed server-side** when `buildSnippet` moved to `shared`. Its whole contract is grouping occurrences into PLACES so a paged list's figures add up — and **a find bar counts occurrences while a match page counts places**. Borrowing it would mean reporting "3 of 38 places" where the reader expects "3 of 46 matches", which is the distinction the paragraph above spends itself on.

## A hit's count has to be reachable

The snippets a hit shows are a teaser (three, six when deep), and `+N more matches` was a line of text about matches nobody could get to. `GET /api/search/session/:id/matches` pages over PLACES — one snippet row each — and **`deep=1` must match how the hit was obtained**: a deep hit counts matches the index never saw, so the indexed corpus would answer with fewer places than the number that was clicked on.

Each page re-walks the session rather than keeping a cursor (the folded text is already in memory: 1 ms a page); a deep page re-streams that one transcript, which is why the UI asks for 100 places a click there against 25.

- **The arithmetic must close**, and `matchWindows` is what closes it: every occurrence is assigned to exactly one window, so the pages' `pageMatches` add up to `matchCount` to the unit (46/46 across 38 places; deep, 503/503 across 502 in `f3384d17`). Without that the footer would count "31 of 46" and never reach 46, and the button would go on offering more of what was already shown. It is also why window enumeration is its own function and not the search's three-anchor round-robin, which deliberately stops counting places after three.
- **Opening replaces the teaser instead of continuing after it.** Those snippets are picked one per term so that every word gets a slot — the right teaser and the wrong beginning for an ordered list. The list runs in the order the corpus is read (prose, then tool calls and output, then subagents, for a deep one).
- The button counts **rows**, the footer counts **matches**: a row can carry several occurrences, so a button promising matches would overpromise, while the footer has to speak in the same unit as the `+N` that was clicked.

## Session and agent ids are indexed blocks

**A session's own id is one of them** (role `id`, text the bare uuid), so pasting the eight characters the app writes on a fork chip, in a log line or in a URL lands on the session they name — the one thing about a session that is on screen everywhere and used to be searchable nowhere.

**Its agents' ids are indexed the same way** (`enrichment.subagentIds`, one `id` block each, carrying `agentId` so the row can link to `?agents=1&agent=<id>`). Same reason, one step worse: an agent id is what a notification calls the agent and what the drawer puts in the URL, and it appeared on no page at all.

- **Only a query that could BE an id ever looks at it**: hex, dashes allowed, four characters and up (`matchesSessionIds`). A uuid is 32 hex characters, so an ordinary word made of a-f and digits — `cafe`, `cada`, `added` — would otherwise drag in whatever session happens to carry those letters inside its id.
- **It is a block like any other, and that is what keeps the counts honest.** The search, the deep scan and both paged match lists share one predicate (`skipBlock`), so a hit can never count an id that its own `+N more matches` page cannot find — and the deep scan stays a superset for id queries too (checked: the id row appears exactly once in a 245-match deep page set, 200 + 45 = 245).
- A restriction to titles, prompts or responses **leaves it out**: an id is not text anybody wrote, and `in=user` asking for it would answer a different question.
- The results header counts **the hits the sidebar filters are holding back** rather than dropping them in silence. Empty sessions are hidden by default and a stub is exactly the kind of session looked up by id, so without that line the lookup reads as "0 matches" while the session sits one checkbox away.

## Folding (`shared/src/fold.ts`)

Imported by both sides — there is exactly one `normalize('NFD')` in the repo and it must stay that way. The fold is case-, diacritic- AND whitespace-insensitive, and each of those was bought with a bug:

- **Whitespace runs collapse to one space**, needle and haystack alike. Snippets are rendered through `oneLine()`, so without it the text shown and the text searched differ — a phrase pasted from a wrapped log could not be found while the snippet displayed it intact.
- **A code point that IS a diacritic emits nothing**, so text already in NFD (a paste from macOS) folds like its composed form. Nonspacing marks only: a spacing mark is a letter component, not an accent.
- That makes an **empty needle** reachable (a query of nothing but accents), and `indexOf('')` matches at every position without advancing — answered before the scan, never inside it.
- The fold walks **UTF-16 units with a latin-1 lookup table**, 100 MB/s against 13 for `normalize()` per character. The same function fills the table and handles everything above it, so the paths cannot disagree. `map` keeps one entry per emitted unit — that of the run's or the character's first index — and snippet offsets depend on it, so nothing may emit without pushing.
- **A phrase is the one-term case**, which is why a single scan serves both modes and quotes need no second code path. In phrase mode quotes are therefore literal characters, which is why the panel only offers them for loose searches.
- Blocks are **deduplicated by uuid+text** on load: some transcripts re-append a line they already wrote, verbatim (57 of 246 messages in one session), which doubled every count. Identical text under a different uuid is a real repetition and stays.

`shared/src/match.ts` is that argument applied to finding a term: the server scans with `occurrences` / `parseTerms`, the viewer marks the words a search landed on with the same ones, and the find bar scans its own corpus with them too — so the whole-word rule cannot exist twice. `shared/src/searchText.ts` is the same argument applied to cutting the snippet around one: the server's results list and the find bar's both go through `buildSnippet`, or they would disagree about where a snippet starts the day one of them learned something.

## Tuning

The advanced panel's tuning lives in the **URL only** — no settings, no persistence. `saveListParams` (sessionStorage) carries it there and back from a session, and opening the app fresh starts plain. Whatever is off its default **counts on the collapsed button**: a panel nobody can see must never change results in silence.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 3 and 9 (search, deep search, paging, ids, marking), and 26 for the find bar's own corpus and its agreement with this one.
