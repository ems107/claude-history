# The web app and the conversation viewer

**Load this when:** you touch anything under `web/src/` — the session viewer above all (`TurnList`, `Turn`, `Bubble`, `ToolBlock`, `FoldHeader`, the cards and panels), deep links, highlighting, or the file-reference panel.

Stack: React 19 + Vite + Tailwind v4 (dark-only UI), TanStack Query for data, SSE (`EventSource`) for live invalidation. What the data means is in [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md), [AI_COST_AND_CONTEXT.md](AI_COST_AND_CONTEXT.md) and [AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md).

## Invariants

- **No ancestor of a message may carry a `filter`** — it breaks every `position: fixed` popover inside it.
- **Nothing that folds may be a `<button>`** — use `FoldHeader`, and ask `hasSelection()` before folding.
- **Nothing interactive may be nested inside a `FoldHeader`** — siblings in the header row instead.
- **Folding is presentation only.** Cost and context indexes always run over every turn.
- **What is folded lives in `TurnList`**, keyed on the session id — never in the component that draws it.
- **A deep link must point at something visible**: unfold the way in, then scroll, then say which one it was.
- **Marks are `Range`s in the CSS Custom Highlight API**, never `<mark>` nodes in React's markdown.
- **A message bubble takes no `onClick`.**

## Two layout rules that keep breaking

**No ancestor of a message may carry a `filter`** — a `hover:brightness`, an opacity animation, anything. `HoverCard` (the cost and context popovers) is `position: fixed`, and a filtered element becomes the containing block for its fixed descendants, so the card anchors to the bubble instead of the viewport. Hover feedback goes through a ring or a border.

**Nothing that folds may be a `<button>`.** No browser lets a button's text be selected, and a fold header is where the viewer writes the figures worth copying: the tool name with its arguments, file paths, the dates and cost of a compacted stretch, token counts. They all go through `FoldHeader` — a div with `role="button"`, `tabIndex`, Enter/Space and `select-text` — and everything that folds on a click (an injected notice, the log rows) first asks `hasSelection()`, or a drag ending inside it collapses what the user was about to copy.

- **A message bubble is not one of them.** A prompt used to fold its own turn in prompts-only mode, and an accidental click there hid the answer being read, so `Bubble` takes no `onClick` at all: a turn folds only from its fold strip.
- Two consequences: **nothing interactive may be nested inside a `FoldHeader`** (copy buttons, cost pills and the subagent link are siblings in the header row), and a shrink-wrapped header needs `w-fit`, which the `<button>` gave for free.
- Real buttons stay real: the header's mode toggles are controls with nothing to copy.

## What folds

**Three things fold, and all three are presentation only**: a compacted stretch (`CompactedSegment`), a branch a rewind cut away (`DiscardedBranch`, grouped by `groupTurns`) and a turn's own answers. None of them may filter the data — `buildCostIndex` / `buildContextIndex` still run over every turn and are read by original index, which is the only reason the pills reconcile.

**What is folded lives in `TurnList`**, keyed on the session id, never in the component that draws it: a live session replaces the whole `turns` array every few seconds, so per-component state dies with the remount and any effect keyed on `turns` re-folds what the user just opened. For the same reason the "expand all" effects read the segments through a ref and key on the toggle alone. Deep links must unfold their way in — segment and turn — before scrolling, or the link silently does nothing.

## What cuts a tool run

Three things are lifted out from between the tool calls, because each is a turn of the conversation in miniature and reads as plumbing when folded in among twenty `Read`s.

**A question to the user** (`AnsweredQuestionCard`). The call itself stays inside the run, untouched — raw input, result, cost pill, and the `?tool=` anchor a deep link needs (checked: the link still opens exactly that one block). The card is the human reading of it and **never folds**.

**A plan** (`PlanCard`; `parsePlan` in `lib/plans.ts` is pure, so the card, the markdown export and the per-message copy cannot drift about what a plan is). `summarizeInput` used to stringify 25 KB of markdown into a one-line collapsed header. Two differences from the question card: the **body folds**, because a plan is long and the conversation has to stay scannable (its own `# heading` names it meanwhile), and the **refusal never does** — it is one sentence, it is why the plan was turned down, and it is what the next turn acts on.

