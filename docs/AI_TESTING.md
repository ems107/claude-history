# Verifying a change

**Load this when:** you have changed something and need to prove it works, or you need a fixture with a particular property.

There is no automated test suite — this is a personal tool and the data it reads is real. That makes the fixtures the fragile part, so start with them. The checks keep their historical numbers; the other documents link to them by number, and hold the *why* these assertions are the right ones.

## Fixtures

Fixtures are sessions in `~/.claude/projects`, and Claude Code sweeps them on `cleanupPeriodDays` ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#everything-here-has-an-expiry-date-cleanupperioddays)). **When one is missing, find a replacement by the property it was chosen for rather than dropping the check**, and say in the commit which fixture you used.

**Surveyed 16/08/2026** — 120 sessions, 41,511 lines, 139 MB:

| Property | Fixture today | Gone |
| --- | --- | --- |
| `/branch` fork, `forkedFrom`, `carriedOverUsage` | **none — the corpus has no fork at all** | `c0f70eda` (off `0f5b1c8b`) |
| Replayed segment (duplicate uuids) | `f3384d17` (18 lines) | `0f5b1c8b` (2,072), `cae7f9f5` (17,678), `1decb824` (26) |
| Compaction boundary | `f3384d17` (2), `432b1d41` (1), `980751cb` (1) | `0f5b1c8b` (8), `cae7f9f5` (41) |
| `/context` snapshots | `f3384d17`, the only one | — |
| Task notifications | `980751cb` (16), `15a86025` (7), `19ebb1d5` (6), `b343d4ac` (5) | `1decb824` (80) |
| Queued human prompt | `e36007b6` (3), `b343d4ac` (2), `15a86025` (1), `9ef9f798` (1) | — |
| Subagents | `15a86025` (11, nested), `19ebb1d5` (6, failures), `980751cb` (5), `b343d4ac` (5) | — |
| Rewound branches | by branching parent: `f3384d17`, `1aa6d6db`, `b3e8ad92`, `0dd71f3d` | `c0f70eda`, `e663c8d5` |
| Questions with drawings / notes | `e95a1a42`, `825f06f6`, `e36007b6`, `a46fc22a`, `edacebe6`, `797db462` | — |
| Plan mode | `b343d4ac`, `f3384d17`, `980751cb` | — |
| File references in prose | `20a73271` (DistribVB6_0) | — |
| Clean control (no compaction, no re-cache) | `3b326b6c` | — |

**A fork has to be made on purpose now**: run `/branch` in a session with live context.

**Finding a replacement.** Shortlist with ripgrep over `~/.claude/projects/*/*.jsonl`, then confirm by parsing — a grep also hits sessions that merely *discuss* the field, and this repo's own transcripts are full of those:

```
rg -l '"forkedFrom"'          # forks
rg -c '"compact_boundary"'    # compactions
rg -c '"queued_command"'      # queued lines (prompts AND notifications)
rg -c 'task-notification'     # notifications (noisy — confirm by origin.kind)
ls */*/subagents/*.jsonl      # sessions with agents
```

Duplicate uuids (replays) and branching parents (rewinds) need a real parse: count `uuid` seen twice, and `parentUuid` values with more than one child.

## Two rules for any check that runs Claude

Checks 8, 19 and 23 spawn real `claude` processes against the user's subscription.

1. **Use `haiku` or `sonnet`, never `opus` or `fable`, and `low` effort.** None of these checks measures intelligence — they measure that the channel, the transcript, the indicator and the process cleanup work.
2. **Never kill processes by filtering on `claude.exe`**, by name or command line: the agent running the test is one of them, and `taskkill /T /F` over a filter takes it out along with the target. Capture the pid you spawned and kill that one, or kill nothing. (This cost a session to learn.)

## Smoke

**1.** `pnpm dev` → the list shows the real sessions; case-variant project dirs merge into one project tag.

**2.** Open the largest session (multi-MB) → renders quickly, tool blocks collapsed. Pressing Ctrl+F there costs the corpus build once (~40-50 ms, check 26) and leaves the blocks collapsed until one is stepped onto.

**4.** Start/stop a real Claude Code session → the LIVE badge appears and disappears.

**5.** "Resume in terminal" opens Windows Terminal in the right cwd; unknown UUIDs → 4xx.

## Search

**3.** A Spanish phrase with and without accents → the same hits.

**9. Search, deep search, paging, marking.**

