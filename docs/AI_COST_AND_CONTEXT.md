# Tokens, cost, context and compaction

**Load this when:** you touch anything that counts tokens, prices a message, draws a cost or context pill, or reads a `compact_boundary` — `enricher`, `parser`, `shared/src/prices.ts`, `shared/src/recache.ts`, `web/src/lib/cost.ts`, `web/src/lib/context.ts`, `TokenPanel`, `ContextCurve`, the Stats page.

The line format itself is in [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md); subagent transcripts in [AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md).

## Invariants

- **One usage per `message.id`, taken from its FIRST line.** Exclude model `<synthetic>`; drop replays.
- **`parser.ts` and `enricher.ts` must dedupe identically** — that parity is the only reason the viewer's per-message costs add up to the session total.
- **Never look a model up in the price table by exact key** — go through `resolvePrices` / `priceKey`.
- **Anything genuinely unpriced reads "—", never "$0.000".**
- **The cache-write TTL is read off the line, never assumed from the kind of file.**
- **A session's cost includes the agents it sent out**, stored separately and added, never folded in.
- **Never persist a cost, only tokens** — the price table is user-editable.
- **No percentage of the context window anywhere**, except quoted inside a `/context` panel.
- **A compaction is not a re-cache**, and `postTokens` is not "the context afterwards".

## Reading usage off a line

**Deduplicate assistant lines by `message.id` before summing `usage`** (streamed turns repeat the same usage object across lines) and exclude model `<synthetic>`.

**`message.usage` is on EVERY assistant line** (3156/3156 across 60 transcripts) and the chunks of one message repeat it **verbatim** (0 disagreements), so per-message usage = the value of the FIRST line carrying that `message.id`. Checked by summing the per-message costs against the session total: delta 0.000000000 on an 831-message session.

Beyond the four token counts, `usage` carries `cache_creation.{ephemeral_1h,ephemeral_5m}_input_tokens`, `service_tier`/`speed` (always `"standard"`), `server_tool_use.{web_search,web_fetch}_requests` and `iterations[]` (always one entry, summing to the top-level counts). The line itself also carries `effort` (`"xhigh"`…) next to `message.model`.

## Pricing

**Never look a model up in the price table by exact key** — go through `resolvePrices` / `priceKey`. Claude Code records dated ids (`claude-haiku-4-5-20251001`) while the table is keyed by family (`claude-haiku-4-5`), and the exact-key lookup priced those messages at **$0, silently**, in the session cost, the stats dashboard and the price editor, which did not even render a row for them. A trailing `-YYYYMMDD` falls back to the family key; anything genuinely unpriced must read "—", never "$0.000".

### The cache-write TTL, and why it is read per line

**The two TTLs bill differently**: 1h costs 2× input, 5m costs 1.25×. Session files write 1-hour caches (3446/3446 messages) and subagent files overwhelmingly 5-minute ones, so pricing everything at the 1h rate overcharged every subagent message by 60% of its write cost ($2.71 of $7.22 when measured). `computeMessageCost` prices each TTL separately (`cacheWrite` / `cacheWrite5m`, the latter optional and derived as 1.25× input when a saved table lacks it); tokens with no TTL recorded fall back to the 1h rate.

**"5m only, no exceptions" no longer holds, so never infer the rate from the kind of file.** The seven `fork` subagents of `15a86025` each write exactly **3,257 tokens at the 1-hour TTL** beside their 5-minute ones, while the four `general-purpose` ones in the same session write none — a constant, so it is the inherited prefix rather than something proportional to the work. 22,799 tokens of 4.6M corpus-wide: small money, large trap.

`SessionEnrichment.usage` / `usageByModel` / `daily[].byModel` keep NO split and are priced at 1h, which is right while session files stay 1h-only. The subagent aggregates beside them (`subagentUsage`, `subagentUsageByModel`, `daily[].subagentByModel`) are `MessageUsage` and DO keep it.

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
- **Cause is inferable, never certain, and the honest ranking is TTL first.** Past an hour the cache was gone whatever else happened, so naming a model switch there would blame the wrong thing; below the hour a changed `session_id` (a fresh CLI re-sent everything) or a model switch become the answer. **A compaction is not a re-cache** and must be excluded outright — `postTokens` is a new, smaller context written once, so counting it bills the user for a saving. And 11 events have **no local explanation at all**: in `797db462` a cache written 16 seconds earlier is simply not reused, twice in a row. Anthropic's cache is best-effort; say "the cached prefix was invalidated" and stop, because a plausible wrong cause is worse than an admitted unknown.
- **Never persist the cost, only the tokens.** `DailyUsage.recachedByModel` holds tokens per model and the pages price them at read time.

## `/context` snapshots

