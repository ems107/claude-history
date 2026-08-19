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
| Queued human prompt | `e36007b6` (3), `b343d4ac` (2), `15a86025` (1), `9ef9f798` (1), `bfbdf4c2` (1); **with an image pasted in** (array payload): `c98565c7`, `d2a4e86b` | — |
| Image pasted into a prompt | `9ef9f798` (1.8 MB, the heaviest), `c98565c7` (queued), `6f42e08b` (**an image with no text at all**) | — |
| Subagents | `15a86025` (11, nested), `19ebb1d5` (6, failures), `980751cb` (5), `b343d4ac` (5) | — |
| Rewound branches | by branching parent: `f3384d17`, `1aa6d6db`, `b3e8ad92`, `0dd71f3d` | `c0f70eda`, `e663c8d5` |
| Questions with drawings / notes | `e95a1a42`, `825f06f6`, `e36007b6`, `a46fc22a`, `edacebe6`, `797db462` | — |
| Plan mode | `b343d4ac`, `f3384d17`, `980751cb` | — |
| File references in prose | `20a73271` (DistribVB6_0) | — |
| Files a session only MENTIONED | `1806cedb` (its answers name six paths: four on disk, one `also changed`, one `not found`, plus a folder dropped), `980751cb` (every path it names is a file this checkout does not have, so every row says `not found`) | — |
| Files delivered to the user (`SendUserFile`) | `fbc2e20c` (3 PNGs, `display:"render"`, **files still on disk**), `b343d4ac` (4 calls / 5 PNGs **and** a plan file, so `Sent Files (6)` — the fixture for the panel, with the only `changed since` on disk: `answered.png` is 72515 there against 84918 sent), `15dd6c99` (3 calls, **no `display` field**), `f3384d17` (3 PNGs, **files already swept** — the "gone" state, and the one message that carries a second call), `0dd71f3d` (a `.md`, `isImage:false`) | — |
| A recap longer than `SYSTEM_CHARS` | `aa686022` (465 chars — the only one over 400, of 148 recaps in 56 sessions) | — |
| Clean control (no compaction, no re-cache) | `3b326b6c` | — |

**A fork has to be made on purpose now**: run `/branch` in a session with live context.

**Finding a replacement.** Shortlist with ripgrep over `~/.claude/projects/*/*.jsonl`, then confirm by parsing — a grep also hits sessions that merely *discuss* the field, and this repo's own transcripts are full of those:

```
rg -l '"forkedFrom"'          # forks
rg -c '"compact_boundary"'    # compactions
rg -c '"queued_command"'      # queued lines (prompts AND notifications)
rg -c 'task-notification'     # notifications (noisy — confirm by origin.kind)
ls */*/subagents/*.jsonl      # sessions with agents
rg -c '"name":"SendUserFile"' # deliveries — the KEYED form: the bare string also matches every
                              # session that merely discusses the tool (134 hits, 1 real call)
                              # then Test-Path the attachments[].path — the scratchpad is swept
rg -c '"away_summary"'        # recaps (the LONGEST one is the fixture — measure, do not grep for it)
```

Duplicate uuids (replays) and branching parents (rewinds) need a real parse: count `uuid` seen twice, and `parentUuid` values with more than one child.

## Two rules for any check that runs Claude