- `is invalid according` must find a phrase sitting across a newline in a pasted log; the same query in NFD must match as in NFC.
- `is invalid` in words mode: 31 sessions → 12 with **Whole words only** (`is` inside `asistente`).
- A query of only accents, or of single letters: 0 hits in ~0 ms, never spinning.
- **Deep**: a string only in a `tool_use` input (`old_string`) → 0 normally, ~35 sessions in ~4 s deep. One only in tool output (`TS2339`) → 0 then 1. A prose word plus a tool-only word in session scope → 0 then a hit (the pairing that justifies re-matching the indexed text). Cancel mid-scan (`curl --max-time 1`) and the log must read `deep search cancelled` with the bytes it got through, not the full corpus.
- **Paging is arithmetic — check it without a browser.** Page `/api/search/session/:id/matches` to the end: `pageMatches` must sum to `matchCount`, snippets to `total`, and `matchCount` must equal what `/api/search` said (`compact` → 46/46 in 38 places). With `deep=1` on a deep-only hit: `old_string` → 503/503 in 502 places for `f3384d17`, 6 pages of 100, ~16 MB re-read each, `call`/`tool`/`agent` rows among them. Page that same hit **without** the flag and it must come back short. `offset` past the end → 0 snippets, totals intact; `limit=999` → clamped to 200. Every mode behaves the same (words + session scope, whole words, `in=user` whose rows all read USER).
- **Links**: every snippet link with an anchor carries `hl` (one per term, folded — an accented query gives `hl=sesion`) plus `hlw=1` under whole words, and no anchor may travel without them.
- **The find bar must not disturb any of this.** It registers `find-match` and `find-current`; `search-match` is the deep link's alone, and the `<mark>` prohibition covers both. The "4 tool blocks in the DOM of a 210-call session" assertion below is about a deep LINK — the bar deliberately leaves every block it steps onto open.
- **A tool block is not always outside a bubble.** A run that ends at a question or a plan, in a message that also wrote prose, is drawn INTO that bubble, and `anchorBox` has to test `[data-tool-id]` first: `b343d4ac`'s `toolu_01CyGpmXFjFcBj8apDVmAXck` must flash 17,047 characters, not the 19,383 of the answer around it.
- **`matchSpans` needs no browser**: feed it the pieces a markdown sentence breaks into; every span must cut out exactly the matched text. Cases: a phrase across three text nodes, one across a newline (`is invalid\naccording`), a haystack in NFD against a folded needle, `is` under whole-words, and the cap keeping the FIRST marks.
- **The rest needs Chrome over CDP** (no dependency needed — Node has `WebSocket`): navigate to the link; `[data-bubble].match-flash` must exist, `CSS.highlights.get('search-match')` must hold ranges whose `toString()` is the term, the first must be inside the viewport even with the bubble's top hundreds of pixels above it (verified at top −647), and 9 s later both must be gone on their own. **A `<mark>` in the DOM means somebody went back to mutating React's markdown.**
- **Tool hits**, same check against `[data-tool-id="<toolUseId>"]`, four cases: a `call` (`old_string` → an `Edit`, marked inside the input JSON); an inline `tool` result (`TS2339` → a `Read`); a call inside a COMPACTED segment (`toolu_01CkCY9SSEF…` in `432b1d41` — only 4 tool blocks may be in the DOM afterwards, out of 210, or something opened the session instead of the run); and an OFFLOADED output (`toolu_01LnH4KFDcZ…` in `4a1483ba`, `NOTION_TOKEN`, which exists only in the 90 KB file — no "Load full output" button may be left, and the pre must be scrolled to the first mark).
- **Session ids**: `797db462` → the `id` row carrying the whole uuid, linked **with no anchor**, beside the 4 sessions whose prose mentions it; `5f6fa047` (named nowhere) → 1 hit, 1 row; the same for the full uuid and a 6-character prefix. `in=user` drops the row. A word made only of hex letters (`cada`, `deba`, `add`) produces none. Deep stays a superset (`5f6fa047` deep still has it) and its paging still closes (`deep=1` on `980751cb`: 245 in 2 pages, 200 + 45, the `id` row counted once). Empty sessions are what the header line is for: `?q=e1eb30cf` reads `0 matches in 0 sessions · 1 more hidden by the filters`, and `&empty=1` turns it into the hit.

## Cost and context

**10. Per-response cost — the pills must reconcile**, checkable without the UI: sum `usage` over every assistant item of `GET /api/sessions/:id` at the `/api/prices` rates; it must equal the token panel's total to the last decimal (delta 0 on 89- and 831-message sessions).

- On a fork it reconciles in **two halves**: `carriedOver: false` items → `enrichment.usage`, `carriedOver: true` items → `enrichment.carriedOverUsage`, exactly. (Verified on `c0f70eda`, and with an empty second half on `0f5b1c8b`; both since swept.)
- A turn with a long tool run: the collapsed run carries its own pill, expanding moves one pill onto the first call of each message, and no message may be counted at two levels.
- `claude-haiku-4-5-20251001` must price at the `claude-haiku-4-5` rates — not "—", never $0.000. A model with no row must read "—" and appear in the price editor in amber.
- A subagent (`?agent=`) shows its own total in the drawer header — part of the SESSION total, not of the `this conversation` row — and its popover must read **cache write (5m)** at 1.25× input where a session's reads **(1h)** at 2×. The 1h rate on a subagent pill means the TTL split was lost.

**12. Context.** `f3384d17`: 4 snapshot panels, 2 compaction panels, **no ANSI escapes anywhere**. In each panel the non-deferred categories sum to the reported total (gap 0 or ±100 from rounding) and the model keeps its `[1m]` marker. The curve shows 3 shrinks, 2 tied to a boundary and one labelled as having none. `3b326b6c`: 0 panels, 0 shrinks, first three `ctx` pills 54,612 → 55,416 (+804) → 65,736 (+10,320). **No percentage of the window outside a `/context` panel** — one there means somebody assumed a limit.

**20. Re-cached context.** Three readers must agree, and that is arithmetic: drive `buildContextIndex` + `summariseRecache` over `/api/sessions/:id`, and per session the viewer's `recachedTotal`, the sum of per-turn `recached` and the sum of `enrichment.daily[*].recachedByModel` must be **identical** — 13,583,099 tokens, 56 events, across 108 sessions, zero mismatches. They diverge as soon as one stops treating a request as "the first line of a `message.id` that carries usage", lets a carried-over line score an event, or measures the gap from a message's first line instead of its last chunk.

- `f3384d17` #248 — the big clean one: 818,840 tok, ≈$16.38, `ttl-expired`, "82 min since the previous request".
- `b343d4ac` #236 — the partial loss `read === 0` could not see: read 21,138 survives, 437,535 re-written, ≈$4.38, `unknown` at 7 min.
- `797db462` — `model-changed` at #11, and at #44 a cache written **16 s** earlier that is not reused: the case that must NOT be dressed up as a TTL expiry.
- `432b1d41` — its only event sits right after a `compact_boundary`, so it must report **none at all**.
- `3b326b6c` — clean end to end: no amber pill, no `↳ of which re-cached` row, no tick on the curve.
- Rendering: `renderToStaticMarkup` over `TurnList` (a `QueryClientProvider` with `['prices']` seeded, a `MemoryRouter`, and a Node loader stub for the `.css` highlight.js pulls in) must give exactly **two `↺` per event** — turn badge and message pill — so `b343d4ac` gives 12 and `797db462` 18. Sessions with compactions give fewer because folded segments render nothing, and `expandSegments` runs from an effect, so SSR will not change that.
- After a `CACHE_VERSION` bump: `/api/meta` must read `cacheHits: 0` with `enrichedCount` at the full session count, and the `enricher` log must be clean.

## Parsing the tree

**11. Replayed lines.** Fixture today: `f3384d17` (18 duplicate uuids). The historical cases were `0f5b1c8b` (2,072 lines → **7 "earlier context" headers, not 9**), `cae7f9f5` (17,678 → **19, not 42**) and `1decb824` (26, text only, no duplicated boundary). No header may date backwards, none may hold prompts with no answer, and every collapsed header must quote the compaction that really closed it (the last of `0f5b1c8b`: 12 prompts, 12/08 11:44:21 → 12/08 14:31:19, 642k → 9.0k). **No assistant item may carry the same text block twice** (108 did). And the guard that says the fix took nothing real with it: the four token totals identical before and after, and no `message.id` appearing only in a replay.