**`/context` leaves a full record, in two forms**: a `system`/`local_command` line with the ANSI grid (unreadable, dropped — `isContextUsageAnsi`), and the same figures re-injected as an **isMeta `user` line in clean markdown** (`## Context Usage`), which is what `contextSnapshot.ts` parses. It is the only source of the category split, of the window size and of the per-MCP-tool token table (45 tools). Coverage is thin by nature: 2 of 69 sessions, 5 snapshots.

**The categories overcount, by exactly the deferred rows.** "MCP tools (deferred)" + "System tools (deferred)" equals the gap between the category sum and the reported total in all five snapshots (22.8k / 22.7k / 18.6k / 25.4k / 17.4k); drop them and the sum lands on the total to the last 0.1k. Deferred tools are potential, not loaded, and the panel says so — otherwise the numbers look wrong.

## Compaction

**It is stated outright**: `system`/`compact_boundary` with `compactMetadata` — `trigger` (`manual`/`auto`), `preTokens`, `postTokens`, `cumulativeDroppedTokens` (session-wide), `durationMs` (127 s, 142 s and 145 s here — compaction is not instant), `preservedMessages.uuids` (also `.allUuids`) and `preservedSegment` (`headUuid`/`anchorUuid`/`tailUuid`).

**A drop in context with NO boundary is real too and must not be labelled as compaction**: Claude Code also drops stale tool results on its own, rewinding truncates the conversation, and one observed −58k drop came with `cache_read: 0` (the 1h cache had expired and the whole prompt was rewritten). The curve marks both, with the honest wording for each.

- **`postTokens` is the summary alone, NOT the context after the compaction.** A 333,718 → 14,199 boundary was followed by a first request measuring 83,222 (summary + system prompt + tools + memory + skills + the new prompt). So the panel's figures and the curve's drop legitimately disagree — the panel quotes the boundary, the curve measures requests. Never "reconcile" them by feeding `postTokens` into the curve: it is not a request and nothing was ever billed at it.
- **Compacting costs money and the transcript hides it.** The summarising call has NO `usage` anywhere: no assistant line is written for it (the nearest one before the boundary is the previous turn's ordinary answer, 3/19/16 lines earlier) and the summary itself is a `user` line with `isCompactSummary: true` and no `usage` — 3 of 3 boundaries here. The session total therefore understates the real spend, like subagent cost did, except this part cannot be recovered at all: the input split (cache read vs re-written) is unknown, a 10× band on the input alone. The panel states that the cost is not recorded — an absent pill would read as "it was free". Do NOT price it from `preTokens`/`postTokens`: `postTokens` is not the output either (16,144 chars of summary against `postTokens` 14,199).
- **The shrink is only knowable once the next request happens**: until then there is a boundary panel and no drop in the curve, which is correct rather than a parsing failure (verified live in this repo's own session).
- **The summary is a `user` line and admits it**: `isCompactSummary: true`, string content, no `usage`, and its uuid is exactly the boundary's `preservedSegment.anchorUuid`. Nothing read that flag, so it came down the ordinary prompt path and the viewer drew a 17,042-character "prompt" nobody typed. `MessageItem.isCompactSummary` carries it now and it gets its own folded panel. It is still counted as a prompt by `enricher.ts`, the search index and `/api/prompts` — fixing that means re-enriching the whole corpus and moving numbers on the list, the stats and the prompts page, so it was left alone deliberately.
- **The command that triggered it is written twice.** Once as the plain string the user typed, just before the boundary, and once as a `<command-name>/compact</command-name>` line right after the summary — carrying its **original** timestamp, so it is older than the summary it follows (14:59:47 typed → 15:02:09 summary → 14:59:47 replay, on both boundaries of `f3384d17`). The second is the replay into the fresh context, and `parser.ts` drops it (a slash command whose previous item is the summary and whose timestamp is not later). An `auto` compaction has no such line at all. The enricher still counts both as prompts, like the summary itself.
- **The boundary is the last item of its turn** — verified on both boundaries of `f3384d17`: the parser hangs it off the turn already open (`ensureTurn`) and the summary right after it always opens a new one (`newTurn`). That is what lets the viewer fold a compacted stretch at turn granularity (`web/src/lib/segments.ts`) instead of splitting a `Turn`, which would hand two halves one per-turn cost badge. Folding is presentation ONLY: `buildCostIndex`/`buildContextIndex` still run over every turn and are read by original index (checked: the three segments of `f3384d17` re-add to its $311.588143500 total, delta 6e-14).
- **The summary turn and the `❯ /compact` turn share a `promptId`**, so a turn key must never be the promptId alone — that produced 4 duplicate React keys in `f3384d17`. Key on the turn's first item uuid, which is also stable across the refetches of a live session.
- Whole segments are sometimes replayed after a boundary — see [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#replayed-segments).

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 10 (per-response cost and reconciliation), 12 (context and snapshots), 20 (re-cached context), 22 (subagent cost).
