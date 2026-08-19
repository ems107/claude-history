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
- **A panel that indexes files asks the disk in ONE request**, and joins the answer on the ref it sent.
- **A collector of paths written in prose may be stricter than what the renderer linkifies, never looser.**
- **A starred message says so without being hovered, and nothing is drawn on the bubble.**
- **What appears on hover may not resize what it appears in** — a hover toolbar is pinned to one line (`h-[1lh]`), never measured from its own buttons.
- **A fold that can be a jump's destination opens and then LETS GO** — never `open={targeted || open}`.
- **What the find bar counts is what unfolding can put inside a marking box** (`[data-bubble-body]`, `[data-tool-id]`).
- **What is drawn inside a marking box and is not the message's own words carries `data-chrome`** — the marking walk rejects it and the formatted copy cuts it out.
- **A find is a gesture, not a location**: the bar never writes to the URL.
- **A button that acts on the server's own desktop is disabled when the page is remote**, with the reason from `shared/src/localOnly.ts` as its tooltip — `useLocalOnly()`, never a hostname check ([AI_REMOTE_ACCESS.md](AI_REMOTE_ACCESS.md)).
- **Typing never moves the page** — a step unfolds things that do not fold back.
- **The selected message lives outside React**, and `TurnList` is memoised so a click costs nothing.
- **The ring survives F5**: remembered per conversation in `sessionStorage`, never in the URL, and restored by travelling the deep link's road back to it.
- **`All` is the one scope never chosen for the reader** — and a narrowed one must say what it is holding back.
- **Only the reader may arm or release the follow** — a `scroll` event does not say who fired it.
- **The composer is the last thing in the conversation's column**, and the scroller reaches the foot of the window.
- **Nothing the composer does may hide a message** — growing it scrolls the conversation clear of it.
- **No row above the conversation may come and go** — least of all one gated on the enrichment.
- **Every clock on the working indicator belongs to the turn in flight**, and a tool call is not a message.

## Two layout rules that keep breaking

**No ancestor of a message may carry a `filter`** — a `hover:brightness`, an opacity animation, anything. `HoverCard` (the cost and context popovers) is `position: fixed`, and a filtered element becomes the containing block for its fixed descendants, so the card anchors to the bubble instead of the viewport. Hover feedback goes through a ring or a border.

**Nothing that folds may be a `<button>`.** No browser lets a button's text be selected, and a fold header is where the viewer writes the figures worth copying: the tool name with its arguments, file paths, the dates and cost of a compacted stretch, token counts. They all go through `FoldHeader` — a div with `role="button"`, `tabIndex`, Enter/Space and `select-text` — and everything that folds on a click (an injected notice, the log rows) first asks `hasSelection()`, or a drag ending inside it collapses what the user was about to copy.

- **A tool header has two voices, and the prose comes first.** `intent` — what the model said it was doing — then `inputSummary`, the command itself, dimmer and monospaced ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#line-types) for where it comes from and how often). Both sit in ONE truncating box so there is a single ellipsis and the sentence gets the room, and they are separated by a MARGIN rather than by a character: `findInSession` folds the same header from the same two fields in the same order, and a `·` drawn in only one of the two corpora is a character the ordinals could disagree about.
- **A message bubble is not one of them.** A prompt used to fold its own turn in prompts-only mode, and an accidental click there hid the answer being read, so `Bubble` takes no `onClick` at all: a turn folds only from its fold strip.
- Two consequences: **nothing interactive may be nested inside a `FoldHeader`** (copy buttons, cost pills and the subagent link are siblings in the header row), and a shrink-wrapped header needs `w-fit`, which the `<button>` gave for free.
- Real buttons stay real: the header's mode toggles are controls with nothing to copy.

## The star on a message

`MessageActions` is the toolbar in a bubble's header row, and the star is its
last item — after the two copy buttons, so a set star sits right against the
model and the pills, the part of the header that is always drawn; first in the
row it floated alone in the middle of it whenever the copy buttons were hidden.
Never on the bubble, though, which takes no `onClick` and
must not be recoloured: an outline means recolouring `[data-bubble-tail]` too
(its own element, its own opaque fill, its own keyframes) and `match-flash`
already animates that border for 2.5 s, so a deep link arriving would fight it.