**16. Forks and rewinds.** The fixture was `c0f70eda`, branched off `0f5b1c8b` and then rewound twice; both are gone, so make a fork on purpose and check:

- `ancestry.forkedFrom` on the child AND `descendants` on the parent — the link is written when the CHILD is enriched, so check both ends.
- `runIds` shown as "resumed ×N" and **never** as lineage.
- `usage` holding only what was spent after the fork, `carriedOverUsage` the copied tokens (`c0f70eda`: 55,432 written against 1,066,693 carried over).
- A session rewound twice renders **two** "rewound away" folds, not one (`c0f70eda`: `eff860cf`, 9 turns 15:21:24 → 15:34:50, then `558b670e`, 2 turns 17:38:45 → 17:39:08). One fold spanning both means the branch identity was lost. Nothing inside either may appear in the page until its fold is opened, and the live conversation must not read as answering them. **The find bar counts what is inside them and opens the branch on arrival** (check 26) — which is the one way that text is allowed on screen without a click.
- **The corpus-wide guard, which is what catches a wrong tree: no session may lose a large share of itself.** `0f5b1c8b` had to keep 6 compaction panels and 0 folded turns (44 orphan tool-results, none a whole turn) and `cae7f9f5` 0; either going to 99% meant the `logicalParentUuid` bridge, the last-occurrence resolution or the boundary rule had broken. Run the equivalent over whatever sessions carry compactions today.
- The mixed case (`e663c8d5`: one turn with 18 of 21 messages cut away) shows the inline "rewound away" notice and **no** fold header.
- The viewer can be checked without a browser: `renderToStaticMarkup` over `TokenPanel` + `TurnList` against the real payload (a `QueryClientProvider`, a `MemoryRouter` and the `.css` loader stub) and count the strings.

**17. Injected user lines.** `1decb824` had to report **12 prompts, not 92**, and `cae7f9f5` **56, not 108**. The blocks must also be absent from the search index: a phrase existing only inside one (part of an `<output-file>` path, say) gives 0 hits normally and is still found by the deep scan. In the viewer: a bordered notice panel carrying the block's own summary, **no raw `<task-notification>` XML, no `tool-use-id`, no user bubble**. The panel OPENS the turn, so it hosts the turn's cost/context badges and its own timestamp — badges on a right-aligned row above it, or the date reappearing on the fold strip below, mean the turn stopped recognising the notice as its opener. A real prompt beside it must still be a user bubble; if prompts vanish, the `origin.kind === 'human'` test is inverted.

**Queued prompts, the same check from the other side.** The corpus-wide diff settles it: run the real `parseTranscript` over every transcript before and after, and **only the sessions holding one may move, by +1 prompt each and NO extra turn** — `15a86025` 6→7 prompts in 12 turns, `9ef9f798` 17→18 in 19, `b343d4ac` 30→32 in 33, everything else identical to the item. Nothing may gain a `notice`. A growing turn count means the prompt started a turn instead of joining one.

- In the browser: the queued bubble at the answers' own left edge (378 px against a prompt's 352 at 1600 px wide), sharing ONE rail with the answer before and the answer after; folded, still there and still indented.
- `15a86025` is the readable fixture: "No te dejes nada" as a user bubble with a `queued` chip, timestamped **13:44:06, before the answer above it**, and found by the search (0 hits before the fix, in a session whose prompt the Prompts page was already listing from `history.jsonl`).
- `9ef9f798` proves the tree still decides: its queued prompt sits in a rewound-away branch, so it must come back `discardedBranch: f337bae4` like the six answers below it, and fold with them.
- `980751cb` is the control — 32 notifications between it and `b343d4ac`, and **not one may become a prompt**: 16 notices, 5 reports, 0 queued items, 0 chips.

## Subagents, plans and questions

**22. Subagents.** Start with the join, because the panel is only as good as it: over the whole corpus **every** `meta.json` must find the call that sent it out (31 of 31, across 9 sessions), while only 25 have a report — the truthful number, not a miss.

- `980751cb` catches the queued envelope: 5 agents, 5 reports of which **3 arrive as `attachment` lines**, plus **11 notices that are NOT agents'** (background commands, 9-character ids) which must never appear as rows. `b343d4ac` is the same trap from the other side (5 agents, 1 report down the `user` path). `19ebb1d5` is the failure case (6 agents, 4 `failed`). `9ef9f798` is the honest gap (3 agents, **0** reports, 2 notices belonging to background commands): those rows read "no report" with the ↓ button disabled and the reason on it, never a guess.
- In Chrome over CDP on `?agents=1`: statuses in the right colour; `↑ the call` lands on `[data-tool-id]` with `.match-flash`, leaving only a handful of tool blocks in the DOM (3 of the 987 in `980751cb`, whose Agent calls sit inside a compacted segment that has to unfold first); `↓ the report` flashes the notice panel; **pressing either a second time must jump again** (that is `jumpNonce`). Opening a report fold must NOT collapse the turn under it — count `[data-bubble]` before and after. `Async agent launched successfully` must be absent from the page, a collapsed run must read `⑂ N subagents`, and the ⑂ badge in the list must land on `/session/<id>?agents=1` without triggering the row's rename or pin. Esc unwinds file → drawer → panel → back. A session with no subagents shows no button, no badge, and makes no `/subagents/` request.
- **The cost is arithmetic**: per session with agents, `enrichment.subagentUsageByModel` priced with `computeMessageCost` must equal the sum of pricing each assistant message of each `/api/sessions/:id/subagents/:agentId` the same way — the server's streaming aggregate against the browser's per-message path, 10 of 10 sessions, worst delta **2.7e-15** — and `daily[].subagentByModel` must add up to the same figure. `15a86025`: **$1.49 own + $10.53 in 11 agents = $12.01**, the list row reads `$12.01 ⑂` with the split in its tooltip, and the token panel shows three rows (`sonnet-5`, `⑂ 11 subagents`, `session total`) with no redundant subtotal. `f3384d17` has four rows plus `↳ of which re-cached` and the compaction caveat ("Not in any of these figures: the 2 compactions"). A session with no agents shows neither the subagent row nor the `session total` row. In Stats, the ≈ Cost card moves by exactly the corpus subagent total ($45.19) while the re-cached percentage keeps its parent-only denominator (10.8% of session spend, not 10.5% of everything).
- **Nesting: `15a86025`** — 11 agents, **7 `fork` at depth 1 and 4 `general-purpose` at depth 2**, all four spawned by the fork "Investigar lib, list, pages y hooks web" ($4.30). Those four must be indented **under that row and nowhere else** (`marginLeft` on exactly 4 of the 11; 0 of 5 in `980751cb`, 0 of 6 in `19ebb1d5`), carry their own `sent` / `→ back` times and `brief` / `report` folds, read `sent out by ⑂ fork · …`, carry the status of the report filed **inside that agent** (`completed`, not "no report"), and send both jumps to the PARENT's drawer — `↑ the call` onto its `[data-tool-id]` with `.match-flash`, `↓ the report` onto the notice panel — with the URL showing `agentTool=` / `agentMsg=` and never both. **Check the flash within 2.5 s**: it takes itself off, and looking at 3 s reads as "nothing happened". Those four reports exist only because a notification inside a subagent transcript is `isMeta: true`.
- **Ids**: every row and the drawer header prints the 17-hex id, and pasting it — whole or as a prefix — into the search returns that session with an `id` row linking to `?agents=1&agent=<id>`.
- **The notice panel now has a `[data-bubble-body]`**, so re-run the `[data-bubble]` count around opening a report and the `↓ the report` flash. Marks must land inside that body — a deep link used to paint the origin chip, the status and the clock along with the text — and the report opens itself when the find bar steps onto it, which is a report's only route into a search of any kind.
- **It also lost its `onClick`**, which folded the turn in prompts-only mode. Clicking a notice must now change no fold at all — count `[data-bubble]` and `[data-tool-id]` before and after — and must select it instead. Its cursor must not be `pointer`.

