# Tokens, cost, context and compaction

**Load this when:** you touch anything that counts tokens, prices a message, draws a cost or context pill, or reads a `compact_boundary` — `enricher`, `parser`, `shared/src/prices.ts`, `shared/src/recache.ts`, `web/src/lib/cost.ts`, `web/src/lib/context.ts`, `TokenPanel`, `ContextCurve`, the Stats page.

The line format itself is in [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md); subagent transcripts in [AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md).

## Invariants

- **One usage per `message.id`, taken from its FIRST line.** Exclude model `<synthetic>`; drop replays.
- **`parser.ts` and `enricher.ts` must dedupe identically** — that parity is the only reason the viewer's per-message costs add up to the session total.
- **Never look a model up in the price table by exact key** — go through `resolvePrices` / `priceKey`.
- **Anything genuinely unpriced reads "—", never "$0.000"** — and a sum that leaves an unpriced model out says so.
- **The cache-write TTL is read off the line, never assumed from the kind of file.**
- **A session's cost includes the agents it sent out**, stored separately and added, never folded in.
- **Never persist a cost, only tokens** — the price table is user-editable.
- **No percentage of the context window anywhere**, except quoted inside a `/context` panel.
- **A compaction is not a re-cache**, and `postTokens` is not "the context afterwards".
- **In the token panel, a figure's PLACE says how it relates to the others** — inside, beside with a `+`, or below the rule.

## Reading usage off a line

**Deduplicate assistant lines by `message.id` before summing `usage`** (streamed turns repeat the same usage object across lines) and exclude model `<synthetic>`.

**`message.usage` is on EVERY assistant line** (3156/3156 across 60 transcripts) and the chunks of one message repeat it **verbatim** (0 disagreements), so per-message usage = the value of the FIRST line carrying that `message.id`. Checked by summing the per-message costs against the session total: delta 0.000000000 on an 831-message session.

Beyond the four token counts, `usage` carries `cache_creation.{ephemeral_1h,ephemeral_5m}_input_tokens`, `service_tier`/`speed` (always `"standard"`), `server_tool_use.{web_search,web_fetch}_requests` and `iterations[]` (always one entry, summing to the top-level counts). The line itself also carries `effort` (`"xhigh"`…) next to `message.model`.

## Pricing

**Never look a model up in the price table by exact key** — go through `resolvePrices` / `priceKey`. Claude Code records dated ids (`claude-haiku-4-5-20251001`) while the table is keyed by family (`claude-haiku-4-5`), and the exact-key lookup priced those messages at **$0, silently**, in the session cost, the stats dashboard and the price editor, which did not even render a row for them. A trailing `-YYYYMMDD` falls back to the family key; anything genuinely unpriced must read "—", never "$0.000".

**A sum over messages or models is three cases, not two.** Nothing priced reads "—"; everything priced reads the figure; and a sum where only part had a price reads that part and a `+` — `formatUsd(n, partial)`, the one formatter. The third case is the one that kept getting lost, because every sum here skipped a null (`add`, `sumCost`) or turned it into zero (`?? 0`) and then printed the rest as if it were the whole: $27.86 on the Stats page for a month that really cost $707, the day the 5.5 models were missing from the defaults, "$0.000" on every one of those models, and a session that ran on two models priced as if it had run on one. So each sum carries what it left out, and every reader passes it on:

- `sessionCostParts` → `unpriced.own` / `unpriced.subagents` (`unpricedOf` for both): the list row, the session header, the token panel. `describeSessionCost` is the hover of the first two, naming the models.
- `sumCost` → `unpricedModels(entries)`: the turn, run and message pills, a compacted segment, a discarded branch, the ⑂ panel's total.
- `buildCostIndex` → `partial` and `cumulativePartial`: the "cumulative" line of a pill's card, partial from the first unpriced message on.
- `sumRecacheCost` → `RecacheCost.partial`: every re-cache figure.
- The Stats page keeps its own `Spend`, because it sums by model, project and day at once.