Checks 8, 19, 23 and 37 spawn real `claude` processes against the user's subscription.

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
- **A call's stated intent is indexed, once.** A phrase living only in a Bash `description` (`Commit the firewall UX fix`, `bfbdf4c2`) must come back from the PLAIN search — role `intent`, carrying the call's `toolUseId` — and the deep scan must report the same single place, not two: `matchCount` 1, `deep=1` paging 1/1. Then the other side of the same rule: a description that exists only in a **subagent** transcript (`Read CLAUDE.md, copilot instructions, find md files`, `19ebb1d5`) is indexed nowhere, so it must still surface deep, as an `agent` row — stripping it there would lose the only copy. After changing any of this, `CACHE_VERSION` must be bumped or `/api/meta` will answer from a stale index (`cacheHits: 0` on the first restart says it re-enriched).
- **A recap is indexed, drawn whole, and searchable to its last word.** Take the LONGEST `away_summary` in the corpus (`aa686022`'s, 465 characters — re-find it by parsing, it is the only one over 400). Its opening phrase (`Recapping the session state`) → 1 hit, role `recap`, `uuid` equal to the system item's own and no `toolUseId`. Then the point of the whole exercise: a phrase from **beyond character 400** (`pruebes el comportamiento con el ratón`) → **1 hit, plain and deep**, `deep=1` paging 1/1, and the snippet must show the closing sentence entire. Query it folded too (`raton`, no accent) — the same hit, or the fold is not being applied to this corpus. `in=user` drops the row. On the page, that recap must render with **no trailing `…`**, while a `local_command` over 400 characters still shows one. No other `system` subtype may produce a search hit at all.
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
- **The one with an image pasted into it is a second shape, not a second case** ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#queued-lines-attachment--queued_command)): `c98565c7` must show "No sé que has hecho, pero acaba de aparecer este popup [Image #7]" as a queued bubble **with the screenshot under the text**, and the same phrase must be findable — it was in `history.jsonl` and on the Prompts page while the session, its counters and the index had nothing. `d2a4e86b` is the second ("Está saltando el Windows Defender…"). Both come through the same `origin.kind === 'human'` test as the text, so the 55 notifications are still the control for it.

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

**28. Files delivered to the user.** Parse first: `toolUseResult.attachments` must reach `ToolResultInfo.attachments` on `SendUserFile` blocks and **no other tool** — 12 calls, 22 files, 6 sessions at the last count, and 0 leaks over every other tool call of that corpus. **The census only grows** (it read 10 / 19 / 5 when this check was written), so treat the numbers as a floor and the 0 as the assertion; the reliable filter is `"name":"SendUserFile"`, never the bare string, which also matches every session that merely discusses the tool (one here has 134 such hits and exactly 1 real call). `fbc2e20c`'s three sizes are 42352 / 49671 / 49431 and all three `pathValidated`; `0dd71f3d`'s one is `text/markdown` with `isImage: false`. Every file of every call must find its attachment **by path**, so the positional fallback in `parseSentFiles` never fires here — if it starts firing, a Claude Code version has begun rewriting the paths it echoes. `summarizeInput` must name the files: a collapsed header beginning `{"files":["C:\\` means that case is gone, and the three absolute scratchpad paths are ~400 characters of identical prefix.

- **The cost arithmetic is the trap, and it is checked on the page.** Collapse the runs first — expanded, a run shows its own pill AND the per-message pills inside it, the same money twice — then the priced parts of the turn holding the card must add up to its badge (six parts, 3.875 against 3.88 in `fbc2e20c`). Without a browser, check the fact that bounds the risk: 9 of the 10 calls are the only `tool_use` of their message, `f3384d17` is the one that is not (`TaskUpdate`, then the delivery), and **no tool call of the same message ever follows a delivery** — so no run opened after the cut holds a second call to bill.
- **The card is `renderToStaticMarkup` over `SentFilesCard`, no providers needed.** No `undefined`, `NaN` or `[object` anywhere; every filename present; the caption present when there is one. Without a `FileRefContext` the names must degrade to plain text, not to a dead `<a>`. `0dd71f3d` draws `📄` and never `🖼`, and says `1 file` and not `1 files`. `15dd6c99` recorded no `display` and must therefore draw **no** `as a download` chip. The two states with no fixture are built by taking the result off a real call: `result: null` must say `still sending` and **invent no size** (no `KB` in the HTML), and `isError: true` must say the delivery failed.
- **In Chrome over CDP**: the card sits after the run and holds **zero** `[data-tool-id]`; the call is still inside the run with its anchor (`?tool=toolu_01BPjPx…` still opens exactly that block); the three names are links whose href carries `?file=`. Then click one — the panel must draw **one** `<img>` from `/api/files/image` with **`naturalWidth > 0`**, which is the only assertion that proves bytes arrived (a broken image reads as a layout gap), and no "Binary file" notice. Clicking the picture opens an overlay that is a **child of `document.body`** and whose rect equals the viewport; Escape closes it — and closes the panel with it. The panel's four buttons (Open file / Show in Explorer / VS Code / Copy path) must still be there; scope that count to the panel, or the header's own *Open VS Code* joins in.
- **Wait for the card before asserting anything.** A 2 MB session needs more than the 6 s the driver waits: poll for it. And the fold strips have to be clicked first — the turn is folded, and the runs are collapsed inside it.
- **The server half with curl** (see check 21 for the pattern): the real PNG answers 200, `image/png`, and a `content-length` **equal to the `size` in the transcript** — the one assertion that proves both sides mean the same file — with a real `89 50 4e 47` signature, `nosniff`, `no-cache` and a 304 on `If-None-Match`. Then `Sec-Fetch-Site: cross-site` → 403, a `.mjs` → 415, an `.svg` → **415** (never served, on purpose), a swept path → 404, a non-UUID session → 400. **`/api/meta` must NOT read `cacheHits: 0`**: none of this changes a cached artefact, and expecting a re-enrich here is a misreading of the change.
- **The session's whole index of them is `Sent Files`** ([AI_VIEWER.md](AI_VIEWER.md)), and `b343d4ac` is the fixture that exercises it in one go: 4 deliveries / 5 PNGs **plus** its plan file, so the header must read `Sent Files (6)` beside `Changed Files (52)` and **no bare `Files (N)` button may be left anywhere**. In the panel: 6 rows and 6 `?file=` links, `Delivered to you — 5`, `Plan files — 1`, **no** *Published as an artifact* section (there is not one `Artifact` call in this corpus — that section is only checkable by its absence, or by `renderToStaticMarkup` over a hand-made group), no `undefined`/`NaN`/`[object`, and `overflow-y: auto` on the panel itself. `↑ the call` on a delivery must flash `[data-tool-id]`, wear off, and **flash again when the same row is pressed a second time** (that is `jumpNonce`); the plan row offers `↑ the line` instead, because no call handed it over. **Assert on `textContent`, never `innerText`**: the headings are `uppercase` in CSS and Chrome's `innerText` applies text-transform, so every mixed-case assertion silently fails. And scope the panel as *the last div whose `textContent` starts with the title, then its parent* — the first one is the whole page.
- **The disk column is where a real bug would hide, and two fixtures cover its three answers.** `b343d4ac`'s five are all present, and `answered.png` is **72515 bytes on disk against 84918 sent**, so it must be the only delivery reading `changed since` — its plan file must read `changed since` too, on the other rule (rewritten at 20:20 after the line at 19:55). `f3384d17` is the swept one: exactly **3** rows say `no longer on disk`, its plan file beside them must NOT (marking it gone means the stat answers are being joined by position), all 4 stay links because the folder may still be worth opening, and the size AS SENT is still shown for a file that is gone. **Opening the panel must make exactly ONE `/api/files/stats` request** — count it off `performance.getEntriesByType('resource')` — and a session that handed nothing over must show no button and make none at all.
- **The endpoint with curl** (see check 21 for the pattern): a cross-site POST → **403** (the global hook, not a private check); a non-UUID session → 400; an unknown one → 404; `paths` that is not an array → 400; 201 paths → 400; `paths: []` → 200 with an empty list. A path holding a `\0` must come back as **that entry** carrying `error` while the rest of the batch answers normally — the batch is never refused for one bad path. `ref` must be echoed **byte for byte** as sent, a relative path must resolve against the session's project folder and `~/…` against home, the same file spelled `C:\…` and `C:/…` must both answer, and for a file still on disk `sizeBytes` must **equal the `size` in the transcript** — the one assertion that proves both sides mean the same file. **`/api/meta` must NOT read `cacheHits: 0`**: none of this touches a cached artefact.
- **This check's fixture expires in two ways.** The transcripts go on `cleanupPeriodDays` like every other; the *pictures* go sooner, because they live in `%TEMP%`. `f3384d17`'s are already gone while `fbc2e20c`'s are not, which is what makes both the drawn state and the missing state testable at once — and is luck with a date on it. Replace by property: `rg -c '"SendUserFile"'`, then `Test-Path` the `attachments[].path` of each hit.

**25. Starred messages.** The storage is the half that can lose something, so start there. Star a prompt and an answer, then **rename any session** and confirm the stars are still in `userdata.json` alongside `titleOverrides`, `pins`, `prices` and `settings` — `saveUserdata()` writes the whole file, so a key missing from its literal disappears at the next write and nowhere else. `POST /api/cache/clear` must keep them too.

- **The copy is the point**: `GET /api/starred` must answer with the text, ordered newest-first by the message's own clock, **making no `parseSession` call at all** — the log is the proof. Only the `PUT` parses.
- **Two windows writing at once is the failure that loses data**, so drive it without a browser: several `writeJsonAtomic` calls to one path, concurrently, with a payload big enough that each is several syscalls (8 × 4 MB is plenty). Every call must resolve, the file must parse, its rows must all come from the LAST caller, and no `.tmp` may be left behind. Reproduce the old path inline — fixed tmp name, no queue — to see what is being prevented: **4 of 8 rejected with ENOENT and ~40% of the rows came from another writer**. Then the quarantine: truncate `userdata.json` mid-document, restart, and the file must reappear as `userdata.json.corrupt-<stamp>` with its bytes intact, with an `error` record naming what was replaced — the app still opening on the defaults is the intended half.
- **The copies, driven in isolation** (`UserdataBackups` against a temp folder, no server): a first `start()` writes `initial`; an unchanged file takes nothing, ever; a write that empties the stars leaves a `pre-loss` copy **that still holds them**; `read()` refuses `../userdata.json`, a bare `userdata.json` and a well-formed name that is not there; and pruning keeps three of a KIND — fabricate `pre-update-1.0.0` … `1.0.3` and one must go, which is the bug that shipped in the first draft. Fabricate dailies at −1, −2, −3, −20 and −40 days by passing `now`, and only the ones inside the window may survive. **Copies of a file that was already broken must be listed with `contents: null` and never chosen by the recovery**, so break the file and take a manual copy before asking for one.
- **Automatic recovery needs a second server, not the real root**: `--data-root <tmp> --port 7435 --logs-dir <tmp>` with `CLAUDE_HISTORY_CACHE` set, a hand-written `userdata.json` holding a rename, a pin, a star and `logLevel: debug`. Start it (an `initial` copy appears), stop it, truncate the file mid-document, start it again: `GET /api/userdata/backups` must report `recovered`, the data root must hold `userdata.json.corrupt-<stamp>` **and** a restored `userdata.json`, and `/api/settings` must serve `debug` rather than the default — that last one is the proof the restore reached memory and not just the disk. Two traps, both of which cost a run: **`build()` happens before `listen()`**, so a server that dies on EADDRINUSE has already quarantined and restored — kill the old one by port first, since `Start-Process pnpm` leaves the `tsx` child alive when the parent is killed. Read the log afterwards: it must say what would not parse, where it went, and which copy came back, with no line claiming the defaults were used when they were not.
- **The panel without a browser**: `renderToStaticMarkup` over `BackupsPanel` inside a `QueryClientProvider` with `['userdataBackups']` seeded (put the script under `web/dist/`, or pnpm will not resolve `react`). Four seeded copies must give four rows, each reason in words, and the one with `contents: null` must be the only row whose Restore is disabled. Seed `at` in **UTC** and the rows read hours off — that is the fixture lying, not the panel: on real data the stamp in the name and `formatDateTime(at)` must agree to the second.
- **An orphaned star must not take the page down with it.** A `userdata.json` restored from an older version — or edited by hand — can hold a star with no `project`, and `path.basename(undefined)` answered 500 for the whole of `/api/starred` instead of one odd row. That fixture (a star whose session is not in the index and whose record is missing a field) must come back 200, `sessionExists: false`, with its text intact.
- **Cross-window sync, with two tabs side by side**: save a setting in one and the other must follow with no reload (the usage widget keeps `['settings']` mounted for the life of the page, so nothing else would refetch it); save the price table and the other window's cost pills must change. Then check the log: **no usage read may appear** because of either event.
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
- **The code-block bars must be invisible to all of it.** Type `copy` in a
  session full of fenced blocks: no `find-match` range may fall inside a
  `[data-chrome]` element, and the bar's count must equal the count the pure
  scan gives for the same query. Then step with Enter through a word that IS in
  the code (`const`, `function`) and check the `find-current` range holds that
  word and not its neighbour — the ordinal is counted in the corpus and indexed
  into the DOM, so a bar leaking one text node would move every hit below it by
  one. Same assertion for a deep link's `search-match`.
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
- **The flash must not erase the ring, and this is measured rather than watched.**
  Follow a `?msg=` link and read `getComputedStyle` on the flashed box: during the
  animation `outlineWidth` must already be `2px` in the selected colour AND
  `boxShadow` must be set (the flash's own brighter ring over it); after the class
  comes off, the outline must be **byte-identical** to what it was during, with
  `boxShadow: none`. Equal before and after is the whole assertion — it is what
  says nothing pops. With both rings on `box-shadow` the outline was absent
  throughout and the ring appeared out of nowhere at 2.5 s.
- **And it survives F5** ([AI_VIEWER.md](AI_VIEWER.md#f5-lands-back-on-it)).
  Click a bubble well down a session, then `Page.reload`: `sessionStorage` must
  hold `ch:selected:<id>` = `msg:<uuid>` before it, and after it the SAME uuid
  must be the one and only `[data-selected]`, on screen, with `scrollTop` still
  down the page, `location.search` still **empty** (the ring is not a link), and
  `match-flash` on it — then gone 2.5 s later with the ring left behind. Verified
  on `517bdf9b` (scrollTop 4229 → 3972, box top 443 of 806), `980751cb` and
  `f3384d17`, where the box top reads **−832**: a bubble taller than the window is
  centred, so "on screen" is `top < innerHeight && bottom > 0` and nothing
  narrower. Then the four cases that are each their own mechanism:
  - **A tool call**, `tool:<toolUseId>`, must reopen its run — `toolu_012kqwsm…`
    on `517bdf9b`, selected again with **7** tool blocks in the DOM, so the
    restore opened one run and not the session (check 9's assertion, from the
    other direction).
  - **A message inside a compacted segment** must unfold its way in: on
    `432b1d41`, 4 bubbles are drawn while the segment is folded and 54 when it is
    open, and after F5 the header must read `▾` with all 54 back and the message
    centred (scrollTop 4227). This is the assertion that fails if the restore
    stops travelling the deep link's road.
  - **A live session must not be dragged to its end.** Run it against your own
    session with `localStorage.expandTools = 'true'` (a live transcript is mostly
    folded runs and renders too short for "away from the end" to exist): it opens
    on `Following` at `distance` 0, click the pill, select a message far up, then
    F5 — the pill must read `To the end`, `distance` must stay in the thousands
    (measured 3,027 → 3,180 as the turn grew) and `.turn-spinner` must still be
    there, or the check proved nothing about the live path.
  - **`?msg=` outranks it**, and becomes what is remembered; and deselecting must
    empty the slot, so a reload after clicking the gutter has no ring and
    `scrollTop` 0.
  > Two traps in the harness itself, both of which cost a run. Chrome throttles
  > `requestAnimationFrame` and timers in an **occluded** window to a standstill,
  > which reads exactly like the app having hung — launch with
  > `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
  > --disable-background-timer-throttling` and drive the page on `setTimeout`. And
  > never `await` a `Browser.close` unbounded in a `finally`: once the socket is
  > gone that promise never settles, the real error is swallowed and the run ends
  > silently with no output at all.
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

- **The three clocks**, in the same run (the agent's own session is the fixture — it is busy by definition): `[role="status"]` reads `Claude is working… total <n> · last message <n> · last tool <n>`, all three labelled, all three advancing by exactly the seconds waited, each carrying its absolute time in a `title` (`Turn started …`, `Last message landed …`, `Last tool called …`), and the last one ending INSIDE the bubble at a 520 px viewport — where `document.documentElement.scrollWidth` is 946 with or without the indicator, so the sideways scroll there is the app's layout and not this row. **The middle two must not read the same number** in the middle of a tool run: measured on a live turn, `total 2 min 26 s · last message 1 min 48 s · last tool 11 s`.
- **The clocks are right-aligned, so they must clear the follow pill.** Geometry, both widths, `[data-sticky-bottom]` hidden with `style.display = 'none'` to stand in for `chatEnabled: false` — the one state that puts the last bubble in the pill's own band (`pill.top - lastFigure.bottom` of −29): the last figure's rect and the pill's must not intersect. At `Full` width that is what `PILL_CORNER_PX` buys (48 px of clearance; **without it the figure sat at x 1380-1447 under the pill's 1375-1470**), and at the default width the padding must resolve to 0 — the figure ending within a pixel of the bubble's own padding, since the pill is outside the column there and a gutter would be waste. **Then run it again with the chat ON, and at `Full` width the padding must resolve to 0 as well** — the case that was never checked, and was wrong for a year. Turn it on for real (`PUT /api/settings {"chatEnabled": true}` from the page; `display: none` on the box no longer stands in for the setting, now that the reserve is a prop the page decides and not a layout accident, and restore it afterwards — the dev instance keeps its own `userdata.json` and this is a real save). The composer holds the pill's band (measured: 155 px tall with its blocked banner, the clocks 126 px above the pill), so the figures must end 13 px inside the bubble's right edge — the bubble's own padding, not a gutter. A 120 px padding there is the bug: at a 1500 px window the figures sat at x 1274-1341 instead of 1400-1461, dragged off the very edge they are anchored to, for a pill that could not reach them.
- **`turnActivity` needs no browser**, and the branches real data will not hand over on demand are the point: a turn holding only its prompt gives two nulls; a message mixing prose and calls puts the figures apart (its first line against its last); a run of pure `tool` items moves the tool figure and leaves the message figure on the prose that opened the run; a `thinking`-only message IS a message; and a `discardedBranch` item, a `queued` prompt and an injected notice count for neither. Against real sessions, feed it `GET /api/sessions/:id` — 60 s apart mid-run in a live turn, and the other way round on a turn that ended in prose (`49fe48e9` 8 s, `cbec71b1` 19 s).

**It must move, whatever the machine asks for**, measured as the computed `transform` / `opacity` sampled every 150 ms, not as the presence of an animation: the dots rise to −4.8 px, scale 0.85→1.14 and breathe 0.3→0.98 out of phase, while `working-shimmer` walks the label's `background-position` (112% → 20%) with `-webkit-text-fill-color: transparent`. A frozen indicator says "nothing is happening" while something is. Read the transform as text — `new DOMMatrix(getComputedStyle(el).transform)` throws on a computed `none` instead of giving identity, which silently reads as "the indicator is not there".

> There is exactly ONE branch, and headless Chrome is what proves it: it reports `prefers-reduced-motion: reduce` by default, so this check already runs in the condition that used to strip the travel out. Assert against it as it comes, and do NOT reach for `Emulation.setEmulatedMedia` — needing it back would mean the gating has returned. It was there once and was dropped because a reduced indicator reads as a stopped one on the machines that really ask for it ([AI_VIEWER.md](AI_VIEWER.md#the-working-indicator)); that same headless default cost an hour when the branches were two and the harness only ever saw the wrong one.

**27. The foot of the conversation** — the follow pill, the sticky composer and the scroller under it. Geometry, so it is read off `getBoundingClientRect` in Chrome over CDP rather than by eye ([AI_VIEWER.md](AI_VIEWER.md#the-end-of-the-conversation) for why each number is the right one):

- The scroller's `bottom` and the composer's `bottom` must both equal `innerHeight`, the composer's computed `position` must be `sticky`, and the pill must sit 16 px off the foot of the window — with a session **short enough not to scroll** as well, where `scrollHeight === clientHeight` must still hold (the sticky box must not invent a scrollbar) and the pill must be on screen anyway, reading `To the end`.
- **The pill must never cover `Send`**: check the two rects do not intersect at the default width AND at `Full` (`localStorage.threadWidth = 0`), which is the case that fails — and at `Full` the row's own right padding is what moves the button aside.
- **Switching the follow off must survive the next message.** With the pill reading `Following`, click it, then change the content's height under it: insert an 800 px div before `[data-sticky-bottom]` (growth fires no scroll event) and remove it again (the shrink makes the browser clamp `scrollTop`, which is the event that used to re-arm it). The label must read `To the end` through both, and `distance` must be 0 — it never moved, it just stopped following.
- The other three states, same way: scrolling 2,000 px up must let go, `scrollTop = scrollHeight` must arm it again, and while following, 900 px of new content must leave `scrollHeight - scrollTop - clientHeight` at 0.
- **The last message must be readable, not merely present.** At the end of a session, `[data-bubble]:last-of-type`'s `bottom` must equal the TOP of `[data-sticky-bottom]` — the gap the fade is drawn over, not the top of the box — or the gradient is eating the last line. Then type six `Shift+Enter` lines into the textarea: the composer's height and `scrollTop` must grow by the SAME number of pixels (measured: 119 → 255 and +136), the last bubble must still sit against the top of that gap, and `distance` must stay 0. **Do it a second time with the follow switched off**, which is the case pinning cannot cover: same result, and the label must still read `To the end` — the view moved, but not because the reader moved it.
- **A live or busy session must open on `Following` with `distance: 0`** (run it against your own session, which is live by definition), and the SAME session opened at `?msg=<uuid>` must open on `To the end` instead, standing where the link says.
- **The badge counts what lands while the follow is off**, and only a session that really grows can show it: run this one from inside a live turn of your own session. Open it (it opens on `Following`), click the pill to `To the end`, then poll every 3 s. Measured over one turn: 1 → 10 with the title tracking it (`7 new messages below`), `scrollTop` frozen at 4982 the whole way while `distance` climbed to 825, and the badge riding 5 px off the pill's top-right corner — the same overhang as `UpdateButton`'s, which is where the shape comes from. Clicking the pill must clear it, arm the follow and land at `distance: 0`. The count may go up without a new `[data-bubble]`: a message that is all tool calls draws a run instead, and it is still a message.
- **The page must not tremble when a message lands, and the numbers say whether it did.** From inside a live turn, sample the scroller on every `raf`, `scroll` and `ResizeObserver` tick (`scrollTop`, `scrollHeight`, `clientHeight`, and `[data-sticky-bottom]`'s `bottom - innerHeight`). Then: **`clientHeight` must never change** — it moved 762 → 784 → 762 twice per message before the header was made to hold its figures, and a single change means something above the conversation is coming and going again; each growth must show exactly one correction, the `ro` tick landing 1-3 ms after the `raf` that saw the taller content, so it is the same frame and nothing paints uncorrected; and the composer's offset must stay 0 throughout, or the sticky box is lagging behind the scroll. Do it while following, which is the case that moves.
- **The spinner tracks the turn, not the footer**: `.turn-spinner` must exist in the pill while `/api/live` says `busy` (the arrow is gone — one 12 px box holds both, so the pill must not change width) and must be absent on a session that is not live. And it must be a TURNING thing: `getComputedStyle(el).animationName` must read `spin` on a plain headless run, which reports `prefers-reduced-motion: reduce` — the assertion is free there, and it is the guard against the gating ever coming back. `.turn-spinner` itself now carries no CSS; it is only this handle.
- The find bar over this layout (check 26's harness): step onto a match and `find-current`'s rect must be above the composer's `top`, not merely inside the scroller.

**21. The file viewer.** `fileRefs.ts` is pure, so start without a browser (`node --experimental-strip-types`). Must parse: `server/src/app.ts:12`, `app.ts:12`, `x.ts:12:5`, `a/b.cs#L59-L60`, `C:\Users\…`, `\srv\share\x.ts`, and `Actualizacion%20Base%20de%20Datos%202.0/sentenciasSQL.bas:6648` (decoded, with its spaces). Must give null: `https://github.com/x/y.ts`, `mailto:`, `javascript:`, `v1.3.2`, `2.1.222`, `api.anthropic.com`, `/logs`. And `formatFileRef(parseFileRef(x))` must give back `x`.

- `20a73271` (DistribVB6_0) is the fixture: 26 links in one session, `ActualizadorVersion/frmActualizador.frm` at 1,086 lines (the stripe) and `Actualizacion Base de Datos 2.0/sentenciasSQL.bas` at 376 KB (the "syntax highlighting skipped" note).
- In Chrome over CDP: every `.prose a` either carries `data-file-ref` or points at a real URL (**none may be left holding a bare path** — the original bug); a click adds `?file=` WITHOUT navigating; the gutter holds 1,087 rows; the stripe sits at exactly `(line-1)*18` px inside the scroller's visible band; Esc closes it. Point `?file=` at something that never existed: the panel must name the launch folder it resolved against and disable the three open buttons.
- Chips: with `Tools (N)` expanded, the count of `📄` equals the number of Read/Write/Edit/MultiEdit/NotebookEdit blocks and is zero on every other tool (80 of 148, none of the other 68); none sits inside a `[role="button"]`; the header still folds.
- Server half with curl: bad session id → 400; `Sec-Fetch-Site: cross-site` → 403; missing path → 200 with `exists: false`; a directory → `isDirectory`; `node.exe` → `binary`; a 16 MB transcript → `truncated` with no `\uFFFD` at the cut.
- **The `Mentioned` panel is the index of these references, and it is mostly a filter** ([AI_VIEWER.md](AI_VIEWER.md)). Two rules to check before any of its numbers. Its collector is **never looser than the renderer**: every path it lists must also be a link in the messages, and the reverse need not hold. And it reads **the assistant's own answers only** — a prompt is not markdown, and a subagent's report is markdown but is folded inside a notice, so a row taken from one cannot show you the sentence it came from. `1806cedb` is the fixture that says it in one line: its answers name `docs/AI_VIEWER.md`, `docs/AI_ARCHITECTURE.md`, `docs/AI_TESTING.md`, `web/src/lib/sessionFiles.ts` and `server/src/core/parser.ts`, and those five are exactly the rows. **No silent caps**: past `MAX_STAT_PATHS` the panel must say how many were never checked.
- **The jump is the assertion that matters**, because it is the one that failed in the first version: `↑ the mention` must land on a `[data-bubble]` that **carries `match-flash`, names the file in its own text, and holds it as an `a[data-file-ref]`** — all three, or the row is pointing at something the reader cannot read. Press a second row after the flash has worn off and it must do it again.
- **And it must MARK the path, not only the message.** The URL must carry `?hl=` beside `?msg=`, `CSS.highlights.get('search-match')` must hold ranges whose `toString()` is the path (the ref AND its basename — two terms, or a markdown-link mention underlines nothing), every range must be inside the flashed bubble, and they must clear themselves within ~8 s like a search's. A jump with no terms must leave no `hl` behind.
- **`×N` counts messages and is a `<span>`**: its title must read `Named in N messages` (the namings count moved to that title's tail), and it must be absent on a row named in one message only.
- **The jump steps through the namings, and the walk is the assertion.** `AI_VIEWER.md` in `1806cedb` is the fixture (4 messages): the label must read `↑ 1/4` and match the `×4` beside the filename; each press must set a **different** `?msg=`, flash exactly that message (`.match-flash` on the element whose `id` is the uuid) and mark the path inside it; N presses must visit N distinct uuids; the label must wrap to `↑ 1/4` and the next press must land back on the first. A row named once must read `↑ the mention` and carry no badge. **The find bar must NOT open** — no `input[placeholder]` anywhere after a press; it did for one commit and the numbers are why it does not (see [AI_VIEWER.md](AI_VIEWER.md)). Allow the 2.5 s flash to wear off between presses, or the assertion reads the previous one.
- **A mention that finds nothing is LISTED**, wearing `not found`, its name dim, and with **no size and no date** — check for the `0 B` and the 1970 date that a nullable field renders when it is not guarded. `980751cb` is the whole-panel case (its answers name files this checkout does not have, so every row says it); `1806cedb` is the mixed one. A **folder** is still the one thing dropped, and the tally line must say both — `N of them point at nothing · 1 named a folder and are not listed`.
- **A file in another panel is kept and chipped, never dropped.** `sessionFiles.ts` in `1806cedb` was edited AND named, so it must be present wearing `also changed`; the string `already in Changed` must appear nowhere. Dropping those is what hid the most obvious mentions of a session.

- **One row per FILE, never per spelling.** The same file named absolutely and relatively drew two rows until the dedupe moved onto the RESOLVED path — the only identity available, and only after the stat comes back. No filename may appear twice, and `×N` must have absorbed the repeats. The `as written` column must show the **relative** spelling only; an absolute one belongs in the folder tail and the title, and printed in the row it pushed every row past the window.
- **Its count is the one count in the header that is not a transcript fact**, so: the button opens reading `Mentioned` with **no number** and makes **no** `/api/files/stats` request until pressed; after one press it reads `Mentioned (N)` where N is exactly the rows drawn, found and not-found alike. `Mentioned (0)` — a session whose answers name no path at all — must still open and explain itself in words rather than draw an empty box.
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
- Packaging: `pnpm package`, extract the zip, run `versions\vdev\node\node.exe versions\vdev\server.cjs --port 7435`; it must index and answer. That is where a missing `import.meta.url` shim surfaces, before any user sees it.
- Orphans: with a turn in flight, `pnpm stop`, then compare the `claude.exe` pids noted before and after — the one you started gone, everything else untouched.
- **The collision guard needs a real terminal**: `cmd /c start` minimized never gets far enough to register a session (the process exists, `~/.claude/sessions` gains nothing). The cheapest fixture is the terminal you are already working in — your own session is open in one, so `GET /api/sessions/<your-own-id>/chat` must carry the block and a POST there must 409 (`entrypoint: "cli"`, `status: "busy"`, against the composer's `sdk-cli` with no status at all). Otherwise use "Resume in terminal" and close the window by hand. **`POST /api/sessions/<your-own-id>/resume` must 409 too**, naming the live pid, and the button must read `❯ Already open` before you click it; kill that terminal, wait for the live refresh, and both must come back. With a composer turn running instead, the refusal must name the composer — not a terminal — which is what the `chat.status()` check ahead of the pid check buys.

**37. Starting a session from the app.** The two rules above apply first. This one needs no fixture — it makes its own, which is the point — but it does need a **throwaway folder**, and one Claude Code has never run in is the case worth using, since that is the half no index can answer.

- **The reservation, with curl.** `POST /api/chat/new` with a `projectKey` answers the path the index holds; with a typed `cwd`, four refusals that must each say which thing is wrong — a relative path, a folder that is not there, a file instead of a folder, and an empty body — while a path wrapped in quotes the Windows way must succeed. Then the ones that are not about the folder: `chatEnabled` off, an unknown `projectKey`, and `Sec-Fetch-Site: cross-site` → 403.
- **A reserved id is answerable but not readable**: `GET /api/sessions/<id>` must 404 while `GET /api/sessions/<id>/chat` answers 200 with `draft: true` and **`blockedReason: null`** — a reservation nothing can send to is the failure this replaced. A uuid nobody reserved must still 404 on both.
- **The assertion the whole feature rests on**: send the first prompt and a `.jsonl` must appear **carrying exactly the uuid that was handed out**, in the project folder for that cwd — creating that folder if it is new. If Claude Code ever stops honouring `options.sessionId`, this is where it shows, and `pump()`'s guard writes the real id into `lastError`. `draft` must then go false on its own, and a second and third prompt must queue (`queued: 1`), run in order, and land in that same one file.
- **The restart before the first prompt**, which is what `transcriptExists` is for: `POST /chat/start` on a fresh reservation, then confirm **zero** transcripts on disk (measured: the CLI writes nothing until a turn runs), then send with a different model AND effort so the process is torn down and rebuilt. The prompt must still land on the original uuid. A run that ends up on a different id means somebody replaced the disk check with a flag.
- **The browser half over CDP** (check 26's harness): the header must offer `+ New` — and must NOT while `chatEnabled` is off — a relative path must be refused **in words beside the input with the page staying put**, and a real folder must bring up the composer.
- **The picker must read as the filter sidebar's own list**, which is arithmetic rather than taste: drive both, and the names, the `getComputedStyle` dot colours and the session counts must come back **identical and in the same order** (20 of 20 today, alphabetical, accent-insensitive). There must be **no `<select>` left on the page** — a native one draws the options in the operating system's palette, with no colour and no counts, which is a different list of the same things. `Another folder…` must be the last row and must survive every filter, since it is the way out of a list that structurally cannot hold what you want; the chosen row's full path must stand under the list, which is what tells two projects called `scratchpad` apart. Then send: `sending…` must appear, `[role="status"]` must light, and the page must reach `/session/<id>` **on its own**, with the answer drawn from the transcript, `[data-bubble]` ≥ 2 and the viewer's own composer at the foot (`[data-sticky-bottom] textarea`). Never leave the page before a prompt goes out — a handover that fires on an empty box is a bug, and the only way to see it is to sit on the picker with a CLI open.
- **The page is the session view a second early, and that is measured against it rather than judged**: set a non-default width and zoom (`localStorage.threadWidth = 1200`, `threadZoom = 110`), then read `getBoundingClientRect` on both. The column width, the computed `zoom`, the composer's `position: sticky` and its distance from the foot of the window must be **identical** (1200 / 1.1 / sticky / 12 px on a 906 px window). A difference is the handover announcing itself as a different screen. The header must carry View, Open folder, Open VS Code, the project tag and — only before the first prompt — Change folder, and nothing else: no title, no counts, no fold controls.
- **Model, effort and mode must all be filled before anything is typed** — three `<select>`s, each with a value and options, and no `choose model…` anywhere. Then the half that proves `lastCapabilities` rather than a spawn: start a SECOND new session and time it. The pickers must be filled **within a frame** (measured: 1 ms) and `claude.exe` must be unchanged. The one run allowed to spawn is the first after a server restart, which is the only state that has nothing to remember.
- **The folder browser** (`POST /api/pick-folder`) has to be driven from a browser that HAS the foreground, **and on a cold server**, or the assertion that matters is not being made. Restart, then the FIRST pick: read the desktop with Win32 and the visible `#32770` titled `Select Folder` (`Browse For Folder` under Windows PowerShell 5.1 — the older dialog, still correct) must carry **`WS_EX_TOPMOST`** and sit at **z-index 0, with nothing above it**. Both halves are load-bearing: without the raise it comes up `topmost=False` behind the browser, and a WARM server hides the `GW_ENABLEDPOPUP` bug entirely, because the dialog is then up before the first tick can mistake the owner for it. A screenshot of the whole desktop is the honest confirmation — an enumeration can find another window "above" it that covers nothing. Accepting it must put the path in the box and take the button out of `Browsing…`; closing it must answer `{"path": null}` and leave the typed path alone. Afterwards **no pwsh host and no `claude-history-pick-*` file may be left** — a lingering host holds the one-at-a-time lock and every later click is refused. From another machine the BUTTON must be disabled with its reason while the box beside it still works; that split is the whole point.
- **Two ways NOT to test that dialog**, both learned the hard way. **Do not set values through UI Automation**: the first `Edit` in its tree is the file list's inline rename box, not `Folder:`, and writing to it renames a folder on the user's disk (Windows refused the name, which is the only reason it cost nothing). Invoke the `Select Folder` **button** — filtered on `ControlType.Button`, and reached through `TreeScope::Descendants`, since as a topmost window it is no longer a `Children` match — and let the dialog's own current folder be the answer. And **the encoding half needs no GUI at all**: write a path containing `ñ` through the same `WriteAllText` call and read it back in Node.
- **Plan mode on the first prompt** is the case that exists only here, since the mode picker is the one control offered with no CLI to ask: create straight into `plan`, and the status must report `permissionMode: plan` from the `starting` state onwards, then a real `ExitPlanMode` with its plan read from `~/.claude/plans/<slug>.md`. *Keep planning* with a note must be accepted.
- Orphans, as in check 19: note the `claude.exe` pids first, and after every stop they must be identical.

## Platform and plumbing

**29. The dev/release split.** Run it with the release actually up, because "they do not collide" is the whole claim. `.\dev.ps1` → `/api/meta` on **7434** reports `devInstance: true` and a `cacheDir` under `claude-history-dev`, while 7433 goes on answering with the release's version and its own paths, untouched. Then, from the dev page: **Stop server** must kill 7434 only (7433 still answers, and the notice must point at `dev.ps1`, not at the Start Menu), **Open data folder** must open `…\claude-history-dev`, and *Open install folder* / *Uninstall* must both be disabled — a source run is not an install. Star a message and rename a session in each instance and diff the two `userdata.json` files: neither may know about the other's. Finally the guards: `dev.ps1 -Port 7433` and `PORT=7433 pnpm stop` must both refuse rather than touch the release. On a **fresh** dev data folder, Settings must show the update check and the interval usage read already off, with no "default" marker beside them (they are this instance's defaults) — and switching one on must make the marker appear.

### Remote access

**`.\preview.ps1`**, never the release and never the dev instance: the dev one binds `127.0.0.1`, so remote access cannot be tried on it at all. That script is the whole setup — port 7435, `%LOCALAPPDATA%\claude-history-preview`, no `--dev-instance` so the bind gate treats it exactly like a release, and a `userdata.json` written with the update poll and the usage reads **off**. That last part is not tidiness: without `--dev-instance` the defaults apply, and usage rate-limits per ACCOUNT, so a 429 earned here blanks the real release's widget.

**Preview is subject to the bind gate too**, which is the thing being tested in 35: with no firewall rule for 7435 it listens on loopback and there is no remote socket to make. So 30-34 are run either after creating that rule (the panel's own button, one UAC) or with **`--host 0.0.0.0`** passed by hand — the one escape hatch, and the one thing that can still raise the Windows dialog. Whichever way, 35 must be done on a clean slate first, because creating the rule is what makes it stop being interesting.

**No second machine is needed for 30-33**: connecting to this machine's own LAN address is a remote socket, so the whole path is real. Two traps, both of which cost time once: `Invoke-WebRequest -WebSession` **replays headers from earlier requests on the same session**, which silently defeats any check about a header being ABSENT (use `curl.exe` with a cookie jar there), and PowerShell mangles inline JSON passed to `curl.exe` (use `--data-binary "@file"`).

**30. Off means off, and says so.** This one now needs a socket that outlives the switch: turn remote access on, restart so it is listening on the network, then turn it **off without restarting** (or run with `--host 0.0.0.0`, which listens regardless). With `remoteAccessEnabled` false, every `/api/*` from the LAN address must be **403** with nothing but the error — `/api/sessions`, `/api/meta`, `/api/settings` and `/api/health` included — while `GET /` still returns the page, so the SPA can draw the "remote access is off" screen. `/api/auth/status` must answer four booleans and no username. From 127.0.0.1 nothing changes.

**31. Signing in.** Set the credentials and the switch from localhost (the switch alone, with no credentials, must come back `false` — the server clamps it). Then from the LAN address: a wrong password → 401 and a `retryAfterSeconds`, an immediate retry → 429 with the backoff doubling, and each of them a `warn` in the log naming the source address. After signing in, the app must work in full — list, viewer, search, images, the file panel, `.md` export, and the composer answering a prompt (`haiku`/`low`, per the two rules above). Open a live session and confirm the SSE arrives: the LIVE badge and the working indicator must move in the remote browser.

**32. What cannot travel.** Signed in from the LAN address, all thirteen local-only routes must answer **409** carrying the sentence from `shared/src/localOnly.ts` — `resume`, `open?target=explorer|vscode`, `files/open`, `retention/open-folder`, `open-data-folder`, `open-install-folder`, `server/stop`, `server/restart`, `uninstall`, `auth/credentials`, `firewall` (POST and DELETE), `firewall/blocks` — **and nothing may open on this desktop**, which is the actual assertion. In the remote browser those buttons are disabled and the tooltip gives the reason; on 127.0.0.1 they still work. Applying an update must NOT be blocked, only confirmed.

**33. The cookie, and the header that is not there.** A state-changing POST from the LAN address **with the cookie but no `Sec-Fetch-Site`** must be 403 (`curl -b jar`), while the same call from 127.0.0.1 with no headers still works. Then the case that broke once: **click a file reference in the remote browser** — `/api/files/read` and `/api/files/image` are GETs with their own same-origin check, and over plain HTTP a same-origin GET carries neither `Sec-Fetch-Site` (trustworthy origins only) nor `Origin` (same-origin GETs never do), so a rule that refuses on their absence answers 403 to our own panel. Restart the server: the remote session must survive it (that is what makes remote updates viable). "Sign out everywhere" must kill it, and re-signing in must work afterwards.

**34. Credentials, restores and the clipboard.** Change the username and password from localhost without knowing the old one; check `userdata.json` grows an `auth` key with a `scrypt$…` hash and that `GET /api/settings` never carries it. Renaming the user must spend every cookie in existence, and "sign out everywhere" must too. Delete that key by hand while the server runs, save a setting, and a `pre-loss` copy must appear in `backups\`.

Then the one that locks you out, on purpose: drop a hand-written copy into `backups\` with **no `auth` key and an empty `settings`** — which is what every copy older than this feature looks like — and restore it. The renames in it must land, **the credentials must be gone and `remoteAccessEnabled` back to false**, and the remote session must stop working. A restore replaces the file, exceptions included; what makes that safe is the `pre-restore` copy taken first, which must be in `backups\` afterwards.

Finally, from the remote browser (plain HTTP, so no secure context): "Copy message with formatting" must paste **as HTML** into Word or Jira, and the plain-text copies in the log viewer, the resume buttons and a code block's own `⧉ Copy` must work — this is `execCommand`, not `navigator.clipboard`, which does not exist there. The HTML paste must carry the code blocks and **not** their bars: `renderedCopy` cuts every `[data-chrome]` out of both flavours, so the language and the button appear in neither.

**35. The dialog that must never appear.** The whole point of the bind gate, and the one check whose assertion is about the SCREEN rather than a response body: **no Windows Security dialog may appear at any moment of this**. Start clean — no rule for the port, and no Block rules naming our `node.exe`.

**Do not check that with `Get-NetFirewallApplicationFilter`**, which is what this said until it was caught: unelevated that cmdlet answers `Access is denied.`, so it comes back empty whatever the truth is, and the check passed on a machine that had a Block pair sitting in the firewall. Use COM, which needs no elevation and is not localised ([why](AI_REMOTE_ACCESS.md#why-the-rules-are-read-through-com)):

```powershell
$fw = New-Object -ComObject HNetCfg.FwPolicy2
@($fw.Rules) | Where-Object { $_.ApplicationName -like '*node.exe' } |
  ForEach-Object { '{0} dir={1} act={2} {3}' -f $_.Name, $_.Direction, $_.Action, $_.ApplicationName }
```

`act=0` is Block, `dir=1` is inbound. If ours is there, the panel's *Remove them* button is what clears it, and that is its own first test.

**Read that list before concluding anything about the dialog**, in both directions. A `node.exe` already carrying an Allow rule cannot raise one whatever the profiles say, so "no dialog" means nothing there; a `node.exe` carrying no rules at all is the only clean instrument for the question — and on such a machine the wide bind was taken and **none appeared**. That result does not need a witness at the screen: a dialog answered either way writes program-scoped rules, so re-running the command above immediately after the bind and still counting **zero** is the assertion.

**Every "restart" in the matrix below means `.\preview.ps1 -Restart`.** The panel's own *Restart the server* button answers **400 — "not a managed install (source or portable)"** on preview, which is correct behaviour and is check 36's last clause, not a failure to work around.

Then walk the matrix with `.\preview.ps1`, reading `GET /api/firewall` at each step (`listening`, `bindReason`, `restartNeeded`) and confirming the LAN address behaves accordingly:

| State | Expected | The LAN address |
| --- | --- | --- |
| switch off | `local` / `switch-off` | connection refused |
| switch on, no credentials | `local` / `no-credentials` — and `remoteAccessEnabled` clamps to false anyway | refused |
| switch on, credentials, no rule | `local` / `no-rule`, `restartNeeded: false` | refused |
| rule created (*Open the port*, one UAC) | still `local` / `no-rule` until restarted, `restartNeeded: true` | refused |
| after *Restart the server* | `network` / `allowed` | answers, and signing in works |
| switch off again | `network` / `allowed`, `restartNeeded: true`, everything 403 | refused after restarting |
| rule deleted by hand, then restart | `local` / `no-rule` | refused |
| set the Wi-Fi to Public with the rule in place, restart | `local` / `rule-other-profile` | refused |
| *Open the port* twice over | still **one** rule — `ruleCount: 1`; the creation is idempotent | unchanged |
| a firewall that cannot be read (point `Get-FwPolicy` at a bad ProgID) | `local` / `firewall-unreadable`, `ruleExists: null`, the reason **on screen**, both buttons disabled | refused |

That Public row only holds when Public is the machine's **only** active profile. With extra adapters connected it is on several at once and the Private rule still matches one of them, so the verdict stays `allowed` — see [what is not proven](AI_REMOTE_ACCESS.md#what-is-not-proven).

The unreadable row is the regression this whole path exists for, and it is worth stating as its own assertion: **a denied read must never read as `no-rule`.** With the port rule in place and the rule read broken, the panel used to say the port was closed and the bind went to loopback on every start.

Then the two that only a real firewall can show: a hand-made Block rule for preview's `node.exe` must appear in the panel with its program path **and the profiles it names** — a Block on `Public` alone stops nothing we want, and the panel must not claim otherwise — and be gone after *Remove them*, with every other Node install's rules still standing (`node.exe` is a DisplayName several of them share). And a **program-scoped** Allow rule (what clicking "Allow" leaves) for some other path must read `rule-other-program` rather than counting.

Last, the reason all this exists: `pnpm package`, install over the current release **with the feature off** — no dialog. Turn it on, open the port, restart, then install again: still no dialog, because the rule is a port rule and carries no `node.exe` path. That is the regression to guard, and the only way to see it is to update twice.

**36. The restart.** `POST /api/server/restart` from localhost: `/api/health` must go away and come back within a few seconds, `/api/meta` must report the same version, and `update.log` must carry a `=== restart starting` / `=== restart finished OK` pair which the next start imports into the app's own log under `update-helper`. The panel's button must wait it out rather than reloading, and the page must come back by itself. Then the refusals: with a composer turn running it must be **409** (and the turn must survive), during an update likewise; from the LAN address 409 with its own sentence; and on a source or portable run it must be **400** ("not a managed install") rather than pretending. `Get-ScheduledTask claude-history-restart` must be gone afterwards — the one-shot task unregisters itself.

**6. Installer. This is the one check that touches the user's installed release** — `install.ps1` stops the `claude-history` task, re-registers it and takes port 7433, wherever `-InstallTo` puts the files. **Ask before running it**, and put the release back afterwards by running the `install.ps1` that sits in its own install root (updates never touch that copy). The dev instance is unaffected either way: different port, different data.

`pnpm build && pnpm package -- --version 0.0.1`, extract the zip to a temp folder, run `install.ps1`, verify the task in `taskschd.msc`, check `Stop-ScheduledTask` frees port 7433 within ~5 s, `launch.vbs` cold-starts it, and `uninstall.ps1` removes task + shortcut while keeping `%LOCALAPPDATA%` data.

**7. Update, end to end.** Needs two published releases: install the older, wait ≤10 min (or "Check now") for the badge, apply, then check `update.log` and the `versions\` pruning. Afterwards **the daily log must tell the whole story on its own** — filtered by `updates,update-helper` you should read the click, every download attempt, the checksum, the tar exit code, the helper registration, the junction swap, the health check and the result, in order, with no gap where the server exited.

The parts that need no release:

- the resumable download against a local HTTP server that drops the first attempt mid-body — it must resume with `Range` and end byte-identical;
- `updateLogImport` against a hand-written `update.log` (levels, original timestamps, a second pass importing nothing). **Write that file the way the helper does**: run its `Log()` under `powershell.exe`, **not** pwsh, against a root containing `ñ`, then check the first bytes are not `ef bb bf` and that the imported records still carry the `ñ`. Call `initLogging` at a temp dir first, or the test's own fake lines land in the real daily log.

**13. Executable resolution**, which cannot be checked from this machine's own profile (`Edgar` is ASCII, and a pwsh console hides the bug anyway): put any exe named `claude.exe` in a folder under a path containing `ñ`, point `process.env.PATH` at it and call `findClaudeCli()` — the returned string must be **identical** to the real path (no `�`) and must `spawn` without ENOENT. Clear PATH and it must still be found through the winget / `.local\bin` fallbacks. `whichExe('wtai')` must return the WindowsApps alias that `fs.existsSync` denies. To see the failure the fix is for, run `where claude` under `chcp 850` and compare with `chcp 65001`.

**14. Logs.** `/api/logs/day/<today>` with `level=`, `src=` and `q=` must each narrow the total; `2026-8-1` and a traversal attempt must both 400. Drop a hand-written `YYYY-MM-DD.log` older than the window into the logs dir, save any setting, and it must be pruned. "Delete all logs" must remove today's file too (a `cleared N log files` record recreates it immediately). Fastify wiring cannot be checked without a 500 — add a throwing route temporarily, confirm an `http` error record with the stack, and remove it.

**15. Retention. Never edit the real `~/.claude/settings.json` to test it.** Run a second server on a fake data root (`--data-root <tmp> --port 7435 --logs-dir <tmp>`, and set `CLAUDE_HISTORY_CACHE` too or the fake sessions land in the real cache) holding three transcripts with mtimes at now / −10 d / −100 d. Then rewrite its `settings.json` between calls **without restarting** — the endpoint re-reads the files, which is the whole contract behind the Refresh button:

- no key → `days: 30, usedDefault: true`;
- `7` → the −10 d and −100 d ones expired;
- `0` and `"30"` → `invalidValue` plus `sweepBlocked`, with `days` NOT presented as what applies;
- a truncated file → `sweepBlocked` carrying the parser's own message.

A `.claude/settings.local.json` in the fake project's folder must appear in `projectOverrides` with the project's name, and a broken `.claude/settings.json` beside it must appear too rather than being skipped. On the real root, `lastSweepAt` must track the **mtime** of `.last-cleanup`, not the ISO string inside it — Claude Code rewrites the file at each sweep and the two differ.
