# The phone

**Load this when:** you are changing anything under `web/src/` and want it to survive a 360px screen, or you are about to reach for `max-md:`, `useIsMobile()`, `useHideLocalOnly()` or `useBackDismiss()`.

The app is a desktop tool that also has to be **operable** from a phone over [remote access](AI_REMOTE_ACCESS.md) — reading a conversation, answering a question, approving a plan, typing at a terminal. That is the whole of the requirement: operative before tidy. Where the two disagree, the phone gets the data and the extra line.

## Invariants

- **One threshold, three spellings, and they are the same string.** `48rem` — Tailwind v4's own `md`. The markup says it with `max-md:`, `styles.css` says it with `@media (width < 48rem)`, and `lib/mobile.ts` says it with `MOBILE_QUERY` for the components that have to swap rather than restyle. **In rem, never in the 768px it happens to be**: a rem threshold and a px one drift the moment anybody sets a root font size, and the symptom is a band a few pixels wide where the CSS thinks it is a phone and the components do not.
- **Above the line, nothing changes.** Every rule added for a phone lives inside a `max-` variant, a `(width < 48rem)` block, or a `useIsMobile()` branch. A change that alters the desktop is a bug in this work, not a trade-off in it — check it at 1440px before committing.
- **It is a WIDTH, not `pointer: coarse`.** What breaks at 360px is arithmetic — a 72px rail plus a 320px floor does not fit — and that is as true of a narrow window on a desktop. Touch is a separate question, answered per control. The device this is checked on proves the point from the other side: **at the density it is set to, held sideways it is 1012px wide and correctly gets the desktop**, which is where the narrow-desktop faults were found.
- **Nothing revealed on hover may be the only way to a feature.** Tailwind v4 compiles `hover:` inside `@media (hover: hover)`, so on a phone a `group-hover:` control is not merely hard to find: it never appears. Copying a message, starring one, renaming a session, pinning it, and the cost and context breakdowns were all behind one. Each has a tap of its own now, and any new one must too.
- **`title=` is not an explanation.** Android has no tooltips. Where a control is disabled and the reason lives in a `title`, either the reason is drawn or the control is not.
- **A control that can only work on the machine is not drawn at all** (`useHideLocalOnly`, `api/useLocal.ts`). On a desktop the thirteen local-only actions are greyed with their reason beside them, which is how somebody learns which of the two browsers they are in. A phone is never that machine and never will be, so there the reason would be permanent furniture: what survives is whatever still works from here — copying the resume command instead of running it, typing a path instead of browsing for one. **The server is unaffected and still refuses all thirteen (409).** This decides what is drawn, never what is allowed.
- **Nothing may scroll the document sideways.** A conversation that scrolls sideways is a conversation you cannot read. Wide things scroll inside their own box — a code block, a table — and the check is `document.documentElement.scrollWidth === innerWidth` on every route.
- **A phone's Back button closes what is on top.** See below; it is the one control every Android user reaches for first.
- **The keyboard shrinks the window, it does not cover it** — `interactive-widget=resizes-content` in the viewport meta. `--kb-inset` exists for browsers that do not honour that, and is correctly `0` where they do.

## The frame

`App` is a full-height flex column: a compact header, the routes, and — on a phone — `MobileTabBar` as a `shrink-0` row at the end of it. In the flow rather than `fixed`, so nothing has to reserve padding and nothing can slide under it. It hides itself while anything is being typed (`useIsTyping`), on a short window (`useIsShort` — a phone on its side is 284px tall at the stock density), and on `/session/:id` and `/new`, which are details pushed over the list with their own way back and their own composer in that row.

**The bar is Sessions · Stats · New · More · Settings**, and `More` is a MENU rather than a page. It was a page once (`/more`), on the argument that a route is Back's native business; four links is not worth a screen you then have to leave, and `useBackDismiss` handles the menu as it handles every other layer. It holds the three places that did not earn a tab: Prompts, Plans, Starred messages.

**The header keeps three readings and nothing else**: who this is on the left — the mark, the name, the version or the `dev` chip — and on the right what Claude has spent, what is waiting, and whether there is a new version. The nav, the gear and the version-check button are all in the bar or behind it.

- The usage widget draws the same two windows **upright, filling from the bottom like a battery** (`VBar`), because a horizontal bar wide enough to read is 32px of a row that has 176 for everything right of the mark. Tapping it opens the same popover a desktop gets.
- The update button appears **only when there is a version**. A phone is always remote, so a button whose job is to answer "is there anything?" is right on the days there is nothing — and Settings › Updates opens the same window on both sizes, which is where that question is asked from now.

## The list, on one line