**And the `+` is explained in words where it is drawn**, never by a tooltip alone, which on a phone is no explanation: an amber line under the Stats cards and at the top of the token panel names the models with no price, and a pill's card says which of its messages it left out.

**The table holds one rate per model, and a model can have two.** Claude Haiku 5.5 bills a prompt over 100,000 tokens at five times its base rate ($0.50/$2.50 against $0.10/$0.50), and the docs list that as a second row of the same model, after the base one. The scraper used to let the later row overwrite the earlier, so a fetched table priced every Haiku 5.5 message at five times its cost; it now skips any row priced for prompts "over N tokens". Learning the tier for real would mean splitting every by-model aggregate (`usageByModel`, `daily`, the subagent ones) by prompt size, since a request's size is gone once its tokens are summed — and nothing here needs it: all 47 Haiku 5.5 messages in the corpus are one-message sessions, the largest prompt 33,312 tokens. A request over the threshold is underpriced by 5×, and that is the known gap. A table saved before the fix keeps its wrong row until it is fetched again or edited.

**Cache reads are not always 0.1× input**: 0.05× for Opus 5.5 and Sonnet 5.5, 0.025× for Fable 5.1 and Mythos 5.1. The 5-minute write is still 1.25× everywhere, which is all `cacheWrite5mRate` assumes.

### The cache-write TTL, and why it is read per line

**The two TTLs bill differently**: 1h costs 2× input, 5m costs 1.25×. Session files mostly write 1-hour caches and subagent files overwhelmingly 5-minute ones, so pricing everything at the 1h rate overcharged every subagent message by 60% of its write cost ($2.71 of $7.22 when measured). `computeMessageCost` prices each TTL separately (`cacheWrite` / `cacheWrite5m`, the latter optional and derived as 1.25× input when a saved table lacks it); tokens with no TTL recorded fall back to the 1h rate. It is the one pricing function: a sum of messages is priced the same way as one.

**Neither rule holds without exceptions, so never infer the rate from the kind of file.**