- **`hidden` sits on each button, not on the row.** The row was hidden as a whole
  because an invisible button still takes its width and left a permanent gap in
  the header; a set star has to stay visible while you scroll past it, so it opts
  out and the copy buttons keep the hover rule. (`opacity-0`, which the session
  header's pin uses, would bring the gap back.)
- **The row is `h-[1lh]` tall, and its buttons overflow it.** A hover toolbar that
  measures itself makes the header taller the instant the pointer arrives — here
  by one pixel, the star's `text-xs` line box against the header's 10 px one —
  and one pixel is plenty: the whole thread below shuffles as the mouse sweeps
  down it, and on a bubble's edge the growth carries the boundary out from under
  the pointer and back again, which flickers. One line of the header's own text,
  whatever it is set in, is the height; the padding paints outside it.
- **No `StarContext` means no star button**, the same contract `SubagentContext`
  states — and that is what keeps it out of the subagent drawer, which renders
  the same `TurnList` over a transcript whose uuids this session does not
  contain. The provider wraps the conversation's list alone.
- **Starring invalidates `['stars']` and nothing else.** `['session', id]` is a
  re-parse of the whole transcript; see the reasoning and the storage in
  [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md).
- The page itself (`/starred`) is the sibling of Prompts and Plans, and its rows
  link with `?msg=` — so everything under "Deep links" below is what makes the
  link land: the segment, the branch and the turn all unfold first.

## The bar on a code block

A fenced block in an answer wears one: the language it is written in on the
left, `⧉ Copy` on the right. **Fixed, not revealed on hover** — the one thing a
code block can afford that a bubble's header row cannot, because the bar is its
own strip and never covers the first line, and because a copy button nobody
knows to hover for is a copy button nobody has. It is turned on for the
assistant's own messages alone: `Markdown` takes a `codeBar` prop, `Turn` is the
only caller that passes it, and the other seven — a plan, a subagent's report, a
compaction summary, the release notes, the Starred page — render exactly what
they rendered before. No provider, no button, the contract `StarContext` states.

- **The bar sits OUTSIDE the `<pre>`.** Two things follow from that and neither
  is cosmetic: the block's `textContent` is the code and nothing else, so what
  is copied needs no parsing and cannot drift from what is on screen; and the
  bar does not slide out of view when a long line scrolls the `<pre>`
  horizontally, which is exactly what an absolutely-positioned button inside one
  does.
- **The wrapper is the box now.** It takes the margin and the rounding the
  `<pre>` had, and clips both children with it, so the bar needs no corners of
  its own and no number to keep in step with the plugin's. Those rules are in
  `styles.css` rather than utilities because what has to be beaten is
  typography's own `pre` rule: it is wrapped in `:where()` and so weighs no more
  than `.prose`, which `.code-block > pre` outranks and a bare `m-0` would only
  tie with.
- **Both labels are always drawn and a class chooses between them.** `TurnList`'s
  `MutationObserver` watches `childList` and `characterData` and not attributes,
  so swapping a class costs nothing where swapping the text would repaint every
  mark in the conversation, twice, on every copy.
- **`select-none`**, because dragging across a couple of blocks is how a reader
  takes code by hand, and `typescript ⧉ Copy` has no business in what they get.
  The click is stopped as `MessageActions`' row stops it, or the scroller's own
  handler moves the selection ring to whatever the block is inside.
- The copy goes through `copyPlain`, never `navigator.clipboard` — over plain
  HTTP that object does not exist ([AI_REMOTE_ACCESS.md](AI_REMOTE_ACCESS.md#the-clipboard)).
  The trailing newline the fence closed with is dropped; nobody means to paste it.

### `data-chrome`, and why it had to exist first

The bar lives inside `[data-bubble-body]`, which is a marking box, and **the
find bar counts in the transcript and paints in the DOM**. Anything of ours in
there is therefore a match the corpus never saw, and it costs three things at
once: a search for `copy` lights up every code block; the ordinal counted in the
corpus and indexed into the DOM's ranges lands one late for every piece of
chrome above it (`reveal` in `TurnList`); and the per-box counts the `visible`
scope reads say a folded hit is on screen. On top of that, the message's own
"Copy with formatting" reads its body back as HTML, so the bar would paste into
Word.

So `textNodesIn` rejects a `data-chrome` subtree outright — one function, and
`boxRanges`, `markMatches` and `markConversation` all walk through it — and
`renderedCopy` (`lib/clipboard.ts`) cuts the same subtrees out of both flavours
of the formatted copy: hidden for the `innerText` one, which reads what is
rendered, and deleted from a clone for the HTML. The attachment size line
(`ZoomableImage`) was the same leak before there was a name for it and now
carries the attribute too. The clamp in `reveal` still exists for the drift that
is not ours to fix — a tool block's chrome, markdown's own syntax — and this is
the rule that stops anyone adding a third.

## The two cross-session pages order themselves

Starred and Plans share `lib/order.ts` and `OrderBar`: one date field, a
direction, and grouping by session. **A group is ordered by its NEWEST member in
both directions**, which is what makes descending read as "the sessions I was
last in". The choice is per page in `localStorage`, like the reading preferences
in `viewPrefs.ts` — not in the URL, because the nav link carries no parameters
and would reset it on every click. The session list keeps its own machinery
(`filters.ts`: five sort fields, day/project grouping, all of it in the URL) and
shares nothing with this but the look of the controls.

## What folds

**Three things fold, and all three are presentation only**: a compacted stretch (`CompactedSegment`), a branch a rewind cut away (`DiscardedBranch`, grouped by `groupTurns`) and a turn's own answers. None of them may filter the data — `buildCostIndex` / `buildContextIndex` still run over every turn and are read by original index, which is the only reason the pills reconcile.

**What is folded lives in `TurnList`**, keyed on the session id, never in the component that draws it: a live session replaces the whole `turns` array every few seconds, so per-component state dies with the remount and any effect keyed on `turns` re-folds what the user just opened. For the same reason the "expand all" effects read the segments through a ref and key on the toggle alone. Deep links must unfold their way in — segment and turn — before scrolling, or the link silently does nothing.

## What cuts a tool run

Four things are lifted out from between the tool calls, because each is a turn of the conversation in miniature and reads as plumbing when folded in among twenty `Read`s. `toolCard` in `Turn.tsx` is the one place that decides which — the two run loops each ask it once, because a fourth `asked ? null : parsePlan(b)` was one more than that shape could carry.

**A question to the user** (`AnsweredQuestionCard`). The call itself stays inside the run, untouched — raw input, result, cost pill, and the `?tool=` anchor a deep link needs (checked: the link still opens exactly that one block). The card is the human reading of it and **never folds**.

**A plan** (`PlanCard`; `parsePlan` in `lib/plans.ts` is pure, so the card, the markdown export and the per-message copy cannot drift about what a plan is). `summarizeInput` used to stringify 25 KB of markdown into a one-line collapsed header. Two differences from the question card: the **body folds**, because a plan is long and the conversation has to stay scannable (its own `# heading` names it meanwhile), and the **refusal never does** — it is one sentence, it is why the plan was turned down, and it is what the next turn acts on.

**Files handed to the user** (`SentFilesCard`; `parseSentFiles` in `lib/sentFiles.ts` is pure, for the reason `parsePlan` is). The bug it fixes is the plainest one in this file: the last message of `fbc2e20c` reads *"you have them in the images above"* and there was nothing above it — a `SendUserFile` inside a collapsed run is a word in a list of tool names. The card names the files and **shows no thumbnail**: the transcript holds no bytes ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md)), so one per row would be a fetch per file of every delivery on screen. Each name is a `FileLink` instead, and the picture appears in the panel that was opened to look at it — see *File references* below. Nothing here folds; being seen is the whole point.

**A prompt typed while Claude was working** (`MessageItem.queued`) goes **on the rail, not at the prompt margin**. It did not open the turn it appears in, it interrupted it, so drawn where a prompt goes it cut the thread in two and split one piece of work across two folds. It keeps the user bubble's colour and its tail — it is still visibly the user speaking — and the `queued` chip explains the clock ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#queued-lines-attachment--queued_command) for why Claude Code agrees it is not a new prompt). It still shows when the turn is folded, indented.

> **The trap in all four: `costEntries` dedupes by message uuid WITHIN a run**, so a message whose calls land in two runs would be billed by both. `costOwner` drops to false after the cut, and that is the only reason the pills still reconcile. (For the queued prompt the cut falls between items, so there is nothing to undo.) The way to check it is on the page: collapse the runs — expanded, a run shows its own pill AND the per-message pills inside it, the same money twice — and the pills of a turn must still add up to its badge.

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
- **A tool block is its own box, EXCEPT when the message that made the call also wrote prose.** Then the run is drawn into that message's own bubble (`tools-before-ask`), and `closest('[data-bubble]')` climbed past the one call to the whole answer — 25 calls over the 20 largest sessions, and `b343d4ac`'s `toolu_01CyGpmXFjFcBj8apDVmAXck` flashed 19,383 characters to point at 17,047 of them. `anchorBox` tests `[data-tool-id]` first, which is safe because nothing carrying a message uuid has that attribute. (The third `ToolGroup`, the one for calls made BETWEEN two pieces of prose, was also the only one not passing `targetTool`. No transcript here takes that path — 0 of 6,295 calls, because Claude writes and then calls — so it opened no link anyone clicked; it was a third case written to differ from its two siblings.)
- **Landing on a tool means opening three things**: the turn (`locate` holds tool ids beside message uuids), its run (`ToolGroup`, whose target effect is declared AFTER the `expandAll` one so it has the last word on mount) and the call itself (`ToolBlock`, `data-tool-id`). Each opens and then lets go — `open={targeted || open}` would make it impossible to fold back with the link still in the URL — and only the run holding the target opens, never the session (checked: 4 tool blocks in the DOM of a 210-call session).
- **The anchor is polled for, not waited out once.** That chain is five state updates deep (segment, rewound branch, turn, run, block) and a single 100 ms guess at the end of it is a race on a big session.
- **The effect keys on the link and NOT on the data** — that is what stops a live session being yanked back to the anchor every few seconds — and the price is that asking for the SAME anchor twice does nothing at all, which is exactly what clicking a row of the subagent list again is. Hence `jumpNonce`: bumped on every jump ASKED for, in the deps, and deliberately **not** in the URL, because it is a gesture and not part of the link.
- **An offloaded tool output loads itself when it is the target** (`OffloadedResult autoLoad`): the deep scan reads those files, so the words looked for can be in one and nowhere else, and arriving at a "Load full output" button is the wrong answer to "show me the hit". It lands after the first marking pass, so the marks are re-run once — and only if the text really changed.
- **Showing a match is not the same as scrolling to its box**: a tool result renders inside a `max-h-96 overflow-auto` pre, so a hit 2,000 lines down was "on screen" only in the sense that its container was. `revealRange` walks every scroller between the text and the window, innermost first, and moves nothing when the mark is already visible.
- `matchSpans` is pure and takes plain strings — the text nodes' data — so the index arithmetic is checkable without a browser. It folds the pieces **concatenated**, not one by one: markdown splits a sentence into a node per emphasis, link and code span, and a phrase crossing one of those is exactly what a search finds and a reader cannot.

## The selected message

Clicking a message — or a tool call — selects it, and it stays selected until
something else is clicked or a click lands on the empty space beside it. A deep
link leaves the message it landed on selected too: the flash answers "which
one" and then gets out of the way, which is right for an animation and wrong as
the only record, so arriving from the search, from Prompts or from Starred now
leaves a mark that is still there a minute later.

It is **its own feature**, not the find bar's. The bar reads it; nothing else
about it depends on the bar being open.

- **`Bubble` still takes no `onClick`.** One handler on the scroller resolves
  `focusKeyAt`, so the invariant holds to the letter and its reason — a stray
  click folding the turn you were reading — never applies to something that only
  draws a ring. On the SCROLLER rather than the width-limited box inside it, so
  the empty gutters count as clicking away. (One handler versus three hundred is
  not what makes this fast: React delegates from the root either way. What it
  buys is the invariant and three hundred closures.)
- **`InjectedNotice` lost its own click at the same time.** It folded the turn
  in prompts-only mode — the very behaviour the bubble's invariant was written
  against — and had simply outlived it, which is why the region holding its
  report had to stop the event. Nothing to stop now, and a click there selects
  the notice like anything else.
- **A click also RETIRES the URL's anchor, when the anchor is no longer it.**
  `?msg=` has two lives and only one should outlast a click: followed from the
  search, from Prompts or from Starred it is a link and belongs in the address
  bar, while written by a jump inside the page — `↑ 2/4 mentions`, the subagents
  panel's `↓ the report` — it is a gesture that used to stay there for ever. F5
  then landed back on that message however long ago it had been left, and
  `useRestoredSelection` stood down because a link was present, so the remembered
  ring could not win either: there was no way out but editing the address bar.
  So a click that lands somewhere ELSE — another message, or the empty gutter,
  which is what deselecting is — deletes `msg`, `tool` and the `hl` words with it.
  Clicking the anchored box ITSELF changes nothing: it is still the place, and the
  marks and the Ctrl+F seed still belong to that arrival.
  - **The remembered ring is an opening move and is spent by the first click**
    (`restoreSpent` in the page). Retiring the anchor makes `anchorUuid` fall back
    to whatever the tab was left on, and without this the fallback fires as a
    fresh jump — a click on the gutter would send the reader to a message from ten
    minutes ago.
  - **The flash has to come off in the effect's cleanup**, by hand. `bag.clear()`
    has just cancelled the timer that would have removed it, so anything changing
    the anchor mid-flash — this retirement, or a jump pressed twice — left
    `match-flash` on that element for the life of the page: invisible, because the
    animation had already ended, and permanent, so a later link to the same
    message added a class that was already there and did not animate at all. The
    trace is the way to see it (`MutationObserver` on `class`, one `has: true` and
    no `has: false` after it).
- **`focusKeyAt` walks up and stops at the first message id**, which is wider
  than a marking box on purpose: a bubble's header, a notice's padding and a
  tool block's fold row are all still that thing, and losing the selection for
  missing the prose by three pixels would be its own bug. Nothing above the
  conversation carries a message id, so the empty page means "nothing".
- **The value lives outside React** (`lib/selectedMessage.ts`): a module
  variable, a `data-selected` attribute put on the element directly, and a
  subscription only where somebody really has to redraw — which is the find bar
  and nothing else. The same shape the search marks have, for the same reason.
  `TurnList` re-applies the attribute in an effect with **no dependency array**,
  because React owns those nodes and drops it whenever it rebuilds one.
- **`TurnList` is memoised, and that is what makes a click free.** Drawing a
  large conversation is 65-110 ms on the two biggest sessions here, and before
  the memo every click paid it. Every prop had to be memoised with it — `fold`
  in `useFoldState`, `footer` and `pending` in the page — or the comparison
  would never hold. Measured after: **no task over 50 ms at all**. It also stops
  the conversation redrawing for a panel opening, a star being set or a prompt
  being accepted.
- The ring is an **`outline`** and **repaints `[data-bubble-tail]`** with the same
  colour, for the reason in the flash section below. The property matters: both
  rings were `box-shadow` at first, so `match-flash` — whose last keyframe fades
  to transparent — overrode this declaration for its 2.5 s, and the ring
  therefore **dissolved and then snapped back** the instant the class came off. A
  link landed, the focus faded to nothing, and a moment later the box abruptly
  looked selected. Two properties instead of one and the overlap does the work:
  the flash paints its brighter ring over this one and, fading, reveals it. What
  is on screen is a bright ring settling into the steady one and nothing at all
  happening when the animation ends — a flash that hands over to a ring that was
  there all along.

### F5 lands back on it

The ring is remembered per conversation in `sessionStorage` — `ch:selected:<id>`,
beside the session list's own two keys in `lib/listState.ts` — adopted as the page
mounts (`useRestoredSelection`) and then made visible the only way anything in
this viewer is made visible: `SessionViewPage` resolves the remembered key into
the same `scrollToUuid` / `scrollToTool` a link would have given, and the jump
unfolds its way in. A reload therefore comes back to the message that was being
read, still ringed, rather than to the top of a three-hundred-message session.

- **The message is the address; a scroll offset is not.** A reload rebuilds every
  fold from its default — the compacted segments fold back, `expandSegments` is
  not persisted — so the pixel the reader was at points at a different part of the
  conversation afterwards. Landing on the message is the one thing that survives
  being refolded, and it is what "the same place" can honestly mean here. It is
  also why a reader who had selected nothing gets exactly what they got before:
  there is no address, so the session opens at the top.
- **Not in the URL, and that is the whole design decision.** The ring moves on
  every click, so `?msg=` would make every click a deep link — a flash, a scroll,
  and a fight with the follow in a live session — and would give one parameter two
  provenances, "the message a link asked for" and "the message somebody is
  pointing at". `sessionStorage` says the other true thing about it: it belongs to
  the tab that is reading, which is what F5 is, and a new tab starts with nothing
  selected.
- **A link outranks it**, and the restore is skipped entirely while `?msg=` /
  `?tool=` is in the querystring — that link is a request to stand somewhere and
  leaves a ring of its own on arrival, which then becomes what is remembered.
- **The follow stands down for it**, exactly as it does for a link: `autoFollow`
  reads the resolved anchors, not the parameters, or a live session would drag the
  page back to its end for as long as the turn lasted. Checked inside a live turn:
  the pill reads `To the end` with the restored message on screen 3,180 px above
  the end, while the spinner is still going.
- **It flashes.** `match-flash` is the reload's answer to the same question it
  answers for a search hit — which of these did I mean — and then wears off,
  leaving the ring as the record.
- **The slot is read once per conversation**, into a ref. Every click writes to
  it, so a second read on a later render would hand the page a fresh anchor and
  turn an ordinary click into a jump.
- Deselecting empties the slot, so clicking the gutter and reloading opens at the
  top: the reader said "nobody", and that is remembered too.

## Finding a word in the conversation

The browser's own Ctrl+F reads the DOM, and the DOM is whichever half of a
session happens to be unfolded — every tool run, every compacted stretch, every
rewound branch and every thinking block renders behind `{open && …}`. So it
finds an arbitrary fraction and says nothing about the rest, which is the one
thing this app refuses to do for a deep link. `FindBar` (`useFindBar` beside it,
the `FollowBottom` pattern) scans the data instead and travels the deep link's
road to whatever it finds.

**One rule holds the whole thing together: what the bar counts is what unfolding
can put inside a marking box.** A marking box is `[data-bubble-body]` or
`[data-tool-id]` — the two `markMatches` knows how to paint, and the two that
keep marks off headers, clocks and cost pills. `buildFindCorpus` emits exactly
one unit per box (`lib/findInSession.ts`, pure and checkable without a browser),
so a hit always has somewhere to land, and anything drawn outside a box (a
`/context` table, a compaction's arithmetic, a plan-mode marker) is neither
scanned nor counted. `InjectedNotice`, `CompactSummaryPanel` and `SystemItem`
grew a `data-bubble-body` to join in — the first of those also fixed the deep
link marking a notice's origin chip and clock.

- **A tool call is ONE unit, not three.** Header, input and result fold
  separately but share a `[data-tool-id]`, and a hit's ordinal only lines up
  with the DOM if they are counted as the one run of text the reader sees. Its
  input is folded as it is RENDERED — pretty-printed — and not in the compact
  form the deep scan reads, and its header is folded in the order it is DRAWN:
  name, `intent`, `inputSummary`.
- **The order is `turns` order**, which means imitating `TurnView`'s tool
  accumulator: a message's trailing calls are drawn AFTER its bubble and its
  leading calls inside it, so a flat walk that ignored that would sort them
  wrong. Thinking is always in the corpus whatever the toggle says — hiding it
  can only remove a bubble, never reorder what is left — and the toggle stays a
  filter over the hits, with the count of what it is holding back on the bar.
- **A `system` line is cut at 400 characters — except a recap, which is drawn
  whole.** It has no fold to open, so counting past what is drawn would offer
  matches nothing can show. `systemChars(subtype)` is the one function that
  decides, in `shared/src/searchText.ts` and re-exported from
  `findInSession.ts` where this component and the bar were written to read it:
  a recap is INDEXED ([AI_SEARCH.md](AI_SEARCH.md)), so what is drawn, what the
  bar folds and what the server indexes have to be the same call. The cap is
  there for `local_command`, whose longest line here is 2,456 characters of
  `<command-name>` markup; it was costing a recap a truncated last sentence.
  Its chip is a NAME, not the raw subtype (`lib/systemLines.ts`, shared with the
  markdown export so the two cannot call one line two things) — an `away_summary`
  reads `RECAP`, which is Claude Code's own word for it, with the tooltip saying
  why there is not one per turn. Only three subtypes ever get here; the map
  leaves everything else as the identifier it is, and
  [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#system-lines-by-subtype) says which and
  why. The chip is outside `data-bubble-body`, so renaming it moves no count.
- **Three things are outside the corpus and are said with a number**: outputs
  offloaded to disk, whatever exceeds `MAX_RESULT_CHARS` of a result, and
  subagent transcripts. 0.3% of calls here, and *Search ▸ deep* is what reads
  them.
- **The corpus is transcript text; the marks are painted on rendered markdown.**
  They agree for words. A query containing markdown's own syntax is counted and
  not painted, which is the price of counting what is folded.

**`RevealContext` generalises `targeted`.** `ToolBlock` could open itself from a
prop; a thinking block and an agent's report could not, so a match inside either
was countable and unshowable. The destination is published once, in the anchors
a jump already speaks (`msg:<uuid>`, `tool:<toolUseId>`), and `useFoldable`
holds the "open, then let go" contract for all of them. **`ToolGroup` reads it
too**, and must: a block cannot open a run it is not mounted in — without that,
the first real test scrolled to the message and marked nothing.

**Three highlight names, never one shared.** `search-match` is the deep link's,
8 s, untouched; `find-match` is every hit while the bar is open; `find-current`
is the one being stood on, with `priority` set explicitly rather than trusting
registration order. Sharing a name would let a deep link arriving replace the
bar's whole set and delete it 8 s later. Caps differ by question: 4,000 for the
conversation, 1,000 per box, and **none at all** for `boxRanges`, because
`matchSpans` caps inside its per-term loop and before the sort — a capped result
is "the first few of each term", fine for painting and useless for "the 137th in
document order".

**The repaint is a `MutationObserver`, and it is safe here only because the
marks are ranges.** Painting writes nothing into the DOM, so the pass cannot
trigger the observer that ran it; with `<mark>` elements this would be an
infinite loop. It is what catches a turn unfolding, a run opening, a block's own
fold, an offloaded output arriving and a live refetch replacing fifteen hundred
blocks, all with one mechanism — and it is where the current mark is resolved
again, because React may have thrown away the node it pointed into.

- **Typing never moves the page.** A step unfolds segment, branch, turn, run and
  block, and none of them fold back; jumping per keystroke would leave the
  conversation shredded open before the word was finished. The counter reads
  "47 matches" until the first Enter and "12 of 47" after. Chrome jumps as you
  type because Chrome has nothing to unfold.
- **No `match-flash` while stepping.** The reader typed the word and
  `find-current` says which one this is; 2.5 s of animation per Enter would be
  noise fighting `revealRange` for the scroll.
- **The first Enter is measured by what is ABOVE.** Most matches are folded and
  have no element to measure, and treating "no element" as "not yet reached"
  opened at the ninth of 113 with the page at the very top. An unmeasurable hit
  inherits the position of the last measurable one before it.
- **Where the reader stands is stored by identity** (`{key, ordinal}`), not by
  index: a live session appending a turn must not slide them onto another match.
- **Data decides, the DOM paints.** `N of M` comes from the pure scan and the
  ranges from `matchSpans` over rendered text, so the ordinal is clamped to the
  last range there is. The worst case is landing on a neighbouring match in the
  SAME box, and every match in that box is painted anyway.
- **Stepping leaves tool blocks open.** That is what was asked for. Check 9's
  "4 tool blocks in the DOM of a 210-call session" is about a deep LINK and must
  not be re-read as a statement about the bar.

**The scope follows the selected message, and only `All` is ever chosen by
hand.** Selecting a message means "search in this one" (`Current message`);
clicking away means "search what I can see" (`Visible`, which is also where the
bar opens); and nothing puts the reader into `All`. A scope that reaches into
folded text is a decision, not somewhere to find yourself.

- **`All`, once chosen, is held until the bar is closed** — selection or no
  selection. Asking for the whole conversation and then losing it to a stray
  click on the margin is the kind of help nobody wants, and closing the bar is
  the obvious "I am done with this search".
- **`Ctrl+Shift+F` opens straight on `All`**, whatever is selected. It is the
  other half of "All is never chosen for you": there has to be a way to ask for
  it that does not start with clicking away from the message you are reading.
- **The scope explains itself in a sentence, always** (`SCOPE_BLURB`). Two of
  the three are chosen for the reader and every button is two words, so the one
  thing that must never be a guess is where the number in the counter came from.
- **The cost of that default is real and is paid for out loud.** `Visible` is
  most of a conversation short, so a word living only in a folded tool result
  would read as "no matches" — precisely the answer this bar exists to stop
  anyone getting. So it never says that while a wider scope has more: the
  counter says **where it looked** (`none in visible`) and a button sits BESIDE
  the sentence, `N more in the whole conversation →`. One click, made by the
  reader, which is what "never automatically" means.
- **What the corpus could not reach carries its own explanation**, because the
  short version is not self-evident: *on disk, not searched* means output too
  large for the transcript, written to a file the browser never receives (deep
  search reads those); *searched only in part* means the result was cut at
  `MAX_RESULT_CHARS` on the way here, so everything before the cut is counted
  and nothing after it is.
- **Kinds are chips with their own counts**, so turning one off is informed
  rather than a guess, and a kind with nothing in it disables itself.
- **A row in the list leads with WHEN**, before the role: the rows come out in
  reading order, so the clock is the column that lines up down the list and
  gives it its shape. Short there and full on the hover, with the relative time. The rows are lines lifted out of a conversation, and a
  hundred of them all reading TOOL are otherwise the same row a hundred times;
  the clock is the only thing that puts them back. `SearchSnippet` carries no
  timestamp — the server's rows have none to give — so it rides on `FindUnit`
  and reaches `SnippetRow` as an optional prop.

**Scope and kinds live in component state, not in the URL.** `hl` means the
terms the SERVER matched; overloading it with a live client query would give one
parameter two provenances, and writing per keystroke into `useSearchParams`
re-renders the page for every character. The bar reads `hl` once, on open, to
seed itself — which turns "the search sent me here, now walk all of them" into
one keystroke — and writes nothing back. Whatever is off its default is said on
the bar itself, not only inside the panel: the same rule `tuningChanges` applies
to the session list.

### The flash animation

Only `box-shadow` and `border-color` are animated — and `box-shadow` is deliberately NOT what the selection ring uses, which is what stops the fade from erasing it (see *The selected message* above). A `transform` / `filter` / `opacity` flash would make the bubble the containing block for the cost and context popovers inside it — the `filter` rule above, from the other direction. The tint is an INSET shadow, not a background: a bubble paints its own, and animating that ends the flash on the wrong colour.

**Anything that recolours a bubble's outline must recolour its tail** (`[data-bubble-tail]`, its own keyframes). The tail is a separate element with its own border and its own OPAQUE fill, so it does not merely keep the old colour — its fill paints over the ring, punching a dark notch in the very line it exists to continue.

The `100%` keyframe names no `border-color`: an omitted property takes the element's own value as the endpoint, which is how one animation serves a terracotta bubble, an emerald one and an amber panel without knowing any of their colours (checked frame by frame: 217,119,87 → 39,74,65, the assistant border, with the tail in lockstep). Naming a colour there would mean naming the wrong one twice.

## File references

**A file path in an answer opens a panel, and `parseFileRef` is the only thing that decides what a path is** (`lib/fileRefs.ts`, pure and checkable without a browser). It reads the shapes this corpus really holds — `:12`, `:12:5`, `#L12-L20`, percent-encoded paths with spaces, `C:\…` and `\\srv\…` — and two orderings in it are load-bearing:

1. **The drive letter is tested before the scheme**, or every absolute path on Windows is discarded as "protocol `c:`".
2. **The scheme is tested after the line suffix is cut**, or `app.ts:12` dies as "protocol `app.ts:`" — precisely the react-markdown behaviour this exists to undo (`defaultUrlTransform` blanked both, so those links reloaded the page instead of navigating anywhere).

`urlTransform` in `Markdown.tsx` lets a file reference through and runs the default on everything else, which is what keeps `javascript:` blanked.

- **The reference comes from the href, never from the link text**: the model writes ``[:905](frmActualizador.frm:905)``, so the label is its wording and only the destination is a path.
- **The link is an `<a>` with a real href** (`/session/<id>?file=…`) whose click is prevented — copy-link, middle click and ctrl+click keep working, and a `<button>` would make the prose unselectable. It asks `hasSelection()` first, like every fold header.
- **Backticked paths are linkified in `strict` mode.** They are 33× more common than markdown links (4,347 against 131), but 2,994 of them are bare names — `package.json`, `settings.json` — half of which are not in the project at all, and a link the reader cannot judge without clicking is worse than plain text. Strict also wants a real filename or a line number at the end, because a separator alone proves nothing: `text/html` is a MIME type and `GET /api/retention` a route, and both were links until it did. The whole `<code>` span is one candidate, never scanned inside: that is what makes a path with spaces work and a shell command fail cleanly.
- **A range lives in the link TEXT, not in the destination.** Claude writes ``[:1068-1074](.../frmActualizador.frm:1068)`` — seven lines named, one linked — so `rangeFromLabel` takes the end from the label, and only when the label restates the same start. Without it the panel marked one line of a stretch and looked like it had lost the rest.
- **In a tool header and in "files touched" the path stays inert and a chip sits beside it**, because both live in a `FoldHeader`. The chip is gated on the tool NAME (`Read` / `Write` / `Edit` / `MultiEdit` / `NotebookEdit`, whose `inputSummary` IS the `file_path`), not on the shape of the string.
- **An image reference draws the picture instead of the word "binary"**, and that is why `KNOWN_EXT` has image extensions at all: until the panel could show one, a link to a PNG led to "Binary file — not shown", which is a worse reply than leaving the path as text. The bytes come from `GET /api/files/image` ([AI_ARCHITECTURE.md](AI_ARCHITECTURE.md)), because the read the panel already made answers `binary: true` and carries none. Two rules: the choice is made on the **path** (`isImagePath`) and never on the `binary` flag — that flag means "a NUL in the first 8 KB", which a small GIF can miss, and the panel would then draw a picture's bytes as mojibake — and the text body is held back on the same test, or a failed image and its own garbage would be on screen together. **`svg` is a reference but never a picture**, on both sides of the wire. A refusal or a file that went away between the read and the fetch is the `<img>`'s `onError`, which costs no request. `ZoomableImage` is shared with the prompt attachments, at `size="fill"` here and `thumb` in the conversation.
- A `~/...` reference is expanded against the home directory **server-side**: resolved against the project it becomes `<project>\~\.claude\settings.json`, a "not found" for a file that is right there. The panel sends the **path**, never the formatted reference — `frmActualizador.frm:1068` as a filename finds nothing.
- The target line is a stripe positioned by arithmetic on one `LINE_H`, so the body must stay `whitespace-pre`: one wrapped line and the gutter, the stripe and the text disagree from there down. **Everything neutralising `.hljs` on the highlighted `<code>` is a style, not a class** — `github-dark.css` loads after Tailwind and wins every tie. Its background covered the stripe; its `padding: 1em` then pushed the text 12 px below its own line number, so the highlight sat two thirds of a line off, and only where highlighting happened at all, which made it look intermittent.
- **The copy buttons float over the code, and they live OUTSIDE the scroller.** Inside it `absolute` scrolls away with the file, and there is no sticky corner to be had either: the row they would sit in is `min-w-max`, as wide as the longest line. Out there they cost no layout, so appearing on hover cannot resize what they appear in — the hover-toolbar rule above, obeyed by construction — and two offsets are the whole of their placement: clear of the scrollbar they now float over, and above the gutter's sticky `z-10`. They stay lit while the flash lasts, because moving the pointer away right after the click would otherwise take the confirmation with it.
- **What a copy button says is what it copied.** The whole-file one reads `Copy what was read` on a truncated read: the endpoint stops at 2 MB, and a button offering “contents” over half a file contradicts the `truncated — N total` notice three rows above it. The range one is drawn only where the stripe is and slices from the same `target`/`targetEnd`, so the band and the clipboard cannot disagree about which lines the link meant. Neither takes the gutter with it — the numbers are their own column, which is what makes copying the text possible at all — and **one state serves all three buttons**, the path included, so a second copy neither flashes its neighbours nor loses its own confirmation to the timer the first one started.

## The three file panels

The header carries three, and the words are the feature: **`Changed Files`** is what the session EDITED (`detail.fileChanges`, built server-side from `Edit`/`Write`/`NotebookEdit`/`MultiEdit`), **`Sent Files`** is what it HANDED OVER, and **`Mentioned`** is what it only TALKED about. While the first was called plain `Files` the second had no name left to take, and none of the three is another's superset — a delivered screenshot was never edited, an edited source was never delivered, and a file merely named was neither.

The third is the weakest of them by nature and says so on every row that needs it, because **a path in prose is written for a person**: `core/git.ts` for the real thing, `<pid>.json` for a naming scheme, `~/.claude` for a folder, `vX.Y.Z` for nothing at all. Measured over five sessions, 14 of 64 such paths pointed at a file that is really there.

**Which is not a reason to hide the others.** A mention that finds nothing is still something the answer said — the path may be partial, or the file may have moved since — so it is a row wearing `not found`, with its name in the dim colour, no size and no date invented for it, and the panel counting them out loud underneath (`1 of them point at nothing`). Hiding them was the first version's mistake and it made the panel quietly disagree with the messages the reader can see. **The one thing dropped is a folder**: this is a list of files, and `~/.claude` was the most-named "path" of one session, fourteen times over.

- **`collectMentionedFiles` may be STRICTER than the renderer, never looser** (`lib/mentionedFiles.ts`). What draws the links is `Markdown.tsx` over react-markdown's AST — an `inlineCode` node strict, an `a` href loose — and that AST is out of reach here (of the parsers involved only `remark-gfm` resolves in this package), so the candidates come from three expressions that deliberately miss a code span split across a newline and cut a fenced block whole. That direction costs a row the reader still has as a link in the message; the other would put a row on screen the conversation never offered. The DECISION is not re-implemented — `parseFileRef` makes it, with the same `strict` flag for the same kind of candidate.
- **The assistant's own answers, and nothing else.** Two other places name paths and both are out, the second having been in for one version and having had to come out:
  - **A prompt** renders `whitespace-pre-wrap`, so a path typed into one is not a link anywhere in this app.
  - **A subagent's report** does go through `Markdown`, so its paths ARE links — and reading them made this panel useless twice over. 23 of 23 rows of one session came from reports, drowning the four the conversation itself had pointed at; and the row could not keep its promise, because a report is folded inside a notice, so the jump landed on the agent's box with the named path nowhere on screen. **A row here must go somewhere the path can be READ**, and only an answer offers that. Checked, and worth keeping checked: the jump must land on a `[data-bubble]` whose own text names the file and holds it as a link.
- **Being in another panel is a chip, never a filter.** The first version dropped those rows because the information was "already elsewhere", and that took the most obvious mentions of a session with it — a file the answers keep pointing at is usually one the session also edited. `also changed` / `also sent` says it on the row instead.
- **`×N` counts PLACES, and it is a note.** It counted namings at first, which promised more than the jump could deliver: four occurrences in one paragraph read as four stops, while the marks only ever cover the message jumped to. It counts distinct messages now, with `hits` on the title (`named in 3 messages, 5 times in all`), and it is deliberately NOT a control — the jump beside it is, and it carries the same N.
- **The jump STEPS**: `↑ 1/4 mentions` goes to the first naming, `↑ 2/4 mentions` to the second, and the fourth press comes back round to the first — the label is a promise about the press, so it names the destination, and it carries the noun because a bare `↑ 1/2` is a fraction of nothing in particular on a row that already holds three other numbers. A file named once reads `↑ 1 mention`. The cursor is local to the row, so closing the panel starts again at the first. Exact by construction: it walks `row.messages`, which is the same list `×N` counts.
- **Why it is not the find bar's job, having been the find bar's job for one commit.** Handing the path to the bar on `All` looked like the reuse to prefer — it owns stepping, counting and marking already — and the arithmetic sank it. The bar counts every occurrence in the transcript: `AI_VIEWER.md` in `1806cedb` opens on **168 matches, 143 of them inside tool calls** (its `byRole` breakdown reads Prompts 3 · Answers 7 · Tools 143 · Plans 6 · Notices 9), against the **4** messages whose prose names it. Four namings behind 168 stops is not a way in, and no filter closes that gap honestly: the bar counts occurrences and the panel counts messages, so even a perfect "only file references" filter would say 7 rather than 4. Stepping over a list of uuids the collector already holds duplicates nothing — no corpus, no ordinals, no marks logic, just the same `jumpTo` per anchor.
- **The jump MARKS the path, and through the search's own mechanism.** It sets `?msg=` and `?hl=` together (`setHighlightTerms`, which folds the terms because that invariant is stated where the params are), so the arrival is the one `TurnList` already implements for a search result: the bubble flashes, every occurrence of the path in it is painted by the Custom Highlight API, the first is revealed, and the marks clear after 8 s. Scrolling to a 2,000-character answer and leaving the reader to find the sentence was the gap. Two terms, not one: the ref as written AND its basename, because a markdown link puts the path in the href and the filename in the words — marking only the ref would underline nothing at all. Passing NO terms clears the parameters, so a previous search's words never survive into an unrelated jump.
- **Deduplicated on the RESOLVED path, which is the only identity a mention has.** One answer naming `server/src/core/parser.ts` and another naming the same file absolutely are one file, and drew two rows until the dedupe moved there — which can only happen after the stat, because resolution is the server's answer. `×N` absorbs the spellings, and the `as written` column keeps the **relative** one only: an absolute ref is 130 characters of what the folder tail already ends with, and printed in the row it pushed every row past the window.
- **Its count is the one count in this header that is not a fact of the transcript**: it is what survives the disk — which candidates are folders, and which two spellings are one file. So the page asks for the stats **as soon as it has the transcript**, not on the first press. It was lazy at first, on the grounds that a reader who never opens the panel should pay nothing, and the price was the one button in that row that could not say what it held. What eagerness costs is one local POST per session view, and only where the answers named a path at all; nothing waits for it, so a path that is slow to `stat` (an unanswering UNC share) means a late number and never a late page. `null` is the moment before the answer lands.
- **`Mentioned (0)` is a real state and keeps its button**: it means every path the answers named is a FOLDER, which is the only thing dropped — a candidate pointing at nothing is still a row. That is also the only way to reach the empty panel, so it says exactly that rather than "nothing was named", which would be false there.
- **The size and the date are the file's own**, and they are simply absent on a row that points at nothing — a `0 B` and a 1970 date is a lie told twice about a file that is not there.

**What the second one lists is collected in the browser, and that is the point.** `collectSessionFiles` (`lib/sessionFiles.ts`, pure) reads three things out of `turns`: `parseSentFiles` for a delivery — the SAME parser the card and the markdown export use, so the three cannot drift about what was sent — `Artifact`'s `file_path` for a publish, and `planFilePath` / `PlanOutcome.filePath` for the plan `.md`. Nothing about it needs the server: the calls, their results and the plan-mode lines are all already in the payload, so there is no new field on `SessionDetail`, no parser change and **no `CACHE_VERSION` bump** (checked: `/api/meta` still reads its hits after this shipped).

- **Deduplicated by `normalisePath`**, which is exported from `lib/fileRefs.ts` precisely so this and the call↔result join of a delivery use one rule. It is not theoretical: plan mode writes the same precomputed path on every line it emits (up to 60 in one session), and one call spells a path `C:/…` where another spells it `C:\…`. The `×N` badge is suppressed on a plan row — counting mentions of a plan file as deliveries would read as `×47`.
- **The one thing asked of the server is `stat`, in ONE request for the whole panel** (`POST /api/files/stats`, [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md)). It is worth asking here and not in the card: what a session hands over lives in its temp scratchpad, which Windows sweeps, so **"it is not there any more" is the ordinary end of a delivery** and a list of dead links that does not admit it is worth less than no list. Per row it would be a fetch per file every time the panel opened, which is the same trade the card refuses when it declines to draw thumbnails.
- **The answer is joined on the `ref` the server echoed back**, normalised — never on the resolved path, which is the server's answer and not the key any row was built with, and never positionally.
- **One state column, one meaning: `on disk` / `changed since` / `no longer on disk`.** The raw `modifiedAt` was in that column for one draft and had to come out: beside the row's own timestamp it was a second unlabelled date, and two dates that mean different things read as neither. What is interesting about it is computed instead — `changed since` is earned by a size that differs from what was sent OR, for a row that records no size, by an mtime later than the line that named it, which is the one thing worth knowing about a file holding only the LATEST plan for its slug.
- **The jump names what it lands on**: `↑ the call` for a delivery or a publish, `↑ the line` for a plan file, which no call handed over. Both go through the page's `jumpTo`, so they clear the other anchor and bump `jumpNonce` — pressing the same row twice must jump twice.
- Local `useState`, not the URL, like `Tokens`, `Lineage` and `Changed Files`; `?agents=1` is in the URL only because the session list links straight onto it. Neither file panel is in the Escape unwind, and adding one without the other would be worse than leaving both out.

## The end of the conversation

The scroller reaches the **foot of the window** and the composer rides inside it:
last in the conversation's own column, `mt-auto` so it sits at the bottom of a
short session and `sticky bottom-0` so it stays there through a long one. Nothing
stops half way up the window any more — the scrollbar runs the full height, the
last bubble slides under the box instead of meeting a hard edge, and the follow
pill has a bottom to sit at. It costs no measuring either: as content, the box IS
the gap that keeps the last message clear of it, and `min-h-full` on the column is
what stops a two-line session becoming scrollable.

**The whole conversation stays readable, whatever the box is doing.** Two rules
hold that up, and both were bugs first:

- **The strip the fade covers is a real gap in the flow** (`pt-6` on the sticky
  wrapper, transparent, with the composer's own gradient drawn exactly over it).
  Without it the last bubble ended flush against the box and the fade dissolved
  its last 20 px — the message was on screen and unreadable, which looked exactly
  like being cut off.
- **Growing the box scrolls the conversation clear of it** rather than covering
  it: the growth is also new scrollable height, so moving `scrollTop` by the same
  difference hands back precisely what was covered (and shrinking gives it back).
  That is `footerRef`, and it is the half the pinning cannot do — with the follow
  switched off, nothing else would move. Six lines typed into the box, measured:
  composer 119 → 255 px, `scrollTop` +136, the last bubble still against the top
  of the gap, and the pill still reading `To the end`.

Three more things follow from the composer being inside the scroller, each of them
a bug until it was named:

- **The click that deselects stops at the composer.** The scroller's one
  `onClick` means "nobody is selected", and typing a prompt is not clicking away
  from the message you were reading.
- **`revealRange` must not count the covered strip as visible.** The bottom of
  the scrollport is *behind* the box, so a match in the last message could be
  "revealed" by being left exactly where nothing can be read.
  `[data-sticky-bottom]` is how the function measures what covers it.
- **The pill's corner is the corner `Send` sits in.** At `Full` width — or at any
  width in a window not much wider than it — the box reaches into the bottom
  right, and the pill, floating on top, would take the click. The action row gives
  up its end where the margin is narrower than the pill needs, as one `max()` over
  the column's width, so resizing the window needs neither a measurement nor a
  render.

**A `scroll` event does not say who fired it, and only the reader may arm or
release the follow.** Three things move that scroll with nobody touching it: the
browser clamps a `scrollTop` past the end when content shrinks, scroll anchoring
scrolls under content that grows above the viewport, and the pinning itself
scrolls on purpose. All three land AT the bottom when the reader was already
there — which is why switching the follow off used to last exactly one message.
So an event counts as the reader's only while `scrollHeight` is the one the
previous event left behind, and the `ResizeObserver` that does the pinning
re-reads that geometry after every content change, in the frame the content
changed and before the browser's own scroll event is dispatched.

**What lands while the follow is off is counted on the pill**, as a badge in the
app's one shape for "there is something here you have not seen" — `UpdateButton`'s,
amber with a ring in the page's background colour so two digits stay legible over
a bubble. The pill itself does not change with it: the badge is the news, and
turning the whole control amber would read as a warning about the button.

It counts **messages** — `turn.items`, the unit the header already counts as
prompts and responses. Not blocks (a turn's thirty tool calls are one message
doing thirty things) and not turns (which would sit at 1 through a whole answer
arriving). A message whose blocks are all tool calls draws a run rather than a
bubble, so the badge can read one ahead of the bubbles you can point at:
something did arrive below, which is all it claims. Three rules keep the number
honest — it is 0 while following, 0 again the moment the follow is armed, and **a
conversation arriving is not growth**: the count is 0 while the query is in
flight, for this session and for the one before it, so reading that transition as
news would open every session claiming its whole history.

**A live or busy session opens at its end, following**, because that is what it
was opened for: once per session, never over a reader who has already scrolled,
and never when the URL carries an anchor — `?msg=` / `?tool=` is a request to
stand somewhere, and the two would fight over the scroll for as long as the turn
lasted. The pill is offered whether or not there is anything to scroll; with
nothing to scroll it is the switch that says the next message will be followed.

## Nothing above the conversation may change height

A new message arriving made the whole page tremble, and the follow had nothing to
do with it. Sampled frame by frame in a live session (`scrollTop`, `scrollHeight`
and `clientHeight` on every `raf`, `scroll` and `ResizeObserver` tick), the growth
itself was clean — the content grew, the pin corrected it 1.5-2.9 ms later, inside
the same frame, and the sticky composer never left the foot of the window. What
moved was the **scroller's own height**: 762 → 784 → 762 px, twice per message,
about 105 ms apart.

The 22 px was the header's counts row (`9 prompts · 227 responses · …`), which was
drawn as `{e && …}` over `summary.enrichment` — and a session that has just grown
answers without its enrichment while the background parse catches up
([AI_ARCHITECTURE.md](AI_ARCHITECTURE.md)). So the row fell out of the page and
came back on every message, shoving the conversation down 22 px and pulling it
back. **`SessionHeader` remembers the last figures** and draws those while the new
ones are being computed: one message stale for a tenth of a second instead of
absent, and a session with no enrichment at all still draws no row, because there
is nothing to remember. The `resumed ×N` chip reads the remembered value for the
same reason — it sits in a wrapping row, where a chip coming and going can cost a
whole line.

The rule generalises past this one row: **anything above the conversation that
appears and disappears is a shake**, because the scroller is the flexible one and
takes the difference. And the follow's `ResizeObserver` watches the scroller
itself as well as the content, so if the end does leave the view that way — a
window being resized is the honest case — being pinned still means being at the
end.

## The working indicator

**The pill spins while a turn is in flight.** The indicator bubble says it far
better, but it says it at the END of the conversation: scroll up, or fold the turn
away, and the one thing left to know is whether anything more is coming. The pill
is on screen whatever the scroll is doing, so it carries the answer — the ring the
update button already spins, in place of the pill's own arrow, in the same 12 px
box so nothing changes width when a turn starts or ends. It is driven by
`isWorking(liveInfo)` and NOT by whether the footer is being rendered: the footer
is held back while a prompt of ours is still an echo, and the turn is in flight all
the same. It ignores `prefers-reduced-motion`, as every other animation in the app
already did — here the movement IS the state, and `styles.css` carries the why next
to the keyframes.


**It takes its status from the `['live']` query, NOT from `detail.summary.live`**, though both carry the same field. `['session', id]` is invalidated by `sessions-changed` — the transcript grew — while the busy/idle flip is a write under `~/.claude/sessions` and fires only `live-changed`. Read off the detail, the indicator would hang on "working" after the turn's last line was written, and the alternative (re-parsing a multi-MB transcript on every status flip) is absurd next to a query that reads two small files.

**It hangs on the last turn's RAIL, as a `footer`, not after the list.** An answer being written belongs where the answers are: rendered at root level it lined up with the prompt instead of with the replies, reading as a sibling of the question rather than as the response arriving (checked: left 262 px, identical to the assistant bubbles, against the prompt's 236). A turn that has produced nothing yet — the state of every session for the first seconds after a prompt — grows a rail of its own from the same `RAIL` constant.

It is still **NOT an item**: it never enters `turn.items`, so nothing that folds, counts or prices a message can see it. It is passed only while there is something to draw (`isWorking`), or the rail would be a stray green line down the page, and a folded turn shows it anyway — live news must not be hidden by a collapsed turn. `TurnList` picks the turn: the last group of the live segment, and only when that group is `live`, because hanging it off a rewound-away branch would say the abandoned exchange is the one being answered.

Why it says "working" rather than "writing", and why the silence it fills is so long, is in [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#live-sessions-and-streaming).

### Three clocks, and two of them are about the silence

The turn's own figure — `total`, how long it has run — answers "is this slow?"
and nothing else. What the reader actually wants to know while a turn hangs is
whether it is going anywhere, so two more sit beside it: **how long since the
model last wrote** and **how long since the last tool was called**. Both come
from the conversation (`lib/turnActivity.ts`, pure) rather than from
`/api/live`, which knows when the turn began and nothing about what has happened
inside it. All three are labelled, `total` included: bare, it was the only figure
and could only be the turn.

- **Every clock on the row belongs to the turn in flight.** A figure is shown
  only for something stamped AFTER the turn started, and an unknown start hides
  both — otherwise the previous turn's last word wears this turn's clothes, which
  is exactly what the echoed-prompt state would show (while a prompt of ours is
  still pending, the last turn in the transcript is the one BEFORE it).
- **A tool call is not a message, and only the model's output is one.** Count the
  message that made the call and the two figures are the same number for as long
  as a run lasts — two clocks that always agree are one clock and a lie — because
  a message ENDS with its calls. So `last message` takes the newest assistant
  item carrying anything that is not a `tool` block, and the prompt, a prompt
  typed mid-turn (`queued`) and an injected notice are all somebody else talking.
- **A tool is timed by when it was CALLED, not by when it came back.** A `Bash`
  four minutes into its run is precisely what these figures exist to reveal, and
  the result's own clock has nothing to say yet — it is the call that proves the
  turn got that far.
- **The two stamps of a merged message are what makes both readings possible.**
  `endTimestamp` is its last line, which for a message that called anything IS
  its last call (Claude writes and then calls — the same 0-of-6,295 fact the
  `tools-before-ask` note above rests on); `timestamp` is its first, which is
  where the writing was. So the message figure reads the START and the tool
  figure the END of the very same item. The per-block clock does exist in the
  transcript and is dropped in the merge ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#live-sessions-and-streaming));
  this is what survives of it, and it is enough.
- **The figures lag by a re-parse and are exact anyway.** They move when
  `sessions-changed` brings the conversation back, so one can appear a second
  late, but the value is read off the transcript's own timestamps rather than off
  a clock we started — never drifting, never invented.
- The absolute clock is on the hover, per figure. The row wraps rather than
  overflowing (measured: it still fits on one line inside a 417 px bubble at a
  520 px window, where the app's own layout is already the wider problem).
- **The number is brighter than its caption, and both pass AA.** One figure could
  be a bare number at `/70` of `--text-dim`; three of them written that way were
  one flat grey string to be read word by word, at 3.6:1 on the bubble — under AA
  for 12 px. The captions now carry the full dim (5.9:1) and the seconds carry
  `--text` (9.5:1), so the row is scanned rather than read. Not `font-mono`: the
  figures are already tabular, and mono spaced `3 min 25 s` out into something
  wider and clumsier than the sans.
- **The clocks sit at the far right of the bubble**, which is what makes the row
  a status line rather than a sentence with telemetry glued to it: the sentence
  owns the left, the clocks own the right, and the empty half between them is the
  separation. It also anchors the RIGHT edge, so `total` growing from `59 s` to
  `1 min 0 s` pushes leftwards and `last tool` — the figure that moves every
  second, the one being watched — never shifts under the eye.
- **Which means giving up the pill's corner, exactly as `Send` does.** The follow
  pill floats over the scroller's bottom-right, so where the column reaches the
  window's edge the two share that band: at `Full` width with no composer between
  them the pill covered `last tool` outright (measured: the figure at x 1380-1447
  under the pill's 1375-1470). The row gives up the difference with the same
  `max()` over `columnWidth` the composer uses — `PILL_CORNER_PX` lives in
  `FollowBottom.tsx` now, because it is a fact about the pill and two places
  spend it — and the floor is 0 rather than the composer's `0.5rem`: a flush edge
  is the point of aligning right. Checked at both widths, with the composer
  hidden: 48 px of clearance at `Full`, and at the default width the figures end
  1 px inside the bubble's own padding — no gutter where the pill cannot reach.
- **"With no composer" is the condition, not just the state it was measured in.**
  For a while it was only the latter: `columnWidth` went to the indicator whatever
  the foot held, and since the `max()` compares the column with the WINDOW and
  nothing else, at `Full` width the clocks always shed the full 120 px — in every
  session with the chat on, where the pill cannot reach them, dragging the figures
  off the very edge the row is anchored to. The pill's band is the bottom 16-46 px
  of the scroller (`bottom-4` plus its own 30 px); the sticky composer is stuck
  across that band and is never shorter than ~70 px of box plus its 24 px gap
  (measured: 119 px). So with a composer the pill floats over THAT, the clocks are
  clear of it by construction, and `SessionViewPage` hands them no width at all
  (`clockColumnWidth`, one `chatEnabled` away from `columnWidth`). Measured with
  the chat on at `Full`, 1500 px window: padding 0, the figures ending 13 px inside
  the bubble's right edge — its own padding — and the pill 126 px BELOW the row,
  over a composer 155 px tall. Still no measuring and no render on resize: the
  arithmetic is the same, it just has the switch it was always described with. The
  composer's own `max()` is untouched: `Send` really is in that corner.
- **And the composer takes the width on the same terms**, which is the same rule
  read from the other end: `columnWidth` is optional there too, and the caller
  passes it only where a pill exists to be dodged. `SessionViewPage` always does;
  the new-session page ([AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md#starting-one-that-does-not-exist-yet))
  has no conversation to follow and so no pill, and passing a width there would
  have bought a gutter against nothing — the mistake this bullet is about, one
  component along.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 2, 9 (marking search hits), 16 (rewinds in the viewer), 18 (working indicator), 21 (file viewer), 22 (subagent panel), 24 (question cards and drawings), 25 (the star and the Starred page), 26 (the find bar), 27 (the foot of the conversation), 28 (delivered files and the panel's pictures).