**A prompt typed while Claude was working** (`MessageItem.queued`) goes **on the rail, not at the prompt margin**. It did not open the turn it appears in, it interrupted it, so drawn where a prompt goes it cut the thread in two and split one piece of work across two folds. It keeps the user bubble's colour and its tail — it is still visibly the user speaking — and the `queued` chip explains the clock ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#queued-lines-attachment--queued_command) for why Claude Code agrees it is not a new prompt). It still shows when the turn is folded, indented.

> **The trap in all three: `costEntries` dedupes by message uuid WITHIN a run**, so a message whose calls land in two runs would be billed by both. `costOwner` drops to false after the cut, and that is the only reason the pills still reconcile. (For the queued prompt the cut falls between items, so there is nothing to undo.)

## Subagents on screen

`SubagentsPanel` is the index of the call, the report and the transcript (see [AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md) for what joins them): the call is a `ToolBlock` with a chip named after the agent type, the report an `InjectedNotice`, the transcript a `SubagentDrawer`.

- Opened by the ⑂ badge from either the list or the header. Its `?agents=1` lives in the URL because the session list opens a session straight onto it; the drawer's `?agent=` is a different parameter for a different thing.
- The panel reads each agent's transcript under the **same query key the drawer uses**, so nothing is fetched twice and opening one afterwards is instant — 350-500 KB and ~20 ms each, measured.
- **The reports fold inside a notice that itself folds the turn on a click**, so that whole region must stop the event — otherwise reading a report collapses the conversation around it.
- **The list is a tree** (`asTree`): an agent an agent spawned is drawn under it, indented, in the order it was sent out. A flat list left four rows at the top level explaining their parentage in prose, which the reader then had to reassemble. A row whose parent is somehow not in the list is appended rather than dropped — out of place beats invisible.
- **A nested agent's two ends are in another agent, so the drawer needs anchors of its own.** For a `spawnDepth ≥ 2` row both jumps open the PARENT's transcript instead of the conversation, at `?agentTool=` / `?agentMsg=` — the drawer's counterparts of `?tool=` / `?msg=`, separate because those belong to the conversation underneath and would resolve to nothing inside an agent. `openAgent` rewrites both together, or one left over from a previous jump points into a transcript that does not contain it.

## Deep links, the flash and the marks

**A deep link has to point at something.** `?msg=` scrolls, and scrolling alone lands you in the middle of a 300-message session with nothing said about which message was meant — so the message flashes (`match-flash`, 2.5 s, the bubble's counterpart of Settings' `anchor-flash`) and, when the link came from a search, the matched words are marked for 8 s. Both wear off: the flash answers "which message" at a glance, finding the word inside a long answer is a slower job, hence the longer life.