**23. Plan mode.** Parse first, comparing before and after over the whole corpus: only `items` may move, only in sessions that touch plan mode, and by exactly the number of markers emitted (`f3384d17` +7 = 2 enter + 1 reentry + 2 exit + 2 reference; `980751cb` +3). **Turns, prompts and the four token totals identical everywhere** — a turn that grows means a marker opened one instead of joining the one already open.

- `b343d4ac` is the readable fixture: enter 17:55:04 (`planExists: false`) → `toolu_01CyGpmXFjFcBj8apDVmAXck` **rejected** with the feedback *"Las pruebas que hagas hazlas siempre con haiku o sonnet…"* → `toolu_014qndvKLoC1hKQ6JMiW1MhD` **approved**, 16,894 chars, saved to `lexical-swimming-tulip.md` → exit 18:21:35 (`planExists: true`). It holds **four** `plan_mode_exit` lines and exactly **one** may render; four means the open-entry gate is gone. The collapsed header reads the plan's own `# heading`, never stringified JSON.
- In Chrome: two cards with the right verdicts, the fold opening real markdown and **not** collapsing the turn, fold headers that are divs holding nothing interactive, no raw JSON on the page. A session with compactions shows fewer, which is right.
- Search, after a `CACHE_VERSION` bump: `/api/meta` reads `cacheHits: 0` with every session enriched; a phrase living only in a plan returns `plan` rows anchored on their own `ExitPlanMode` call; `in=user` drops them; and **the arithmetic closes both ways** — `pageMatches` equal to `matchCount` indexed AND with `deep=1`, deep still a superset. Deep counting one plan twice means an echo is back (the call input, or the tool_result after `## Approved Plan:`).
- `/api/plans`: the disk state is the column that earns the page, and `quiero-que-planifiques-la-playful-pearl.md` proves it — two approvals a day apart, only the second may read `on disk`. **Do not compare `stat.size` to the recorded length**: bytes against characters, and these plans are Spanish (12,299 chars, 12,546 bytes), so the shortcut reports every surviving file as gone.
- The composer half (see the two rules above): send with `permissionMode: plan` and the status must report it with **no restart** (same pid before and after). Provoke a real `ExitPlanMode`: the panel renders markdown, not a `<pre>` of JSON, and *Keep planning* with a note must come back as the feedback the card prints under "the user said" — that round trip is the two halves of the feature meeting. Reopen the session: the picker opens on the mode the transcript left. Then `pnpm stop` and confirm the spawned pid is gone and every other `claude.exe` untouched.

**24. Answered questions — drawings and notes.** Parse first: `toolUseResult.annotations` must reach `ToolResultInfo.annotations` on `AskUserQuestion` blocks and **no other tool** (26 annotated questions, 23 previews, 4 notes, 3 `(notes only)` answers, 0 leaks). Option previews are counted off the tool INPUT: `edacebe6` has 3 in the input and 0 in the echo, so its folds going to 0 means someone started reading the echo. `summarizeInput` must name the question rather than stringify the array — a collapsed tool header of kilobytes of box-drawing means that case is gone.

- The card is `renderToStaticMarkup` over `AnsweredQuestionPanel`, no providers needed. `e95a1a42`: 4 questions, every option previewed, **10 `sketch` folds and 0 open `<pre>`**. `825f06f6` and `e36007b6` are the `(notes only)` cases — the string `(notes only)` must **not** appear in the HTML, the real note must, and no `typed instead` row anywhere near it. `a46fc22a` is the note beside a pick: `answerSummary` must read `… (+ a note)`. `980751cb` keeps its picks-plus-typed row and `797db462` its two declines.
- In Chrome over CDP: open a `▸ sketch` and the `<pre>` must hold the transcript's `preview` **character for character** — check one 114-column line and the two drawings containing ``` inside the box (mangled means it went through `Markdown`). It scrolls inside itself, never the page. Drag-select inside the fold header and release: it stays open (`hasSelection`). The card still does not fold, the call's `?tool=` link still opens exactly that block, and the `▸ sketch` sits on the option's OWN row at its right-hand end (same `top` as the label, ~9 px from the row's right edge).
- **The grid is arithmetic, not eyesight**: measure each framed line with a `Range` and compare pixel widths. Every drawing rectangular at the source — a code point 1 cell, an emoji 2 — must render within 1 px of flat: **23 of 23 across the 14 sessions that hold a drawing**, where before `monoCells.ts` only 6 did. The other 19 framed drawings are crooked in the transcript, and a spread of exactly one cell (6.05 px at 11 px) there is the RIGHT answer. The span surgery must leave the text alone: `pre.textContent` and a real `getSelection().toString()` must both still equal the `preview` exactly.
- **The composer's half needs no browser**: `askedAnswers` against the shapes the corpus holds — a label containing a comma kept whole, a multiSelect as `"Uno, Dos"`, picks with typed text appended, `(notes only)` for a bare note, an annotation omitted where there is neither preview nor note, a question never asked dropped. Then feed that payload back into `parseAskUserQuestion`: picks, typed text, note and `notesOnly` must come back unchanged. That round trip is the whole contract between the two halves; the live turn (check 19) is only needed to prove the CLI still honours `updatedInput.annotations`.