The desktop toolbar is seven controls in a row and needs about 600px. The phone's is `MobileListBar`: the search box and three 40px squares — sliders for the advanced search options, a funnel for the filters, stacked lines with an arrow for grouping and order. A branch rather than one markup restyled, because the phone's bar is not the desktop's narrower: it puts the count in the search placeholder (the box is empty exactly when there is room to read it), and grouping and order become a sheet of labelled choices rather than two unlabelled `<select>`s.

Each square carries its tally as a **circle centred on its own content**, not a digit appended to a glyph — the latter sits on the glyph's baseline and reads as dropped.

The rows are **measured at every width** (`virtualizer.measureElement`), and the two `ROW_HEIGHT` constants are estimates for the scrollbar rather than heights. A row's height is decided by how much of it wraps, which is decided by the width: at 360px the tallest is half again the shortest, and at ~1000px the desktop row wraps a line and used to be drawn on top of its neighbour. Above ~1200 nothing wraps and the measurement comes back as exactly the estimate. The row carries its own 64px as a **floor** (`min-h-16`), because the box around it no longer has a height for `h-full` to resolve against.

## Settings is a list before it is a page

`/settings` on a phone draws the six areas as rows with their blurbs and their changed-counts (`SettingsNav index`), and the area gets the whole window once one is picked, with `‹ All settings` as the way back. The 224px rail has nowhere to be beside a 360px panel, and as a strip across the top it was six chips scrolling sideways over a panel scrolling the other way, two of them always off the right edge. A path that names an area is unaffected, and so is a hash that implies one: `/settings#backups` is a bookmark and a README link, and landing it on a menu would be landing it nowhere.

## The session view

The desktop session page is a row: a 72px rail, the conversation, an inspector, a side column. At 360px the rail and the conversation's own floor already do not fit, and opening a panel left the conversation four pixels wide. So on a phone `useSideLayout` returns zeros, **the rail is not drawn**, and **every panel is a sheet over the conversation** — the inspector, a subagent's transcript, the file viewer. Nothing inside them changed: they were all written to read at 320px, which is what that floor was for.

**The header is a name and one button.** Row one is the title and a square ⋮; row two is what the session IS — the project tag, the rename mark, the live badges — ending in `more`, which grows the header UNDERNEATH that row instead of swapping it, so nothing you were looking at moves. The ← went from both sizes: Escape has always been the way out on a desktop, Back is the way out on a phone, and the mark in the app's own header goes to the list from either.

**Everything else is behind the ⋮**, as one sheet with sections: the seven panels, find, the view menu's own controls drawn flat, then the session's own actions. `SessionMenu` grows the sheet on a phone and stays a popover above 48rem; the page passes what it owns in through `menuSections`, and `ViewMenuBody` exists so the view controls can be drawn without a popover inside a sheet — a second layer for Back to disagree about.

**The header steps aside while you read downwards** (`useHideOnScroll`) and comes back the moment you scroll up. A negative margin rather than a transform or a `fixed` bar, so the conversation gets the pixels instead of sliding under something; the pane above already clips. Two rules earned the hard way: the height is measured through a **callback ref**, because this page renders a loading state first and a ref object filled in silently leaves an observer that never observed anything; and the tally **ignores the scroller for 350ms after changing its mind**, because folding makes the scroller taller, a scroller pinned to the bottom answers that by moving, and that movement is a scroll event.

## Back, and the four things it took to earn it

`useBackDismiss(active, onDismiss)` pushes a MARKER onto the entry the page is already standing on — same URL, react-router's own state with one key added — so Back pops it, closes that layer and changes nothing else. Four rules, each learned from a failure on the device:

1. **One stack, not a listener each.** Several layers can be open at once and one press must close ONE of them. With a `popstate` listener per layer, every open layer answered the same press and a single Back closed the lot.
2. **The push must happen inside the gesture's own dispatch.** Chrome marks a same-document entry skippable otherwise — its defence against back-button traps. The entry is still there (`history.back()` from script finds it) and the system Back steps straight over it, which reads exactly like the sheet ignoring Back and leaving the page. A layout effect runs inside a discrete click's task; a passive `useEffect` does not.
3. **And the gesture is the CLICK, not the `pointerdown`.** Activation is granted when the finger lifts. A marker pushed from a `pointerdown` listener is pushed before the gesture counts, and is skipped exactly like one pushed from a timer.
4. **A layer closing and a layer opening can be the same tap**, and that is what taking a marker off has to survive. Tapping a panel in the session sheet closes the sheet and opens the panel: the sheet's cleanup runs first and the panel's marker is pushed after it, on top. So the self-close `history.back()` is **deferred by a task and re-checks that the current entry is still its own** — if it is not, our marker is buried and is left alone. The `popstate` listener lives for the life of the page rather than the life of the stack, so a pop this module caused itself can be **counted and swallowed** (`selfPops`) instead of closing the layer underneath. And a marker no layer owns any more is spent on the spot, because it would otherwise be one press that appears to do nothing.