- **The anchor is not the box to flash.** An assistant message merges its streamed chunks, so a search snippet's uuid is often an ALIAS — a zero-sized `<span>` — and a ring on `getElementById` was a ring on nothing, which is why the highlight read as missing. Resolve `closest('[data-bubble]')` and flash that; mark inside `[data-bubble-body]` only, or a query for "user" lights up the header.
- **The marks are `Range`s given to the CSS Custom Highlight API, never `<mark>` elements.** The text is markdown React re-renders every few seconds in a live session, and inserting nodes into it is a fight with React that nothing wins; this way the DOM is untouched and clearing is one `delete`. `::highlight(search-match)` in `styles.css` must keep the name `markMatches` registers, and it inherits nothing — background AND colour both have to be set. A browser without the API still gets the flash.
- **The terms travel folded, one `hl` per term** (`highlightSearchParams`): a phrase term contains spaces and a joined list could not be split back. Folded is also the point — they are the ones the server matched, so an accented query marks its accented hits.
- **A hit in tool output is anchored by `?tool=<toolUseId>`, not by a message.** A line uuid cannot identify a call (one assistant message makes several) and the line carrying a `tool_result` is rendered NOWHERE, so `SearchSnippet.toolUseId` is the only anchor those hits have. It outranks `?msg=` when both are there: a `call` hit carries the uuid of the message that made it, which would flash a whole answer instead of the one call among a run of thirty. Subagent text gets neither — its tool ids exist only inside its own transcript.
- **Landing on a tool means opening three things**: the turn (`locate` holds tool ids beside message uuids), its run (`ToolGroup`, whose target effect is declared AFTER the `expandAll` one so it has the last word on mount) and the call itself (`ToolBlock`, `data-tool-id`). Each opens and then lets go — `open={targeted || open}` would make it impossible to fold back with the link still in the URL — and only the run holding the target opens, never the session (checked: 4 tool blocks in the DOM of a 210-call session).
- **The anchor is polled for, not waited out once.** That chain is five state updates deep (segment, rewound branch, turn, run, block) and a single 100 ms guess at the end of it is a race on a big session.
- **The effect keys on the link and NOT on the data** — that is what stops a live session being yanked back to the anchor every few seconds — and the price is that asking for the SAME anchor twice does nothing at all, which is exactly what clicking a row of the subagent list again is. Hence `jumpNonce`: bumped on every jump ASKED for, in the deps, and deliberately **not** in the URL, because it is a gesture and not part of the link.
- **An offloaded tool output loads itself when it is the target** (`OffloadedResult autoLoad`): the deep scan reads those files, so the words looked for can be in one and nowhere else, and arriving at a "Load full output" button is the wrong answer to "show me the hit". It lands after the first marking pass, so the marks are re-run once — and only if the text really changed.
- **Showing a match is not the same as scrolling to its box**: a tool result renders inside a `max-h-96 overflow-auto` pre, so a hit 2,000 lines down was "on screen" only in the sense that its container was. `revealRange` walks every scroller between the text and the window, innermost first, and moves nothing when the mark is already visible.
- `matchSpans` is pure and takes plain strings — the text nodes' data — so the index arithmetic is checkable without a browser. It folds the pieces **concatenated**, not one by one: markdown splits a sentence into a node per emphasis, link and code span, and a phrase crossing one of those is exactly what a search finds and a reader cannot.

### The flash animation

Only `box-shadow` and `border-color` are animated. A `transform` / `filter` / `opacity` flash would make the bubble the containing block for the cost and context popovers inside it — the `filter` rule above, from the other direction. The tint is an INSET shadow, not a background: a bubble paints its own, and animating that ends the flash on the wrong colour.

**Anything that recolours a bubble's outline must recolour its tail** (`[data-bubble-tail]`, its own keyframes). The tail is a separate element with its own border and its own OPAQUE fill, so it does not merely keep the old colour — its fill paints over the ring, punching a dark notch in the very line it exists to continue.

The `100%` keyframe names no `border-color`: an omitted property takes the element's own value as the endpoint, which is how one animation serves a terracotta bubble, an emerald one and an amber panel without knowing any of their colours (checked frame by frame: 217,119,87 → 39,74,65, the assistant border, with the tail in lockstep). Naming a colour there would mean naming the wrong one twice.

## File references

**A file path in an answer opens a panel, and `parseFileRef` is the only thing that decides what a path is** (`lib/fileRefs.ts`, pure and checkable without a browser). It reads the shapes this corpus really holds — `:12`, `:12:5`, `#L12-L20`, percent-encoded paths with spaces, `C:\…` and `\\srv\…` — and two orderings in it are load-bearing:

1. **The drive letter is tested before the scheme**, or every absolute path on Windows is discarded as "protocol `c:`".
2. **The scheme is tested after the line suffix is cut**, or `app.ts:12` dies as "protocol `app.ts:`" — precisely the react-markdown behaviour this exists to undo (`defaultUrlTransform` blanked both, so those links reloaded the page instead of navigating anywhere).