**25. Starred messages.** The storage is the half that can lose something, so start there. Star a prompt and an answer, then **rename any session** and confirm the stars are still in `userdata.json` alongside `titleOverrides`, `pins`, `prices` and `settings` — `saveUserdata()` writes the whole file, so a key missing from its literal disappears at the next write and nowhere else. `POST /api/cache/clear` must keep them too.

- **The copy is the point**: `GET /api/starred` must answer with the text, ordered newest-first by the message's own clock, **making no `parseSession` call at all** — the log is the proof. Only the `PUT` parses.
- **The canonical uuid is what gets stored.** Star a streamed answer *by one of its `aliasUuids`* and the record must come back keyed on `item.uuid`; unstarring by that alias must then report `removed: false` rather than claiming a removal (the app only ever sends the canonical one, and its ★ must survive a reload).
- Error paths with curl: cross-site 403, a bad session id or message uuid 400, a non-boolean `starred` 400, an unknown session or a uuid that is not in that session 404 — and **`starred: false` on a session that is not in the index must succeed**, or an orphaned star could never be deleted.
- In Chrome over CDP: both roles show a filled amber ★ with the pointer elsewhere and `aria-pressed="true"`; unstarring from the bubble drops it server-side and leaves a hollow ☆ whose computed `display` is `none`; the drawer of a session with agents (`?agents=1&agent=<id>`) draws its messages and **zero** star buttons; and the page must make exactly **one** `GET /api/sessions/:id` — a second one means starring re-parsed the transcript.
- **The link has to land**: star the FIRST prompt of a session with compactions (`f3384d17`), then follow *Open in the conversation* from the page. That message must be absent from the DOM beforehand (it is folded into a compacted segment) and afterwards the `[data-bubble]` holding it must have taken `match-flash`. **Record the class with a `MutationObserver` set before the click** — it takes itself off after 2.5 s and arrives at the end of a five-deep chain of state updates, so polling for it fails in both directions.
- **The clamp is measured, not guessed**: a row whose `scrollHeight` exceeds the clamp offers `… more ▾` and expands past it; one that fits offers nothing (checked at 3,068 chars against 1,218). An answer renders through `Markdown`, a prompt as `whitespace-pre-wrap`.
- **Order and grouping** (both pages): descending puts the newest message first; `Group = Session` gives one header per session **ordered by each session's newest** starred message, with the counts adding up to the flat total; `↑` reverses groups and members together; and the choice survives leaving the page and coming back (`localStorage`, not the URL).

## The viewer's own machinery

**26. Find in the conversation.** The arithmetic first, no browser
(`node --experimental-strip-types`, or the repo's own `tsx` — `findInSession.ts`
is pure) over real `GET /api/sessions/:id` payloads.

- **`foldText(raw) === folded` for every unit**, and the last segment's end is
  the folded length (1,479 units in `f3384d17`, 1,223 in `980751cb`). That
  equality is what lets `hitSnippet` rebuild the fold map on demand instead of
  carrying 8 bytes per folded character for the life of the session; break it and
  every snippet is cut at the wrong place.
- **Offsets rise and ordinals are contiguous from 0 within a unit**, and
  `byRole` sums to the hit count. Turning a chip off must subtract exactly its
  own count and nothing else (3,022 of 3,189 for tools on `f3384d17`).
- **Against the server, on prose they both hold**: the client's `assistant`
  count must equal `matches?in=assistant` — "session" and "transcript" give
  16=16, 31=31, 3=3 and three 0=0 over the three largest sessions. A difference
  means one side stopped folding the way the other does.
- **The pairing that justifies the feature**: a string living only in an inline
  tool result is found here and returns 0 sessions from the indexed search.
  **Choose that string by the property, never by name** — this repo writes about
  its own transcripts, so a token that was tool-output-only lands in somebody's
  prose sooner or later and a hard-coded one stops testing anything the day it
  does (`TS2353` lasted about a week). Walk the session's tool text, take the
  first token `/api/search` answers 0 for, and assert the client finds it. And
  the honest gap the other way: `NOTION_TOKEN` in `4a1483ba` must give **0**
  here, with the bar's own note reporting the offloaded and truncated outputs it
  cannot reach.
- **Recorded cost, so a regression shows**: building the corpus is ~40 ms for
  2.04 M folded characters and ~50 ms for 2.42 M; a scan is 1.4–48 ms; and a
  one-character phrase (`a`, 121,893 occurrences) must stop at `MAX_FIND_HITS`
  rather than collect them.

Then Chrome over CDP, with check 9's harness:

- **The whole point, in one assertion.** Pick a word from a tool result that is
  nowhere in `document.body.innerText` at rest — folded away, so the browser's
  own Ctrl+F could never reach it. Ctrl+F must open the bar with the input
  focused and typing it must leave `scrollTop` **unchanged**. The bar opens on
  `Visible`, so the counter must read `none in visible` — never "no matches",
  which would be the lie this whole feature exists to stop — with a button
  offering `N more in the whole conversation`. One click on it, and Enter must
  open the run and the block and leave exactly one `find-current` range reading
  that word, inside a marking box and inside the viewport. (Verified on
  `f3384d17`: "instruction", 7 matches, scrollTop 0 → 564.)
- `search-match` must be absent throughout, and
  `document.querySelectorAll('mark').length === 0` — a `<mark>` means somebody
  went back to mutating React's markdown. Escape must take `find-match`,
  `find-current` and every `[data-find-scope]` with it.
