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
- **A session with no transcript YET is not a session that does not exist** — the page draws it from the reservation ([Running Claude](AI_RUNNING_CLAUDE.md#starting-one-that-does-not-exist-yet)), and only a 404 with no reservation behind it is an error.
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
- **Nothing at the foot of the conversation may hide the END of it** — growing it scrolls the conversation clear, from the end and only from there; a reader in the middle is left exactly where they were and the box floats over them.
- **No row above the conversation may come and go** — least of all one gated on the enrichment.
- **A panel opens BESIDE the conversation, never above it**, and only one is open at a time.
- **The rail is furniture**: it is always drawn, and nothing — drawer, file viewer — may cover it.
- **The find bar belongs to the conversation's column**, not to the page.
- **Anything that measures the column measures `--conv-box`**, never `100vw`.
- **Every clock on the working indicator belongs to the turn in flight**, and a tool call is not a message.
- **A `Bubble` is for somebody speaking** — it has a tail, and a tail points at a speaker. Status, telemetry and chrome are drawn as rows.
- **A row drawn outside a bubble carries its own `relative`** if anything in it is `position: absolute` — `sr-only` included. Escaping the scroller grows the PAGE.

## Three layout rules that keep breaking

**No ancestor of a message may carry a `filter`** — a `hover:brightness`, an opacity animation, anything. `HoverCard` (the cost and context popovers) is `position: fixed`, and a filtered element becomes the containing block for its fixed descendants, so the card anchors to the bubble instead of the viewport. Hover feedback goes through a ring or a border.

**Anything `position: absolute` inside the conversation needs a positioned ancestor inside it.** The same fact read from the other end, and the one that bites hardest, because what escapes is not a popover but the PAGE. The scroller's own wrapper (`relative min-h-0 flex-1`) is positioned and sits OUTSIDE the scroller, so an absolute element with nothing nearer becomes its child: it is then laid out at its flow position **plus the scroll offset**, lands hundreds or thousands of pixels below the window, and the document grows to contain it — a second scrollbar into an empty screen, worse the further down the conversation you are. Measured on the working indicator's `sr-only` sentence (Tailwind's `sr-only` is `position: absolute`, which is easy to forget it is): 4,263 px down an 802 px window, 3,462 px of page scroll that should not exist, gone the moment its row was made `relative`. **`Bubble` is why this had never happened before** — it is positioned for its tail, so everything drawn inside a message has always had a containing block a few pixels away. Anything NOT in a bubble has to bring its own, and the way to check is one CDP scan: every `position: absolute` under `[data-conversation-scroller]` whose `offsetParent` the scroller does not contain (check 18).

**Nothing that folds may be a `<button>`.** No browser lets a button's text be selected, and a fold header is where the viewer writes the figures worth copying: the tool name with its arguments, file paths, the dates and cost of a compacted stretch, token counts. They all go through `FoldHeader` — a div with `role="button"`, `tabIndex`, Enter/Space and `select-text` — and everything that folds on a click (an injected notice, the log rows) first asks `hasSelection()`, or a drag ending inside it collapses what the user was about to copy.

- **A tool header has two voices, and the prose comes first.** `intent` — what the model said it was doing — then `inputSummary`, the command itself, dimmer and monospaced ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#line-types) for where it comes from and how often). Both sit in ONE truncating box so there is a single ellipsis and the sentence gets the room, and they are separated by a MARGIN rather than by a character: `findInSession` folds the same header from the same two fields in the same order, and a `·` drawn in only one of the two corpora is a character the ordinals could disagree about.
- **A message bubble is not one of them.** A prompt used to fold its own turn in prompts-only mode, and an accidental click there hid the answer being read, so `Bubble` takes no `onClick` at all: a turn folds only from its fold strip.
- Two consequences: **nothing interactive may be nested inside a `FoldHeader`** (copy buttons, cost pills and the subagent link are siblings in the header row), and a shrink-wrapped header needs `w-fit`, which the `<button>` gave for free.
- Real buttons stay real: the header's mode toggles are controls with nothing to copy.

## The header, and where the panels went

The header carried **eighteen controls in one row** — twelve toggles, `View`,
`Export .md` and the four resume buttons — which at 1440 px is about 2,030 px of
content in the 1,408 available: the title truncated to `Redise…` and the row ran
off the screen. The count was the symptom. What made it unreadable is that those
eighteen mixed **four unrelated kinds of thing at one visual weight**: how the
conversation is drawn, which panel is open, what can be done with the session,
and find.

Each kind has one home now, and the header is two rows — 65 px measured, against
95:

| Kind | Where it lives |
| --- | --- |
| How the conversation is drawn | `ViewMenu` — thinking, tool calls, compacted stretches, the two folding actions, zoom and width. Lit when **anything** in it is off its default, which is the rule `ViewButton` applied to two values and now covers five. |
| What can be done with the session | `SessionActions` — `❯ Resume` as a button of its own, and `⋯` for export, the project folder, VS Code and the resume command. |
| Which panel is open | The rail down the right-hand edge (`lib/inspector.ts`, `InspectorRail`, `Inspector`). |
| Find | `FindButton`, which lives beside the bar it opens. |

Row two is the facts — branch, model, entrypoint, both dates and the four counts
— ending in `more`, which holds what you look UP rather than read: the slug, the
`cc` version, the context entries, `resumed ×N`, the fork chain, the PR links and
the id with its copy button. Remembered in `localStorage`, like the reading
preferences.

The dates are `formatDateTimeShort` with the full stamp on the hover, which is
what that helper was written for: a clock beside other facts, not the fact
itself.

Three duplications went with the rewrite. The pin was the `★` badge AND the star
button; the subagent count was the `⑂ N` badge AND a button; and five panels
wrote their own name at the top of a column whose title bar already said it.
`SessionBadges` takes `omitPinned` / `omitAgents` for the first two.

**Rename and pin stay as the `✎` and `★` beside the title, on hover**, exactly as
in the list, and are deliberately absent from `⋯`: a second way in is a second
thing to keep in step. `originalTitle` keeps its own row whenever a local rename
exists — a hard rule, not a detail of layout.

**Escape closes a menu instead of leaving the page.** `usePopover` listens on the
`document` in the CAPTURE phase and stops the key there, so the page's own
listener on the `window` never sees it. Neither of the popovers it replaces did
this, which was harmless with a pair of checkboxes in them and would not be with
the session's actions.

### The rail and the inspector

**Panels are not stacked above the conversation any more.** Every one of them used
to be inserted between the header and the scroller, so opening one pushed down
exactly what you were reading, and having two open pushed it down twice.
Measured on `f3384d17`: opening a panel leaves the scroller's `clientHeight`
unchanged, which is the assertion [check 27](AI_TESTING.md) makes about a message
arriving, now true of a panel opening too.

- **72 px, and every item carries its label.** Not the 44 an icon needs: six
  unlabelled glyphs down the side of a window is six things to learn and a
  tooltip to wait for.
- **An item exists only when its panel has something in it** — the rule the six
  buttons already followed. `Tokens` is the only one always there. A panel that
  stops existing cannot stay open (`useInspector` re-checks on every render), or
  a session whose last agent row went away with a re-parse would leave the
  inspector holding a title with nothing under it.
- **One at a time, which is what gives Escape one meaning.** The unwind is
  `file → agent → inspector → find bar → back`, and the inspector is one branch
  for all six panels — see [the three file panels](#the-three-file-panels) for
  the objection this answers.
- **`?agents=1` stays in the URL** because the session list links straight onto
  it; the other five are the hook's own state. Opening any of them clears the
  parameter, which is why `closeAgents` exists beside `toggleAgents`: asking a
  toggle to close something already closed would open it.
- **One width for every panel**, dragged from the seam and remembered
  (`inspectorWidth` — the session list's `sidebarWidth` pattern, mirrored,
  because this one grows leftwards). One width is what keeps the panels honest:
  each has to read at 320 px, which is the work that turned the token table into
  a stack of cards and made every file row wrap.
- **The host owns the background, the border and the scroll.** Every panel lost
  its own `border-b`, its `bg-[var(--bg-raised)]/50` and — the one that mattered
  — its `max-h-[45vh] overflow-y-auto`, which inside a scrolling column would be
  a scroller inside a scroller.
- **`--conv-box` is what the column measures itself against.** The composer and
  the terminal give up the follow pill's corner wherever the column reaches the
  edge of the box it is centred in, and that box is no longer the viewport. It is
  set once, on the row that holds the three columns, and inherited — so the two
  of them and the width calculation cannot disagree. It falls back to `100vw`,
  which is what makes the new-session page's thread work unchanged.
- **`data-inspector` and `data-inspector-rail`** are measurement hooks, like
  `data-conversation-scroller` and `data-sticky-bottom`.

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

**The user pressing stop** (`InterruptMarker`, block kind `interrupt`) is the fifth, and the only one that is not a message at all: Claude Code writes `[Request interrupted by user]` as a `user` line ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#the-stop-marker-request-interrupted-by-user)), so it drew a bubble in the user's own colour quoting words nobody typed — and `isPromptItem` counted it, so every fold header above it said one prompt too many. It is drawn as the event it is: a thin rose line on the rail with the answer it cut short, no timestamp of its own (it lands within a second of that answer), and it stays visible when the turn is folded, like the "rewound away" notice. The cut it makes falls between items, so there is nothing for `costOwner` to undo — and being always the last item of its turn, no run follows it anyway.

> **The trap in all four: `costEntries` dedupes by message uuid WITHIN a run**, so a message whose calls land in two runs would be billed by both. `costOwner` drops to false after the cut, and that is the only reason the pills still reconcile. (For the queued prompt the cut falls between items, so there is nothing to undo.) The way to check it is on the page: collapse the runs — expanded, a run shows its own pill AND the per-message pills inside it, the same money twice — and the pills of a turn must still add up to its badge.

## Subagents on screen

`SubagentsPanel` is the index of the call, the report and the transcript (see [AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md) for what joins them): the call is a `ToolBlock` with a chip named after the agent type, the report an `InjectedNotice`, the transcript a `SubagentDrawer`.

- Opened by the ⑂ badge in the LIST, and by the rail on the session page — where the badge is omitted, because the rail already carries the count ([the header](#the-header-and-where-the-panels-went)). Its `?agents=1` lives in the URL because the session list opens a session straight onto it; the drawer's `?agent=` is a different parameter for a different thing.
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
- **A row in the list leads with WHEN**, before the role — the same clock the
  global search's rows now carry, and for the same reasons:
  [AI_SEARCH.md](AI_SEARCH.md#a-row-says-when-it-was-written). What is this
  bar's own is where the hour comes from: `FindUnit.timestamp`, which
  `hitSnippet` puts on the block it builds, so the row is served by the same
  field the server fills.

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
- **All six panels are one value now** (`useInspector`), which answers the objection that kept these two out of the Escape unwind — putting one in and not the other would have been worse than neither. There is one thing open and one thing to close. `?agents=1` is still the only one in the URL, because the session list links straight onto it.
- **Their rows wrap.** Each is a flex line of `shrink-0` columns — a name, a type, a size, a state chip, a date, a folder tail, a jump — and six of those do not fit the 320 px the inspector can be dragged to, however small the type: `Sent files` wanted 789 px and scrolled sideways. `flex-wrap` with a row gap leaves them unchanged wherever there is room.

## The end of the conversation

**Two things can sit in this slot** — the composer, or an embedded terminal, decided by `chatMode` ([Running Claude](AI_RUNNING_CLAUDE.md)). The wrapper is deliberately the same for both: what changes is how you talk to Claude, not where the conversation ends, and a slot that moved between the modes would announce itself as a different screen. So everything below is written about the composer and is true of the terminal word for word — `footerRef`, `data-sticky-bottom`, the click that must not deselect, and the `max()` that keeps the follow pill's corner clear.

Two things the terminal added, both of them properties of this slot that nobody had had to name before:

- **A portal cannot be used from here.** xterm is attached to a host div by `term.open()`, so rendering the panel somewhere else unmounts that div and takes the terminal's whole DOM with it — a full screen with nothing in it, measured. Full screen is therefore a class on the element that is already there.
- **`position: sticky` creates a stacking context.** A `fixed inset-0 z-50` child of this wrapper is numbered only against its siblings, so the follow pill — a later sibling of the scroller, with no z-index at all — paints over it. Lifting the wrapper is the only fix available, and it is why `SessionTerminal` reports its layout to the page.
- **Who gives up the pill's corner depends on what is in it.** The composer keeps `Send` out of it with a `max()` over the column width and gives up nothing else, because a composer has corner to spare. A terminal has none: every cell is content, and reserving 120 px there just makes the panel narrower than the conversation above it for no reason a reader can see. So the PILL moves instead of the panel shrinking — but only when it has to. At the ordinary column width the gutter beside the panel is 252 px of nothing and the pill stays exactly where it has always been, bottom right; it climbs above the panel (`liftPx`, the panel's measured height) only once `rightGap` falls under `PILL_CORNER_PX`, which in practice means `Full`. Measured from the panel's own right edge to the scroller's, never inferred from the width setting.
- **The terminal's drag handle spans the scroller, not the column.** A resize bar the width of the panel reads as part of the panel; one that runs edge to edge reads as the seam it is. The width is measured (`clientWidth` of the element tagged `data-conversation-scroller`) rather than written as `100vw`, because the scroller reserves a scrollbar gutter on both edges and pads itself — a viewport-wide child would hang outside its padding box and earn the page a horizontal scrollbar.

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
- **Growing the box scrolls the conversation clear of it — but only from the
  END.** Down there the growth is also new scrollable height, so moving
  `scrollTop` by the same difference hands back precisely what was covered. That
  is `footerRef`, and it is the half the pinning cannot do — with the follow
  switched off, nothing else would move. Six lines typed into the box, measured:
  composer 119 → 255 px, `scrollTop` +136, the last bubble still against the top
  of the gap, and the pill still reading `To the end`.

  **Anywhere else the box floats over the conversation and the scroll is left
  alone.** The embedded terminal is what made the difference impossible to miss:
  the composer grows by a line and the compensation reads as a nudge, a terminal
  opens 380 px tall and the same line of code reads as the page jumping under
  somebody who was reading the middle of a session. Nothing about their page has
  changed, so nothing about their page may move — a strip they are not looking at
  being covered is the smaller price by far. **The test is the geometry, not the
  follow flag**: the distance from the end *before* the change, which is the one
  measured now less what has just appeared, so at the end with the follow off it
  still compensates. And **shrinking needs no rule at all** — at the end the
  browser's own clamp has already pulled `scrollTop` to the new maximum, which
  leaves the last line where it was with more history above it, and in the middle
  there is nothing to clamp.

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
takes the difference. Which is the other half of why the panels moved to the side
([the rail](#the-rail-and-the-inspector)): every one of them was a row above the
conversation that appeared and disappeared, 300 px of it rather than 22. What is
left up there is the header, and the two things in it that can change height do
so because they were clicked — `more` and the find bar. And the follow's `ResizeObserver` watches the scroller
itself as well as the content, so if the end does leave the view that way — a
window being resized is the honest case — being pinned still means being at the
end.

## The working indicator

**A spinner and its clocks, and no box around them.** The row is telemetry about
a turn in flight — what it says is "still going, and here is how long" — so what
it is made of is the app's own ring (`animate-spin` on a 12 px bordered circle,
in the accent) with the figures held against it, floating under the last thing
that landed.

**It wore a `Bubble` for a while, and that was the error worth naming.** A bubble
has a border, a fill and a TAIL, and a tail points at a speaker; nobody is
speaking here. The row is not an item, nothing folds, counts or prices it, there
is nothing in it to copy — and being a bubble made it a **marking box**
(`data-bubble-body`), so a find for `total`, `last` or `working` painted marks
over words the transcript never held, in a box `boxKeyOf` cannot name and the
find bar therefore cannot step to. That is exactly the drift `data-chrome` exists
to stop, one component too late; `InterruptMarker` had already been through the
same correction from the other direction ([What cuts a tool run](#what-cuts-a-tool-run)).
Bubbles are left saying the one thing they are for.

**The sentence is drawn only when it is news.** `Claude is working…` is what a
turning ring beside a running clock already says, and written out it repeated
itself in the reader's eyeline for every second of every turn — so it lives in
`WORKING`, rendered `sr-only`, which is what a live region needs to have anything
to announce (and which keeps `[role="status"]`'s `textContent` exactly what the
checks in [AI_TESTING.md](AI_TESTING.md) read). The `news` prop is the other
half: passing a sentence is what makes one visible, and the only caller that does
is the subagents-outstanding footer, where the COUNT cannot be inferred from a
spinner. That prop is the whole rule — if you are passing a sentence, it is
because the spinner cannot say it.

**Which is why the row itself is `relative`, and it is load-bearing.** An
`sr-only` span is `position: absolute`, and the bubble this row used to be was
positioned for its tail; a bare row is not, so the sentence escaped the scroller
and grew the PAGE by thousands of pixels — the third layout rule above, in the
one place that found it.

**The pill spins while a turn is in flight.** The indicator row says it far
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

**The bar is the clock, and nothing else may be.** The card closes on the bar's `animationend`, not on a timeout of its own — because hovering pauses the animation and a timeout knows nothing about that, so a card held under the pointer used to disappear anyway with its gauge frozen at 30%. Two clocks for one fact, and the visible one was the liar. `TOAST_MS` and the `10s` in `styles.css` still have to agree, but only so the figure can be read in both places; what ends the card is the animation finishing. There is a backstop far beyond any human pause, for a browser where the animation never runs at all.

**`MAX_VISIBLE` is a hard ceiling, not a budget.** Every stop that happens together should be on screen together, so it is set where six cards still fit the shortest window worth caring about (76 px each and 8 px of gap: 548 px, inside a 600 px window) rather than where the list looks tidy. When it bites, what is dropped is the announcement and never the record — the bell holds them all, with the count on the badge directly above the stack.

**A stop is announced once, and the bell is the record.** The cards in `NotificationToasts` are raised by a row APPEARING, never by one existing — the first answer to `['notifications']` seeds silently, so a reload does not throw up the whole list. The clock is a `lastAt` per session rather than a set of keys, which keeps it the size of the sessions involved and makes withdraw-then-raise behave. Closing a card leaves the row: the cross says `Close`, and only the panel's says `Dismiss`.

**They sit under the header on the right, not in the bottom-right corner.** That corner is the busiest geometry in the app — the follow pill is in it, `Send` is under it, a terminal's resize handle crosses it, and all of it is measured — so cards there would need a new set of collision rules for nothing. Under the header they appear where the bell they belong to already is, which is also the only thing on screen that explains where a card went when it goes. `z-[35]` puts them below the popovers on purpose: opening the bell covers them, because you are then looking at the list they were announcing.

**`busy` is the only status that means working, and `waiting` is emphatically not it.** A session with a dialog on screen has a turn open and nothing moving in it — the CLI is blocked on a person — so `isWorking` tests `LIVE_BUSY` alone and this row stays dark. What draws instead is the list badge (amber, reading `waiting`, with `waitingFor` on the hover) and a row in the header's bell; the four statuses and what each means are in [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#status-has-four-values-and-one-of-them-says-the-session-is-waiting-for-you). Spinning here for a session waiting on a permission would be the one lie this indicator could tell: the reader would wait for an answer that cannot arrive until they go and give it.

**Whether anything is working, and since when, are the CALLER's answers.** The row takes a `since` and works the clocks out from it; it knows nothing about a session. A session reads both off `~/.claude/sessions` — `isWorking` and `workingSince`, kept beside each other because they are one reading — and a subagent has no file there at all, sharing its parent's process, so it reads its own transcript instead. The signature used to be a `LiveInfo`, which the new-session page had to forge with six null fields to hand over one timestamp.

**It hangs on the last turn's RAIL, as a `footer`, not after the list.** An answer being written belongs where the answers are: rendered at root level it lined up with the prompt instead of with the replies, reading as a sibling of the question rather than as the response arriving (checked: left 262 px, identical to the assistant bubbles, against the prompt's 236). A turn that has produced nothing yet — the state of every session for the first seconds after a prompt — grows a rail of its own from the same `RAIL` constant. **With the box gone the rail is the only thing left that says which turn this belongs to**, which is why it was kept when the bubble was not.

It is still **NOT an item**: it never enters `turn.items`, so nothing that folds, counts or prices a message can see it. It is passed only while there is something to draw (`isWorking`), or the rail would be a stray green line down the page, and a folded turn shows it anyway — live news must not be hidden by a collapsed turn. `TurnList` picks the turn: the last group of the live segment, and only when that group is `live`, because hanging it off a rewound-away branch would say the abandoned exchange is the one being answered.

Why it says "working" rather than "writing", and why the silence it fills is so long, is in [AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#live-sessions-and-streaming).

### Four clocks, and two of them are about the silence

The turn's own figure — `total`, how long it has run — answers "is this slow?"
and nothing else. What the reader actually wants to know while a turn hangs is
whether it is going anywhere, so two more sit beside it: **how long since the
model last wrote** and **how long since the last tool was called**. Both come
from the conversation (`lib/turnActivity.ts`, pure) rather than from `/api/live`,
which knows when the session last went busy and nothing about what has happened
inside it. A fourth appears only on a turn somebody interrupted: **how long since
the user last put something in**. All four are labelled, `total` included: bare,
it was the only figure and could only be the turn.

- **A session goes busy when the user gives it something BACK** — the prompt that
  opened the turn, an answer to a question, a permission granted. So
  `statusUpdatedAt` is not "the turn started", it is "you last unblocked it", and
  reading it as the former restarted `total` from 0 at every interruption — on a
  turn the transcript never split, because a queued prompt is delivered INTO the
  turn already open
  ([AI_TRANSCRIPTS.md](AI_TRANSCRIPTS.md#queued-lines-attachment--queued_command))
  and an `AskUserQuestion` answer is not an item at all, it is the call's own
  `result` ([AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md)). So
  `total` counts from the transcript's own boundary, which already holds both
  inside the turn.
- **The flip is only HALF of your last word, and it is the half about waking a
  session up.** A prompt typed while Claude works wakes nothing: the session was
  never asleep, `status` stays `busy` right across the delivery, and
  `statusUpdatedAt` goes on naming the turn's own start — measured on `06b1f9ec`,
  where a queued prompt had been delivered and answered and the flip had not
  moved. Its own line is the only record of it, so `last input` takes whichever
  of the two stamps is the more recent, and the hover names the act because they
  are not the same one: `You typed this` (and that stamp is when it was TYPED,
  never when it was handed over — nothing records that) or `You answered`.
- **`last input` is second in the row because it re-anchors the two after it.**
  On a turn that waited on a question, `last message` is OLDER than what `total`
  counts from and reads as a hang until this figure says the turn was waiting on
  YOU. It is drawn only when the turn was really interrupted (`turnClocks`
  returns null otherwise, and under 5 s from the turn's start it would be the same
  number as `total` written twice — which is every ordinary turn, plus the gap the
  composer opens by stamping `turnStartedAt` on the click, a moment before the
  prompt's first line reaches the disk).
- **The transcript is right about the turn and the flip is immediate, so the rule
  is which to believe when** — one pure function, `turnClocks`, and nowhere else.
  Between a prompt and its first line reaching disk the last turn on record is
  still the PREVIOUS one, and anchoring there would read `total 3 hr` for a second
  at the start of every turn. So the turn is adopted only once it is demonstrably
  the one in flight, by either of two signs: something in it was written at or
  after the flip, or its last item is one Claude has yet to answer — a queued
  prompt (whose line is appended at DELIVERY, so being last IS that window), a
  call that asks a human (`AskUserQuestion`, `ExitPlanMode`), or a call with no
  result. **Nothing else in the turn is read until one of the two holds**, the
  queued stamp included: a clock taken off a turn that may be the previous one is
  the very thing this guards against. Named rather than "ends on a call" because a turn ends on a call that
  came back all the time: a `<task-notification>` opens a turn of its own and cuts
  the previous one exactly there. **Measured exposure of the sign that can be
  wrong**: 2 of 94 ended turns across the 30 most recent sessions of this project
  would lend their start to whatever opens the next one, for the second the
  watcher takes to catch up — against a `total` stuck at 0 for the 5-20 s Claude
  takes to write its first block after every question.
- **Every clock on the row belongs to the turn in flight.** A figure is shown
  only for something stamped AFTER what `total` counts from, and an unknown start
  hides both — otherwise the previous turn's last word wears this turn's clothes,
  which is exactly what the echoed-prompt state would show (while a prompt of ours
  is still pending, the last turn in the transcript is the one BEFORE it). The
  gate is the ANCHOR and not the flip: gated on the flip, `last message` would
  vanish the moment a question was answered, which is when it says the most.
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
  overflowing — a narrow column or a 150 % zoom breaks the line at a `·`, never
  inside `1 min 4 s`, which is what the `nowrap` on each figure is for. It used to
  fit on one line inside a 417 px bubble at a 520 px window; without the bubble it
  has that box plus its padding, and the app's own layout is the wider problem
  there either way.
- **The number is brighter than its caption, and both pass AA.** One figure could
  be a bare number at `/70` of `--text-dim`; three of them written that way were
  one flat grey string to be read word by word, at 3.6:1 — under AA for 12 px. The
  captions carry the full dim and the seconds carry `--text`, so the row is
  scanned rather than read. **Both readings went UP when the box went**: against
  the page's own `--bg` they are 6.3:1 and 13.8:1, where on the assistant bubble
  they were 5.8 and 9.5. Not `font-mono`: the figures are already tabular, and
  mono spaced `3 min 25 s` out into something wider and clumsier than the sans.
- **The clocks are held against the spinner, at the left**, one compact group
  rather than a status line stretched across a box. What that gave up is named
  here because it was real and measured: anchored to the far right, `total`
  growing from `59 s` to `1 min 0 s` pushed leftwards and `last tool` — the figure
  that moves every second, the one being watched — never shifted under the eye.
  Held left, that jump travels rightwards instead; it lands once a minute, on
  figures that are already `tabular-nums`, and it is the price of a row that has
  no empty half in the middle of it.
- **And it is what deleted the pill's corner from this row.** The follow pill
  floats over the scroller's bottom-RIGHT, so a right-anchored figure shared that
  band and had to be moved out of it: at `Full` width with no composer between
  them the pill covered `last tool` outright (measured: the figure at x 1380-1447
  under the pill's 1375-1470), which bought a `max()` over `columnWidth`, a
  `clockColumnWidth` gated on `chatEnabled` to stop that `max()` opening a 120 px
  gutter where the composer already covered the pill, and two paragraphs
  explaining both. **A row that starts at the left margin has nothing to dodge**,
  so the prop, the switch and the arithmetic are gone from the indicator and from
  `SessionViewPage` with it.
- **`columnWidth` itself stays, for the foot.** What genuinely stands in the
  pill's corner still pays for it with the same `max()` and the same
  `PILL_CORNER_PX` (which lives in `FollowBottom.tsx`, because it is a fact about
  the pill): the composer's action row, where `Send` really is under there, its
  `BlockedBar`, and the terminal's start bar. It is optional at each of them for
  the reason it was optional here — the caller passes it only where a pill exists
  to be dodged, and the new-session page
  ([AI_RUNNING_CLAUDE.md](AI_RUNNING_CLAUDE.md#starting-one-that-does-not-exist-yet))
  has no conversation to follow and so no pill.

### The same row inside a subagent's drawer

An agent's transcript is a conversation and gets watched like one, so the drawer hangs the same footer off the same `TurnList` ([AI_AGENTS_QUESTIONS_PLANS.md](AI_AGENTS_QUESTIONS_PLANS.md#a-running-agent)). Three readings change their source and none changes its meaning:

- **`total` counts from the agent's own first line** (`turnActivity().startedAt`), and its hover says `Sent out` rather than `Turn started`. Nothing else could say when it began: there is no `<pid>.json` for an agent, and its first line IS its brief. It is also the one caller whose `since` IS that line, so the gap `turnClocks` measures is zero and `last input` never appears here — an agent is not asked anything by the user.
- **Whether it is working is the page's answer**, not the drawer's — a report that has not come back, a CLI still alive, and a recent write. **Never the parent being mid-turn**: an agent outlives the turn that launched it, and gating on `busy` took the row away from an agent that was still writing. Where the silence says nothing the row is not drawn at all; the rule, its clock and its blind spot live with the panel.
- **A turn can end with agents still out there**, and the foot of the conversation says so in the same row — as the one variant that draws a sentence at all: `⑂ N subagents still working…` through `news`, one clock, counting from when the first of them was sent out. It has to be written because it cannot be inferred: the count is the news, and `Claude is working…` there would be false — Claude is idle, and what it sent out is not. Its three other clocks are deliberately absent: what has landed inside those transcripts is in THEIR drawers, and the parent's `activity` describes the turn that just ended — which is also why passing none leaves `total` counting from the flip, exactly as it always did.
- **The pill's corner is bought with bottom padding** (`pb-14`), and it still is now that the clocks no longer sit in it: the band the pill floats in (16 px off the foot plus its own 30) is emptied for whatever the transcript ends with — a bubble's corner, the working row, a fold strip. The conversation's foot buys the same corner with the `max()` over its column width, which only locates the pill for a column centred in the window; this one is a 44 rem panel pinned to the right edge, so it pads the bottom and not the sides.

## Verify

[AI_TESTING.md](AI_TESTING.md) — checks 2, 9 (marking search hits), 16 (rewinds in the viewer), 18 (working indicator), 21 (file viewer), 22 (subagent panel), 24 (question cards and drawings), 25 (the star and the Starred page), 26 (the find bar), 27 (the foot of the conversation), 28 (delivered files and the panel's pictures).