`urlTransform` in `Markdown.tsx` lets a file reference through and runs the default on everything else, which is what keeps `javascript:` blanked.

- **The reference comes from the href, never from the link text**: the model writes `[:905](frmActualizador.frm:905)`, so the label is its wording and only the destination is a path.
- **The link is an `<a>` with a real href** (`/session/<id>?file=…`) whose click is prevented — copy-link, middle click and ctrl+click keep working, and a `<button>` would make the prose unselectable. It asks `hasSelection()` first, like every fold header.
- **Backticked paths are linkified in `strict` mode.** They are 33× more common than markdown links (4,347 against 131), but 2,994 of them are bare names — `package.json`, `settings.json` — half of which are not in the project at all, and a link the reader cannot judge without clicking is worse than plain text. Strict also wants a real filename or a line number at the end, because a separator alone proves nothing: `text/html` is a MIME type and `GET /api/retention` a route, and both were links until it did. The whole `<code>` span is one candidate, never scanned inside: that is what makes a path with spaces work and a shell command fail cleanly.
- **A range lives in the link TEXT, not in the destination.** Claude writes `[:1068-1074](.../frmActualizador.frm:1068)` — seven lines named, one linked — so `rangeFromLabel` takes the end from the label, and only when the label restates the same start. Without it the panel marked one line of a stretch and looked like it had lost the rest.
- **In a tool header and in "files touched" the path stays inert and a chip sits beside it**, because both live in a `FoldHeader`. The chip is gated on the tool NAME (`Read` / `Write` / `Edit` / `MultiEdit` / `NotebookEdit`, whose `inputSummary` IS the `file_path`), not on the shape of the string.
- A `~/...` reference is expanded against the home directory **server-side**: resolved against the project it becomes `<project>\~\.claude\settings.json`, a "not found" for a file that is right there. The panel sends the **path**, never the formatted reference — `frmActualizador.frm:1068` as a filename finds nothing.
- The target line is a stripe positioned by arithmetic on one `LINE_H`, so the body must stay `whitespace-pre`: one wrapped line and the gutter, the stripe and the text disagree from there down. **Everything neutralising `.hljs` on the highlighted `<code>` is a style, not a class** — `github-dark.css` loads after Tailwind and wins every tie. Its background covered the stripe; its `padding: 1em` then pushed the text 12 px below its own line number, so the highlight sat two thirds of a line off, and only where highlighting happened at all, which made it look intermittent.

## The working indicator

**It takes its status from the `['live']` query, NOT from `detail.summary.live`**, though both carry the same field. `['session', id]` is invalidated by `sessions-changed` — the transcript grew — while the busy/idle flip is a write under `~/.claude/sessions` and fires only `live-changed`. Read off the detail, the indicator would hang on "working" after the turn's last line was written, and the alternative (re-parsing a multi-MB transcript on every status flip) is absurd next to a query that reads two small files.

**It hangs on the last turn's RAIL, as a `footer`, not after the list.** An answer being written belongs where the answers are: rendered at root level it lined up with the prompt instead of with the replies, reading as a sibling of the question rather than as the response arriving (checked: left 262 px, identical to the assistant bubbles, against the prompt's 236). A turn that has produced nothing yet — the state of every session for the first seconds after a prompt — grows a rail of its own from the same `RAIL` constant.

It is still **NOT an item**: it never enters `turn.items`, so nothing that folds, counts or prices a message can see it. It is passed only while there is something to draw (`isWorking`), or the rail would be a stray green line down the page, and a folded turn shows it anyway — live news must not be hidden by a collapsed turn. `TurnList` picks the turn: the last group of the live segment, and only when that group is `live`, because hanging it off a rewound-away branch would say the abandoned exchange is the one being answered.

Why it says "working" rather than "writing", and why the silence it fills is so long, is in [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#live-sessions-and-streaming).

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 2, 9 (marking search hits), 16 (rewinds in the viewer), 18 (working indicator), 21 (file viewer), 22 (subagent panel), 24 (question cards and drawings).