- The seven `fork` subagents of `15a86025` each write exactly **3,257 tokens at the 1-hour TTL** beside their 5-minute ones, while the four `general-purpose` ones in the same session write none — a constant, so it is the inherited prefix rather than something proportional to the work. 22,799 tokens of 4.6M corpus-wide: small money, large trap.
- **Session files wrote 5-minute caches for a week.** 2,135 messages of 27 sessions, written by CLI 2.1.303–2.1.309 between 19 and 24 October during working hours, report their writes as `ephemeral_5m` — 10.5M tokens, against 163M at 1h corpus-wide, and never both TTLs in one message. Every request still ASKS for 1h (`cacheControl` on the `api-request` line), and those caches still lasted an hour: of the requests that followed a 5-minute write, all 70 that came 5–60 minutes later read it back and all 18 that came an hour or more later did not. So the line is what is billed and the hour is what is cached: the price follows the line, and the re-cache rule keeps its hour ([below](#re-cached-context--the-most-expensive-thing-in-the-corpus)).

So every aggregate keeps the split: `SessionEnrichment.usage` / `usageByModel` / `daily[].byModel` / `carriedOverUsage` are `MessageUsage`, like the subagent ones beside them (`subagentUsage`, `subagentUsageByModel`, `daily[].subagentByModel`), and a re-cache bills at the TTL of the write that carried it (`recacheCost` in the viewer, `daily[].recached5mByModel` for the Stats page). Until they did, the session totals priced every write at 1h and stopped adding up to the pills on exactly those 27 sessions — $89.42 of pills shown as $101.56 on `a7d5b145`, $41 over all of them.

## Where the cost lives

**Most tokens are not where the prose is**: 58 of 89 messages in a typical session are tool-only, holding **54.5% of its cost**, and the viewer prints no header for those. Hence the three cost pills — assistant header, tool run, turn — with each message counted exactly once (`buildCostIndex` / `costOwner`; see [AI_VIEWER.md](AI_VIEWER.md) for what cuts a run and how `costOwner` keeps a message from being billed twice).

## The agents a session sent out

**What a session cost includes the agents it sent out, and that is most of it when it delegates.** They run as their own API conversations in their own transcripts, so reading only the parent's requests showed `15a86025` as **$1.49 against the $12.01 it really spent** — 88% missing, 8.1×, across 11 agents. Corpus-wide the hidden part is $45.19 of $1,521.67 (3.0%), but it is not spread evenly: 1-4% where the parent did the work, 88% where it orchestrated, so the sessions that cost most were understated most.

- **The total is one number and the storage is two.** `enrichSubagents` (`enricher.ts`) streams every `subagents/*.jsonl` into `subagentUsage` / `subagentUsageByModel` / `daily[].subagentByModel`, which are **added to** the session's own figures and never folded into them: `usage` has to stay exactly what the per-message pills add up to, and the TTL split has to survive. The list, the sort and the stats lead with the total (`sessionCostParts` → `.total`); `TokenPanel` spells out the ledger (this conversation · ⑂ N subagents · session total).
- **It uses the parser's rules and is checked against it**: one usage per `message.id` from its FIRST line, `<synthetic>` excluded, replays dropped, `toMessageUsage` shared outright — because the drawer and `SubagentsPanel` price the same messages from the parsed turns and the two paths must agree (checked over all 10 sessions with agents: worst delta 2.7e-15).
- **Nothing is double-counted corpus-wide**: an `agent-*.jsonl` belongs to exactly one session, and a `/branch` fork does not copy the directory — unlike the parent's own lines, which is what `carriedOverUsage` is for.
- **The agents' days are their own.** An agent can still be working when midnight passes, so its spend goes in the bucket ITS timestamps name, creating the day if the parent wrote nothing then. The re-cache percentage in Stats keeps a parent-only denominator (`totals.ownCost`): re-caches are only ever measured in session transcripts, so counting the agents' spend there would make the figure fall as more work is delegated.
- **Cache invalidation needed a second key.** An agent writing another answer changes what the session cost without touching a byte of its file, so `ScannedSession.subagentBytes` sums `subagents/*.jsonl` and both `rescan()` and `enrichOne()` compare it — the (size, mtime) of the session file cannot see it.

## Carried-over tokens (forks)

**A fork's carried-over tokens were billed in the parent**, and nothing per-file can see it: the copies carry their `usage` verbatim, and both the replay filter and the `message.id` dedupe are per transcript. So 17 of `c0f70eda`'s 18 assistant messages — **$3.27 of the $4.39** the app used to charge it — were counted twice corpus-wide.

`carriedOverUsage` holds them now: out of `usage`, `usageByModel` and the `daily` buckets (every aggregate), still rendered and still searchable, and shown as their own row in the token panel. Reconciliation therefore has two halves and both are checked — see [AI_TESTING.md](AI_TESTING.md) check 10.

## The context window

**It is knowable per message, and only the TOTAL is.** `usage.input + cache_read + cache_creation` IS the figure `/context` prints: checked against the four snapshots on this machine and off by 12-35 tokens, which is exactly its rounding to 0.1k. Everything the viewer shows about context comes from that — the split into re-read prefix / newly written / uncached, and the growth between two consecutive requests (median 800-2,100 tokens, with 18k-245k spikes when a tool dumps output). `read[i] == read[i-1] + write[i-1]` holds to the token in ~95% of requests (790/830, 179/182, 144/151, 85/88); the exceptions are the shrinks below.

- **The per-category split cannot be reconstructed, ever.** The fixed overhead is not fixed: in the one session with snapshots it grew from ~41.5k at the first request to 60.3-60.7k later, as deferred tool schemas, skills and memory files loaded. Only a `/context` run knows the breakdown at its own instant.
- **The window SIZE is recorded nowhere.** `message.model` never carries the `[1m]` marker — only `/context`'s own text does (`claude-opus-5[1m]`) — and `~/.claude/settings.json` (`"model": "opus[1m]"`) is today's machine-wide choice, not the one in force months ago. Inference only goes one way: 18 of 54 sessions here exceeded 200k, so those had a bigger window; the rest are unknowable. **So the app shows no percentage of the window anywhere**, except inside a `/context` panel where the figure is quoted from Claude Code rather than derived.

## Re-cached context — the most expensive thing in the corpus

When the prefix is no longer cached it is re-sent as a cache WRITE (2× input) instead of a READ (0.1×). What got paid twice is exactly

```
min(max(0, read[i-1] + write[i-1] - read[i]), write[i])
```

and `shared/src/recache.ts` is the only implementation — the enricher and the viewer both call it, and the two are checked against each other.

There is **no grey zone**: of the 60 pairs here that lost anything, none lost under 1,000 tokens and 57 lost over 20,000. It is **11.1% of the whole API-equivalent spend** — $155.32 of $1,394, 13.6M tokens, 56 events over 18 of 59 sessions, worst $16.38 in a single request — and where it happens it is 89% (p10) to 100% of that request's cost. 53 of 59 land on the first request after a typed prompt, which is why the marker belongs on the turn badge.

- **`read === 0` is NOT the test.** A third of these keep the ~21k-33k system+tools prefix cached and re-write only the conversation after it (`b343d4ac` #236: read 21,138, re-written 437,535, $4.38). The old `cacheMiss` flag tested the zero and missed every one of them.
- **The hour is real, and it runs from the last USE.** Measured over this corpus, by the gap between a request and the one before it: **under 5 min 0.2%** of requests re-cache (26 of 12,012), **5-30 min 4.6%**, **30-60 min 10.7%**, **60-70 min 100% (4 of 4)**, over 70 min 89.2% (33 of 37). Of the four exceptions past 70 minutes, three are requests that cached nothing either side so the formula has nothing to score, and one is a genuine read after 192 minutes that has no explanation — best-effort in the other direction, for once. And the clock is refreshed by use rather than running from the write: `6196e625` read the same ~39k prefix from 17:16 to 20:03, nearly three hours, because no gap between its requests ever reached the hour (the longest was 51 min). **The guarantee is one-directional**: past the hour it is gone, under the hour it is likely but never promised.
- **Cause is inferable, never certain, and the honest ranking is TTL first.** Past an hour the cache was gone whatever else happened, so naming a model switch there would blame the wrong thing; below the hour a changed `session_id` (a fresh CLI re-sent everything) or a model switch become the answer. **A compaction is not a re-cache** and must be excluded outright — `postTokens` is a new, smaller context written once, so counting it bills the user for a saving. And 11 events have **no local explanation at all**: in `797db462` a cache written 16 seconds earlier is simply not reused, twice in a row. Anthropic's cache is best-effort; say "the cached prefix was invalidated" and stop, because a plausible wrong cause is worse than an admitted unknown.
- **Where the transcript records its requests (CLI 2.1.300+), the request itself can be asked** — `requestChanges` over the two `api-request` lines ([Transcripts](AI_TRANSCRIPTS.md#line-types)): a new request chain, rewritten history, the system prompt, the tools, effort, thinking and its display, the beta headers, the cache breakpoints. Below the hour, a change there is `request-changed`, and NO change is `server-side` — the same prompt, and the cache still dropped; `unknown` stays for the transcripts that cannot say either. **But a change is a fact, not a cause**: of the 101 times the system prompt or the tools changed between two requests here, 4 came with a re-cache — deferred tools loading mid-session cost the cache nothing — so the changes are listed BESIDE whichever cause won, past the hour included, and never promoted over the TTL. On this corpus no event has needed either new cause yet: every re-cache since 2.1.300 came after an hour or a model switch (`a7d5b145` #620: Opus 5.5 → Fable 5.1 after 20 minutes, and the request also rewrote its history and dropped the `advisor` tool).
- **Never persist the cost, only the tokens.** `DailyUsage.recaches` holds one record per event — model, tokens, the part written at 5 minutes, cause — and the pages price them at read time.

## The ledger the token panel draws

It was a six-column table (model · input · output · cache read · cache write ·
≈ cost) and it is a stack of cards, because the panel lives in a 400 px column
that can be dragged to 320 ([AI_VIEWER.md](AI_VIEWER.md#the-rail-and-the-inspector)).
The table wanted 140 px of heading for `cache read` and `cache write` alone, and
repeated every label once per row for the sake of comparing rows that mean
different things anyway — a model, a subset of one of its own cells, a separate
conversation, and a total that leaves one of them out.

**The arithmetic did not change.** `buildContextIndex`, `summariseRecache`,
`computeMessageCost` and `resolvePrices` are the same calls in the same order,
so what check 20 verifies is exactly what it was. What had to be
re-drawn is what the table said with indentation, dots and border weights,
because that was load-bearing and none of it survives a re-flow:

- **A card per model**: name left, cost right, the four figures two by two.
- **`↳ of which re-cached` is a SUBSET of the cache-write figure above it**, not a
  row that adds — the four dots in the other columns were what said so. It is
  drawn INSIDE the card whose figure it is part of: the total's where there is
  more than one model, the single model's where there is not.
- **`+ ⑂ N subagents` is money spent outside this transcript**, so it is a
  sibling card wearing a `+`. Its link still goes to `?agents=1`, which now
  swings the inspector over to the agent list.
- **`session total` sits under a double rule**, and **`carried over` sits below
  THAT**: amber, dashed, and saying in words that it is in no total at all.
- **The four explanations fold** (`Fold`). Re-cache, subagents, carried over and
  compactions are paragraphs, and four paragraphs in a narrow column is a wall —
  each is one line you can open, with every word still inside it.

`ContextCurve` still stretches its `viewBox` with `preserveAspectRatio="none"`
to any width it is given — and clicking it (or its `⤢`) opens `ContextOverlay`,
the same index at full size: a body portal whose chart is measured in pixels
(ResizeObserver) precisely because axis text and marker labels cannot survive a
stretched viewBox, with per-request hover detail and an event list — every
compaction, boundary-less shrink and re-cache, each row and marker navigating
to its own line via `goToMessage`.

## `/context` snapshots

**`/context` leaves a full record, in two forms**: a `system`/`local_command` line with the ANSI grid (unreadable, dropped — `isContextUsageAnsi`), and the same figures re-injected as an **isMeta `user` line in clean markdown** (`## Context Usage`), which is what `contextSnapshot.ts` parses. It is the only source of the category split, of the window size and of the per-MCP-tool token table (45 tools). Coverage is thin by nature: 2 of 69 sessions, 5 snapshots.

**The categories overcount, by exactly the deferred rows.** "MCP tools (deferred)" + "System tools (deferred)" equals the gap between the category sum and the reported total in all five snapshots (22.8k / 22.7k / 18.6k / 25.4k / 17.4k); drop them and the sum lands on the total to the last 0.1k. Deferred tools are potential, not loaded, and the panel says so — otherwise the numbers look wrong.

## Compaction

**It is stated outright**: `system`/`compact_boundary` with `compactMetadata` — `trigger` (`manual`/`auto`), `preTokens`, `postTokens`, `cumulativeDroppedTokens` (session-wide), `durationMs` (127 s, 142 s and 145 s here — compaction is not instant), `preservedMessages.uuids` (also `.allUuids`) and `preservedSegment` (`headUuid`/`anchorUuid`/`tailUuid`).

**A drop in context with NO boundary is real too and must not be labelled as compaction**: Claude Code also drops stale tool results on its own, rewinding truncates the conversation, and one observed −58k drop came with `cache_read: 0` (the 1h cache had expired and the whole prompt was rewritten). The curve marks both, with the honest wording for each.

- **`postTokens` is the summary alone, NOT the context after the compaction.** A 333,718 → 14,199 boundary was followed by a first request measuring 83,222 (summary + system prompt + tools + memory + skills + the new prompt). So the panel's figures and the curve's drop legitimately disagree — the panel quotes the boundary, the curve measures requests. Never "reconcile" them by feeding `postTokens` into the curve: it is not a request and nothing was ever billed at it.
- **Compacting costs money and the transcript hides it.** The summarising call has NO `usage` anywhere: no assistant line is written for it (the nearest one before the boundary is the previous turn's ordinary answer, 3/19/16 lines earlier) and the summary itself is a `user` line with `isCompactSummary: true` and no `usage` — 3 of 3 boundaries here. The session total therefore understates the real spend, like subagent cost did, except this part cannot be recovered at all: the input split (cache read vs re-written) is unknown, a 10× band on the input alone. The panel states that the cost is not recorded — an absent pill would read as "it was free". Do NOT price it from `preTokens`/`postTokens`: `postTokens` is not the output either (16,144 chars of summary against `postTokens` 14,199).
- **The shrink is only knowable once the next request happens**: until then there is a boundary panel and no drop in the curve, which is correct rather than a parsing failure (verified live in this repo's own session). `ContextIndex.compactions` holds the boundary anyway — anchored on the boundary line's own uuid, with `point: null` until a request follows — which is how the overlay's event list can show a compaction the curve cannot yet mark.
- **The summary is a `user` line and admits it**: `isCompactSummary: true`, string content, no `usage`, and its uuid is exactly the boundary's `preservedSegment.anchorUuid`. Nothing read that flag, so it came down the ordinary prompt path and the viewer drew a 17,042-character "prompt" nobody typed. `MessageItem.isCompactSummary` carries it now and it gets its own folded panel. It is still counted as a prompt by `enricher.ts`, the search index and `/api/prompts` — fixing that means re-enriching the whole corpus and moving numbers on the list, the stats and the prompts page, so it was left alone deliberately.
- **The command that triggered it is written twice.** Once as the plain string the user typed, just before the boundary, and once as a `<command-name>/compact</command-name>` line right after the summary — carrying its **original** timestamp, so it is older than the summary it follows (14:59:47 typed → 15:02:09 summary → 14:59:47 replay, on both boundaries of `f3384d17`). The second is the replay into the fresh context, and `parser.ts` drops it (a slash command whose previous item is the summary and whose timestamp is not later). An `auto` compaction has no such line at all. The enricher still counts both as prompts, like the summary itself.
- **The boundary is the last item of its turn** — verified on both boundaries of `f3384d17`: the parser hangs it off the turn already open (`ensureTurn`) and the summary right after it always opens a new one (`newTurn`). That is what lets the viewer fold a compacted stretch at turn granularity (`web/src/lib/segments.ts`) instead of splitting a `Turn`, which would hand two halves one per-turn cost badge. Folding is presentation ONLY: `buildCostIndex`/`buildContextIndex` still run over every turn and are read by original index (checked: the three segments of `f3384d17` re-add to its $311.588143500 total, delta 6e-14).
- **The summary turn and the `❯ /compact` turn share a `promptId`**, so a turn key must never be the promptId alone — that produced 4 duplicate React keys in `f3384d17`. Key on the turn's first item uuid, which is also stable across the refetches of a live session.
- Whole segments are sometimes replayed after a boundary — see [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#replayed-segments).

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 10 (per-response cost and reconciliation), 12 (context and snapshots), 20 (re-cached context), 22 (subagent cost).