- **Wrapping, from the top**: 1 of N, and Shift+Enter from there gives N of N.
  From anywhere else the first Enter lands on the first match at or below the
  reading position, which is the point of `fromReadingPosition` and the thing
  that broke when folded hits were skipped for having no element (it opened at
  the ninth of 113 with the page at the very top).
- **The three scopes**: All ≥ Visible always; opening the runs by hand raises
  Visible without moving All (17 → 29 of 113 on `b343d4ac`); `Current message`
  is disabled until a box is selected, then narrows to it with exactly one ring
  on the page.
- **The selection drives the scope, and never into `All`.** Opening with a
  message selected must land on `Current message`; clicking the empty gutter
  must fall back to `Visible` and disable `Current message`; selecting again
  must return to `Current message`. **`All`, once pressed, must survive both** —
  deselecting and selecting something else — and only closing and reopening the
  bar lets go of it.
- **`Ctrl+Shift+F` opens on `All`** with a message selected and with none, and
  leaves the selection alone; plain `Ctrl+F` afterwards must go back to
  following it.
- **The scope always explains itself**, in a sentence under the bar, and the
  `N more in the whole conversation` button sits BESIDE that sentence rather
  than replacing it. The two reach notes carry a `title` each, because "3 long
  outputs searched only in part" is not self-evident.
- **Every row in the panel leads with a clock**, before the role, short in the
  row and full plus relative on the hover.
- **Selecting works with the bar shut**, which is the point of it being its own
  feature: click a bubble on arrival and `[data-selected]` must be on it with
  the ring drawn, click the empty gutter and it must go. And **a deep link
  leaves it selected**: follow `?msg=`, wait out the 2.5 s flash, and that
  message must still be the one and only `[data-selected]`.
- **The ring repaints the tail**: `[data-selected] > [data-bubble-tail]` must
  have the accent border, or the tail's opaque fill punches a notch in the ring.
- **A click must cost nothing.** With every tool run open, click eight bubbles
  under a `longtask` PerformanceObserver: **no entry at all**. Before `TurnList`
  was memoised this was 65-110 ms every time, on `f3384d17` and `980751cb` — so
  a regression here is a prop that stopped being memoised (`fold`, `footer`,
  `pending`), not a change to the bar.
- **The seed**: arriving at `?hl=…&hlw=1` and pressing Ctrl+F must open the bar
  on those words with whole-words already on, and must never write them back.
- **The gates**: Ctrl+F must NOT open the bar while `?agent=` has the drawer up;
  Escape with the file panel open closes the file and leaves the bar open, and a
  second Escape closes the bar.
- **A live session is the one part a test cannot fake.** `refetchOnWindowFocus`
  is off on the client, so only a transcript really growing invalidates
  `['session', id]` — run this from inside a live Claude Code turn, as check 18
  does: with the bar open, `M` may grow, the reader must stay on the same match
  and `scrollTop` must not be yanked. What CAN be provoked without one is the
  half that actually breaks a mark — React re-rendering the whole conversation
  and throwing away the text node the range pointed into — by toggling
  Compactions or Thinking twice. Checked: same scrollTop, same "1 of 113", same
  marked text afterwards.

**18. The working indicator** needs a genuinely busy session, so run it from inside a live Claude Code turn: `/api/live` carries `status: "busy"` and a `statusUpdatedAt` matching the turn's start, and the page holds one `[data-bubble="assistant"]` reading `Claude is working… <counter>`, the counter advancing by exactly the seconds waited. A session that is not live has none.