`navigator.userActivation.isActive` is **not** the signal for (2) — it stays true for seconds afterwards, so a push from a promise callback passes the check and is skipped anyway. `mobile.ts` counts gestures itself, from document-level `click`/`keyup` listeners installed **at module load**. Installed later — from inside the effect — they would be installed during the very gesture they need to count, and the first sheet of every page would sit there waiting for a second touch that never comes.

Layers that open asynchronously get no gesture to ride: the terminal fills the window when its start request returns, seconds after the button was pressed. There the marker waits for the next gesture, which in practice is the first tap into the terminal.

> **Android presses Back once for itself.** With the on-screen keyboard up, the first Back closes the keyboard — every app behaves this way. A check that types and then expects one press to close a sheet is a check that will fail for the wrong reason.

## Touch sizes

The two shared recipes in `components/controlClass.ts` carry their own `max-md:` sizes, so fifteen files get them at once — `toggleClass` by a minimum height (it is already `inline-flex` and centres its own label), `actionClass` by padding (it goes on plain `<button>`s that would not centre a taller box). Everything else is per control. The floor aimed at is **44px for anything that decides something** — Send, Allow, Approve, Answer — and 36-40 for dense toolbar chips, which are the only place it is worth going below.

## The composer and the terminal

- **Enter is a newline on a phone and Send is the button.** A soft keyboard has no Shift+Enter, so with Enter sending there was no way to type a second line at all: every paragraph break sent the message. Which is why that button has to be a real target.
- **The terminal fills the window when it opens**, and `full` is set at the moment the panel opens rather than as an initial state: an intent to fill the window that the panel is not obeying makes the title bar's own ⤢/⤡ lie, and hands a `fixed inset-0` box a hidden xterm host, which is a blank screen. **There are two states and not three**: the way out of full screen is `▾ minimise`, back to the title bar with the CLI still running, and the `×` on that bar is what closes it.
- **The title bar never wraps.** With `flex-wrap` on, a long cwd does not fit after the `❯` at its full content width, so it is placed on the next line and shrunk THERE — leaving a first row holding one glyph. It truncates on one line instead, which is what the ellipsis was for.
- **The keys a CLI needs are not on the keyboard.** `TerminalKeys` carries Esc, Tab, Ctrl, the arrows, `^C` and four punctuation marks, all through `term.input()` so they take the same path up the socket as a keystroke and nothing there needs to know a socket exists. Ctrl is sticky: it arms, the next character goes through with its top three bits cleared, and it disarms itself. A key fires **on the way up and only if the finger has not travelled** (`TAP_SLOP_PX`), because the row is wider than the screen and the commonest gesture over it is a drag across; and a glyph key is a fixed square, so ↑ and ← are the same size however differently the font draws them.
- **A drag over the terminal scrolls it, by becoming wheel events.** `term.scrollLines()` is the obvious call and does nothing here: Claude Code runs in the ALTERNATE screen buffer, which has no scrollback, and turns full mouse reporting on — so on a desktop the wheel is not scrolling anything either, it is being SENT to the CLI, which scrolls its own transcript. xterm's scrollable viewport sits UNDER the screen a touch lands on and only a wheel is forwarded across that gap, so the drag is turned into one synthetic wheel per row (`deltaMode: DOM_DELTA_LINE` — pixel mode damps anything under 50px to 30%, and a mouse report is one notch per event however large the delta). Whatever xterm decides to do with it is then decided in one place for both kinds of pointer.
- **The collapse rules are off on a phone.** "The panel closes when you look away" is read from a press outside it and from the focus leaving, and on a touch screen the keyboard opening or closing does both — the panel would fold to its 32px title bar under the user, mid-command.
- Paste has a box of its own: `navigator.clipboard` is `[SecureContext]` and does not exist over plain HTTP ([AI_REMOTE_ACCESS.md](AI_REMOTE_ACCESS.md#http-and-the-two-things-it-breaks)), and long-pressing a canvas offers nothing to paste into.

## Verifying it

The device loop is in [AI_TESTING.md](AI_TESTING.md#the-phone): how to reach the dev instance from a phone, and the checks. The one that catches most regressions is the cheapest — walk every route and assert `document.documentElement.scrollWidth === innerWidth`.
