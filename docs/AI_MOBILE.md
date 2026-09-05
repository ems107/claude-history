# The phone

**Load this when:** you are changing anything under `web/src/` and want it to survive a 360px screen, or you are about to reach for `max-md:`, `useIsMobile()` or `useBackDismiss()`.

The app is a desktop tool that also has to be **operable** from a phone over [remote access](AI_REMOTE_ACCESS.md) — reading a conversation, answering a question, approving a plan, typing at a terminal. That is the whole of the requirement: operative before tidy. Where the two disagree, the phone gets the data and the extra line.

## Invariants

- **One threshold, three spellings, and they are the same string.** `48rem` — Tailwind v4's own `md`. The markup says it with `max-md:`, `styles.css` says it with `@media (width < 48rem)`, and `lib/mobile.ts` says it with `MOBILE_QUERY` for the components that have to swap rather than restyle. **In rem, never in the 768px it happens to be**: a rem threshold and a px one drift the moment anybody sets a root font size, and the symptom is a band a few pixels wide where the CSS thinks it is a phone and the components do not.
- **Above the line, nothing changes.** Every rule added for a phone lives inside a `max-` variant, a `(width < 48rem)` block, or a `useIsMobile()` branch. A change that alters the desktop is a bug in this work, not a trade-off in it — check it at 1440px before committing.
- **It is a WIDTH, not `pointer: coarse`.** What breaks at 360px is arithmetic — a 72px rail plus a 320px floor does not fit — and that is as true of a narrow window on a desktop. Touch is a separate question, answered per control.
- **Nothing revealed on hover may be the only way to a feature.** Tailwind v4 compiles `hover:` inside `@media (hover: hover)`, so on a phone a `group-hover:` control is not merely hard to find: it never appears. Copying a message, starring one, renaming a session, pinning it, and the cost and context breakdowns were all behind one. Each has a tap of its own now, and any new one must too.
- **`title=` is not an explanation.** Android has no tooltips. Where a control is disabled and the reason lives in a `title`, the reason has to be drawn — once, in words, beside or above what it is about. The thirteen local-only actions are the standing case.
- **Nothing may scroll the document sideways.** A conversation that scrolls sideways is a conversation you cannot read. Wide things scroll inside their own box — a code block, a table, the rail's chip strip — and the check is `document.documentElement.scrollWidth === innerWidth` on every route.
- **A phone's Back button closes what is on top.** See below; it is the one control every Android user reaches for first.
- **The keyboard shrinks the window, it does not cover it** — `interactive-widget=resizes-content` in the viewport meta. `--kb-inset` exists for browsers that do not honour that, and is correctly `0` where they do.

## The frame

`App` is a full-height flex column: a compact header, the routes, and — on a phone — `MobileTabBar` as a `shrink-0` row at the end of it. In the flow rather than `fixed`, so nothing has to reserve padding and nothing can slide under it. It hides itself while anything is being typed (`useIsTyping`), and on `/session/:id` and `/new`, which are details pushed over the list with their own way back and their own composer in that row.

Everything that did not fit in the bar is `/more` — a **page**, not a sheet. That is deliberate: a route is Back's native business, and a popover would have meant pushing a history entry and taking it off again when somebody taps a destination inside it, in that order, through an API where neither is synchronous.

## The session view, and the sheets

The desktop session page is a row: a 72px rail, the conversation, an inspector, a side column. At 360px the rail and the conversation's own floor already do not fit, and opening a panel left the conversation four pixels wide. So on a phone `useSideLayout` returns zeros, the rail is laid on its side as a chip strip under the header, and **every panel is drawn as a sheet over the conversation** — the inspector, a subagent's transcript, the file viewer. Nothing inside them changed: they were all written to read at 320px, which is what that floor was for.

## Back, and the three things it took to earn it

`useBackDismiss(active, onDismiss)` pushes a MARKER onto the entry the page is already standing on — same URL, react-router's own state with one key added — so Back pops it, closes that layer and changes nothing else. Three rules, each learned from a failure on the device:

1. **One stack, not a listener each.** Several layers can be open at once and one press must close ONE of them. With a `popstate` listener per layer, every open layer answered the same press and a single Back closed the lot.
2. **The push must happen inside the gesture's own dispatch.** Chrome marks a same-document entry skippable otherwise — its defence against back-button traps. The entry is still there (`history.back()` from script finds it) and the system Back steps straight over it, which reads exactly like the sheet ignoring Back and leaving the page. A layout effect runs inside a discrete click's task; a passive `useEffect` does not.
3. **And the gesture is the CLICK, not the `pointerdown`.** Activation is granted when the finger lifts. A marker pushed from a `pointerdown` listener is pushed before the gesture counts, and is skipped exactly like one pushed from a timer.

`navigator.userActivation.isActive` is **not** the signal for (2) — it stays true for seconds afterwards, so a push from a promise callback passes the check and is skipped anyway. `mobile.ts` counts gestures itself, from document-level `click`/`keyup` listeners installed **at module load**. Installed later — from inside the effect — they would be installed during the very gesture they need to count, and the first sheet of every page would sit there waiting for a second touch that never comes.

Layers that open asynchronously get no gesture to ride: the terminal fills the window when its start request returns, seconds after the button was pressed. There the marker waits for the next gesture, which in practice is the first tap into the terminal.

One cost, and it is accepted: a marker left behind by a reload, or buried under a navigation made from inside a sheet, is one Back press that appears to do nothing. In the second case the alternative was undoing the tap the user had just made.

> **Android presses Back once for itself.** With the on-screen keyboard up, the first Back closes the keyboard — every app behaves this way. A check that types and then expects one press to close a sheet is a check that will fail for the wrong reason.

## Touch sizes

The two shared recipes in `components/controlClass.ts` carry their own `max-md:` sizes, so fifteen files get them at once — `toggleClass` by a minimum height (it is already `inline-flex` and centres its own label), `actionClass` by padding (it goes on plain `<button>`s that would not centre a taller box). Everything else is per control. The floor aimed at is **44px for anything that decides something** — Send, Allow, Approve, Answer — and 36-40 for dense toolbar chips, which are the only place it is worth going below.

## The composer and the terminal

- **Enter is a newline on a phone and Send is the button.** A soft keyboard has no Shift+Enter, so with Enter sending there was no way to type a second line at all: every paragraph break sent the message. Which is why that button has to be a real target.
- **The terminal fills the window when it opens**, and `full` is set at the moment the panel opens rather than as an initial state: an intent to fill the window that the panel is not obeying makes the title bar's own ⤢/⤡ lie, and hands a `fixed inset-0` box a hidden xterm host, which is a blank screen.
- **The keys a CLI needs are not on the keyboard.** `TerminalKeys` carries Esc, Tab, Ctrl, the arrows, `^C` and four punctuation marks, all through `term.input()` so they take the same path up the socket as a keystroke and nothing there needs to know a socket exists. Ctrl is sticky: it arms, the next character goes through with its top three bits cleared, and it disarms itself.
- **The collapse rules are off on a phone.** "The panel closes when you look away" is read from a press outside it and from the focus leaving, and on a touch screen the keyboard opening or closing does both — the panel would fold to its 32px title bar under the user, mid-command.
- Paste has a box of its own: `navigator.clipboard` is `[SecureContext]` and does not exist over plain HTTP ([AI_REMOTE_ACCESS.md](AI_REMOTE_ACCESS.md#http-and-the-two-things-it-breaks)), and long-pressing a canvas offers nothing to paste into.

## Verifying it

The device loop is in [AI_TESTING.md](AI_TESTING.md#the-phone): how to reach the dev instance from a phone, and the checks. The one that catches most regressions is the cheapest — walk every route and assert `document.documentElement.scrollWidth === innerWidth`.