- **The three clocks**, in the same run (the agent's own session is the fixture — it is busy by definition): `[role="status"]` reads `Claude is working… <turn> · last message <n> · last tool <n>`, all three advancing by exactly the seconds waited, each carrying its absolute time in a `title` (`Turn started …`, `Last message landed …`, `Last tool called …`), and the last one ending INSIDE the bubble at a 520 px viewport — where `document.documentElement.scrollWidth` is 946 with or without the indicator, so the sideways scroll there is the app's layout and not this row.
- **`turnActivity` needs no browser**, and the branches real data will not hand over on demand are the point: a turn holding only its prompt must give two nulls (or the row would print the turn's own figure twice), a `queued` prompt mid-turn must count as a message, a `discardedBranch` item must not count at all, and a turn ending in prose over a run must put the two figures apart. Against real sessions, feed it `GET /api/sessions/:id` — `49fe48e9`'s last turn was 8 s apart, `cbec71b1`'s 19 s.

> **Headless Chrome reports `prefers-reduced-motion: reduce`**, so the reduced branch is what runs by default and `getAnimations()` says nothing about the real one. Emulate a real user first: `Emulation.setEmulatedMedia` with `prefers-reduced-motion: no-preference`. This will otherwise waste an hour.

**Both branches must move**, measured as the computed `transform` / `opacity` sampled every 150 ms, not as the presence of an animation. Normally the dots rise to −4.8 px, scale 0.85→1.14 and breathe 0.3→0.98 out of phase, while `working-shimmer` walks the label's `background-position` (112% → 20%) with `-webkit-text-fill-color: transparent`. Under `reduce`: **no rise and no scale at all** (y = 0, s = 1), opacity still travelling 0.36→0.9 staggered, label back to a solid `--text-dim` with `animation: none`. A frozen indicator in either branch says "nothing is happening" while something is. Read the transform as text — `new DOMMatrix(getComputedStyle(el).transform)` throws on a computed `none` instead of giving identity, which silently reads as "the indicator is not there".

**27. The foot of the conversation** — the follow pill, the sticky composer and the scroller under it. Geometry, so it is read off `getBoundingClientRect` in Chrome over CDP rather than by eye ([AI_VIEWER.md](AI_VIEWER.md#the-end-of-the-conversation) for why each number is the right one):

- The scroller's `bottom` and the composer's `bottom` must both equal `innerHeight`, the composer's computed `position` must be `sticky`, and the pill must sit 16 px off the foot of the window — with a session **short enough not to scroll** as well, where `scrollHeight === clientHeight` must still hold (the sticky box must not invent a scrollbar) and the pill must be on screen anyway, reading `To the end`.
- **The pill must never cover `Send`**: check the two rects do not intersect at the default width AND at `Full` (`localStorage.threadWidth = 0`), which is the case that fails — and at `Full` the row's own right padding is what moves the button aside.
- **Switching the follow off must survive the next message.** With the pill reading `Following`, click it, then change the content's height under it: insert an 800 px div before `[data-sticky-bottom]` (growth fires no scroll event) and remove it again (the shrink makes the browser clamp `scrollTop`, which is the event that used to re-arm it). The label must read `To the end` through both, and `distance` must be 0 — it never moved, it just stopped following.
- The other three states, same way: scrolling 2,000 px up must let go, `scrollTop = scrollHeight` must arm it again, and while following, 900 px of new content must leave `scrollHeight - scrollTop - clientHeight` at 0.
- **The last message must be readable, not merely present.** At the end of a session, `[data-bubble]:last-of-type`'s `bottom` must equal the TOP of `[data-sticky-bottom]` — the gap the fade is drawn over, not the top of the box — or the gradient is eating the last line. Then type six `Shift+Enter` lines into the textarea: the composer's height and `scrollTop` must grow by the SAME number of pixels (measured: 119 → 255 and +136), the last bubble must still sit against the top of that gap, and `distance` must stay 0. **Do it a second time with the follow switched off**, which is the case pinning cannot cover: same result, and the label must still read `To the end` — the view moved, but not because the reader moved it.
- **A live or busy session must open on `Following` with `distance: 0`** (run it against your own session, which is live by definition), and the SAME session opened at `?msg=<uuid>` must open on `To the end` instead, standing where the link says.
- **The badge counts what lands while the follow is off**, and only a session that really grows can show it: run this one from inside a live turn of your own session. Open it (it opens on `Following`), click the pill to `To the end`, then poll every 3 s. Measured over one turn: 1 → 10 with the title tracking it (`7 new messages below`), `scrollTop` frozen at 4982 the whole way while `distance` climbed to 825, and the badge riding 5 px off the pill's top-right corner — the same overhang as `UpdateButton`'s, which is where the shape comes from. Clicking the pill must clear it, arm the follow and land at `distance: 0`. The count may go up without a new `[data-bubble]`: a message that is all tool calls draws a run instead, and it is still a message.
- **The page must not tremble when a message lands, and the numbers say whether it did.** From inside a live turn, sample the scroller on every `raf`, `scroll` and `ResizeObserver` tick (`scrollTop`, `scrollHeight`, `clientHeight`, and `[data-sticky-bottom]`'s `bottom - innerHeight`). Then: **`clientHeight` must never change** — it moved 762 → 784 → 762 twice per message before the header was made to hold its figures, and a single change means something above the conversation is coming and going again; each growth must show exactly one correction, the `ro` tick landing 1-3 ms after the `raf` that saw the taller content, so it is the same frame and nothing paints uncorrected; and the composer's offset must stay 0 throughout, or the sticky box is lagging behind the scroll. Do it while following, which is the case that moves.
- **The spinner tracks the turn, not the footer**: `.turn-spinner` must exist in the pill while `/api/live` says `busy` (the arrow is gone — one 12 px box holds both, so the pill must not change width) and must be absent on a session that is not live. Also check it survives the reduced-motion branch as a moving thing: under `Emulation.setEmulatedMedia` `prefers-reduced-motion: reduce`, `getComputedStyle(el).animationName` must be `working-dot-soft`, never `none`.
- The find bar over this layout (check 26's harness): step onto a match and `find-current`'s rect must be above the composer's `top`, not merely inside the scroller.

**21. The file viewer.** `fileRefs.ts` is pure, so start without a browser (`node --experimental-strip-types`). Must parse: `server/src/app.ts:12`, `app.ts:12`, `x.ts:12:5`, `a/b.cs#L59-L60`, `C:\Users\…`, `\srv\share\x.ts`, and `Actualizacion%20Base%20de%20Datos%202.0/sentenciasSQL.bas:6648` (decoded, with its spaces). Must give null: `https://github.com/x/y.ts`, `mailto:`, `javascript:`, `v1.3.2`, `2.1.222`, `api.anthropic.com`, `/logs`. And `formatFileRef(parseFileRef(x))` must give back `x`.

- `20a73271` (DistribVB6_0) is the fixture: 26 links in one session, `ActualizadorVersion/frmActualizador.frm` at 1,086 lines (the stripe) and `Actualizacion Base de Datos 2.0/sentenciasSQL.bas` at 376 KB (the "syntax highlighting skipped" note).
- In Chrome over CDP: every `.prose a` either carries `data-file-ref` or points at a real URL (**none may be left holding a bare path** — the original bug); a click adds `?file=` WITHOUT navigating; the gutter holds 1,087 rows; the stripe sits at exactly `(line-1)*18` px inside the scroller's visible band; Esc closes it. Point `?file=` at something that never existed: the panel must name the launch folder it resolved against and disable the three open buttons.
- Chips: with `Tools (N)` expanded, the count of `📄` equals the number of Read/Write/Edit/MultiEdit/NotebookEdit blocks and is zero on every other tool (80 of 148, none of the other 68); none sits inside a `[role="button"]`; the header still folds.
- Server half with curl: bad session id → 400; `Sec-Fetch-Site: cross-site` → 403; missing path → 200 with `exists: false`; a directory → `isDirectory`; `node.exe` → `binary`; a 16 MB transcript → `truncated` with no `\uFFFD` at the cut.
- **The launchers cannot be checked by eye — ask Windows**: `POST /api/files/open` with `target: "folder"` on a path containing spaces, then enumerate `Shell.Application`'s windows; folder AND selected item must both be right. That is the `/select` quoting trap, and it fails silently otherwise.

## Running Claude

**8. Auto-reload.** Point it at a throwaway folder and drive the config errors through `PUT /api/settings` — missing folder, a file instead of a folder, relative path, empty message, unknown model — each must come back in `configError`.

- "Send it now" answers in a few seconds and logs the reply, then flips to "started a window" on its own about a minute later without touching the page. The useful part cannot be scheduled: read the log viewer (source `auto-reload`) afterwards.
- Press it twice: the second press must be refused **with the reason next to the button** ("a message is being sent right now"), and pressing again straight after the first finished must go through. No wait may ever leave it disabled and silent. Refusals are logged too, so `"Send it now" refused` answers "I pressed it and nothing happened".
- **The no-floor rule without waiting five hours**: press it while a window is running. The log must read `the window was already running, so a reload is still due at its expiry`, the panel must *not* say "started a window", and `nextCheckAt` must land on that expiry + 1 min — never on the send + 30 min.
- Toggle `autoReloadHideSessions` against a folder that HAS sessions: `/api/sessions`, `/api/projects`, `/api/prompts` and `/api/search` must all drop together and come back.

**19. Sending a prompt from the app.** The two rules above apply first. Make a throwaway session (`claude -p "Reply with exactly: FIRST" --model haiku --output-format json` in a temp folder gives you its id), then drive the API with curl:

- a cross-origin POST → 403, a same-origin one → not; `blockedReason` names the reason while `chatEnabled` is off; a prompt goes `starting` → `working` → `idle` and lands in the SAME `.jsonl` the session already had; two prompts back to back show `queued: 1` and run in order. The `chat` log tells the whole story and is the fastest way to read it. `--resume` does NOT stamp a different `session_id`, so no "resumed ×N" appears for these.
- The browser half over CDP: the composer renders, typing and clicking Send lights `[role="status"]`, the answer text appears, `[data-bubble]` count grows, and the indicator goes out on its own.
- **The question path is the one worth checking hardest**, because it is why the SDK is here. "pregúntame si prefiero rojo o azul": the dialog appears with Claude's own options, `Answer` is disabled until one is picked, and answering closes it and lets the turn finish. Then what a question carries beyond its labels — ask for a comparison of layouts ("enséñame dos diseños de cabecera con bocetos y pregúntame cuál prefiero") or the drawings never arrive: the sketch column appears beside the list and follows the option under the cursor; a pick **and** a note must reach the transcript as `answers[q] = "<label>"` with `annotations[q].notes` beside it; a note with nothing picked writes `(notes only)`. **Read the `.jsonl` afterwards rather than trusting the panel** — that line is the only proof the note reached Claude, and a regression in `updatedInput.annotations` shows up here and nowhere else. Reload the session last: the card must show the same note and the same `▸ sketch`.
- Packaging: `pnpm package`, extract the zip, run `versions\vdev\node\node.exe versions\vdev\server.cjs --port 7434`; it must index and answer. That is where a missing `import.meta.url` shim surfaces, before any user sees it.
- Orphans: with a turn in flight, `pnpm stop`, then compare the `claude.exe` pids noted before and after — the one you started gone, everything else untouched.
- **The collision guard needs a real terminal**: `cmd /c start` minimized never gets far enough to register a session (the process exists, `~/.claude/sessions` gains nothing). The cheapest fixture is the terminal you are already working in — your own session is open in one, so `GET /api/sessions/<your-own-id>/chat` must carry the block and a POST there must 409 (`entrypoint: "cli"`, `status: "busy"`, against the composer's `sdk-cli` with no status at all). Otherwise use "Resume in terminal" and close the window by hand.

## Platform and plumbing

**6. Installer.** `pnpm build && pnpm package -- --version 0.0.1`, extract the zip to a temp folder, run `install.ps1` (stop any dev instance first — same port), verify the task in `taskschd.msc`, check `Stop-ScheduledTask` frees port 7433 within ~5 s, `launch.vbs` cold-starts it, and `uninstall.ps1` removes task + shortcut while keeping `%LOCALAPPDATA%` data.

**7. Update, end to end.** Needs two published releases: install the older, wait ≤10 min (or "Check now") for the badge, apply, then check `update.log` and the `versions\` pruning. Afterwards **the daily log must tell the whole story on its own** — filtered by `updates,update-helper` you should read the click, every download attempt, the checksum, the tar exit code, the helper registration, the junction swap, the health check and the result, in order, with no gap where the server exited.

The parts that need no release:

- the resumable download against a local HTTP server that drops the first attempt mid-body — it must resume with `Range` and end byte-identical;
- `updateLogImport` against a hand-written `update.log` (levels, original timestamps, a second pass importing nothing). **Write that file the way the helper does**: run its `Log()` under `powershell.exe`, **not** pwsh, against a root containing `ñ`, then check the first bytes are not `ef bb bf` and that the imported records still carry the `ñ`. Call `initLogging` at a temp dir first, or the test's own fake lines land in the real daily log.

**13. Executable resolution**, which cannot be checked from this machine's own profile (`Edgar` is ASCII, and a pwsh console hides the bug anyway): put any exe named `claude.exe` in a folder under a path containing `ñ`, point `process.env.PATH` at it and call `findClaudeCli()` — the returned string must be **identical** to the real path (no `�`) and must `spawn` without ENOENT. Clear PATH and it must still be found through the winget / `.local\bin` fallbacks. `whichExe('wtai')` must return the WindowsApps alias that `fs.existsSync` denies. To see the failure the fix is for, run `where claude` under `chcp 850` and compare with `chcp 65001`.

**14. Logs.** `/api/logs/day/<today>` with `level=`, `src=` and `q=` must each narrow the total; `2026-8-1` and a traversal attempt must both 400. Drop a hand-written `YYYY-MM-DD.log` older than the window into the logs dir, save any setting, and it must be pruned. "Delete all logs" must remove today's file too (a `cleared N log files` record recreates it immediately). Fastify wiring cannot be checked without a 500 — add a throwing route temporarily, confirm an `http` error record with the stack, and remove it.

**15. Retention. Never edit the real `~/.claude/settings.json` to test it.** Run a second server on a fake data root (`--data-root <tmp> --port 7434 --logs-dir <tmp>`, and set `CLAUDE_HISTORY_CACHE` too or the fake sessions land in the real cache) holding three transcripts with mtimes at now / −10 d / −100 d. Then rewrite its `settings.json` between calls **without restarting** — the endpoint re-reads the files, which is the whole contract behind the Refresh button:

- no key → `days: 30, usedDefault: true`;
- `7` → the −10 d and −100 d ones expired;
- `0` and `"30"` → `invalidValue` plus `sweepBlocked`, with `days` NOT presented as what applies;
- a truncated file → `sweepBlocked` carrying the parser's own message.

A `.claude/settings.local.json` in the fake project's folder must appear in `projectOverrides` with the project's name, and a broken `.claude/settings.json` beside it must appear too rather than being skipped. On the real root, `lastSweepAt` must track the **mtime** of `.last-cleanup`, not the ISO string inside it — Claude Code rewrites the file at each sweep and the two differ.
