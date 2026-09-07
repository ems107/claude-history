import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * The one threshold that says "this is a phone", and the three things that read it.
 *
 * Three consumers, and they must never disagree: the markup, which says so with
 * Tailwind's `max-md:` variant; the stylesheet, which has a handful of rules no
 * utility can express; and the code, which has to swap whole components — three
 * columns do not become one with a class. So all three are written in the SAME
 * units as the variant Tailwind emits, `48rem`, rather than in the 768px that
 * happens to be its size today: a `rem` threshold and a `px` one drift the
 * moment anybody sets a root font size, and the symptom would be a band a few
 * pixels wide where the markup thinks it is a phone and the components do not.
 *
 * `styles.css` spells it the same way, and `max-md:` is the only mobile variant
 * used anywhere in the app. **Above the line nothing in this app changes at
 * all**: every rule added for the phone is inside a `max-` variant, a `(width <
 * 48rem)` block or a `useIsMobile()` branch, so the desktop layout is the same
 * code it always was.
 *
 * It is a WIDTH and not `pointer: coarse`, on purpose. What breaks at 360px is
 * the arithmetic of the layout — a 72px rail plus a 320px floor does not fit in
 * 360 — and that is just as true of a narrow window on a desktop. Touch is a
 * separate question answered per control: `hover:` in Tailwind v4 already
 * carries its own `@media (hover: hover)`, so anything revealed on hover is
 * invisible on a phone whatever this says, and each of those has to be given a
 * tap of its own rather than a global rule.
 */
export const MOBILE_QUERY = '(width < 48rem)';

/**
 * Short and wide — a phone held sideways, where the height is what is scarce.
 *
 * 500px because a phone on its side at the stock density is 284px tall: a
 * header, a bottom bar and a composer leave nothing for the conversation.
 * Anything that costs permanent vertical space answers this as well as
 * `MOBILE_QUERY`, and the pairing matters — turn the density down and the same
 * device in landscape is 1012px wide, which is a DESKTOP by the only rule this
 * app has, so none of these rules apply to it at all.
 */
const SHORT_QUERY = '(height < 500px)';

/**
 * One subscriber per query, for the life of the module.
 *
 * `useSyncExternalStore` compares the function it was given by IDENTITY and
 * re-subscribes whenever it changes, so building the closure inside the hook
 * meant tearing down and rebuilding a `matchMedia` listener on every render of
 * every component that asks — and some of them render on every scroll. The
 * queries are known at module load, and there are three of them: the two above
 * and `(display-mode: standalone)`, which the settings page asks to find out
 * whether this window IS the installed app. That last one is not a phone
 * question, and `useMedia` is exported for it rather than copied — the
 * subscriber bookkeeping is the part worth having once.
 */
const subscribers = new Map<string, (onChange: () => void) => () => void>();
function subscribe(query: string) {
  let existing = subscribers.get(query);
  if (!existing) {
    existing = (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    };
    subscribers.set(query, existing);
  }
  return existing;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    // No server render here, but `useSyncExternalStore` insists on the third
    // argument the moment the first paint could disagree with the store — and
    // "assume desktop" is the answer that renders today's layout unchanged.
    () => false,
  );
}

/** Is the viewport narrow enough that the desktop frame does not fit? */
export function useIsMobile(): boolean {
  return useMedia(MOBILE_QUERY);
}

/** Is it also too short to spend rows on chrome? */
export function useIsShort(): boolean {
  return useMedia(SHORT_QUERY);
}

/**
 * How much of the window the on-screen keyboard is covering, as a CSS variable.
 *
 * `web/index.html` asks for `interactive-widget=resizes-content`, and where that
 * is honoured (Chrome 108+, which is every browser this runs on) the LAYOUT
 * viewport shrinks when the keyboard opens: `100dvh` gets shorter, a `fixed`
 * bottom bar lands above the keys, and nothing here has any work to do. So this
 * exists for the case where it is NOT honoured — an older WebView, a browser
 * that only resizes the visual viewport — and it reports the difference between
 * the two viewports, which is exactly zero in the good case.
 *
 * Written to the document element rather than returned, because the things that
 * need it (the composer, the terminal, the bottom bar) are in three different
 * trees and none of them should re-render sixty times a second while a keyboard
 * animates in. `env(safe-area-inset-bottom)` is a separate quantity and stays in
 * CSS: one is the keyboard, the other is the gesture bar, and a phone can have
 * both.
 *
 * Mounted once, by `App`. Calling it twice would be harmless but pointless.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;
    const apply = () => {
      // `offsetTop` matters as well as the height: a page scrolled inside the
      // visual viewport reports a shorter height that is not the keyboard.
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Under a couple of pixels is rounding, not a keyboard.
      root.style.setProperty('--kb-inset', covered > 2 ? `${Math.round(covered)}px` : '0px');
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--kb-inset');
    };
  }, []);
}

/** Above this much scroll the header is always shown: the top of a list is not
 * somewhere anybody is trying to see more of. */
const REVEAL_ABOVE_PX = 48;
/** How far you must scroll DOWN, without changing your mind, to put it away. */
const HIDE_AFTER_PX = 40;
/** And back UP to get it again. Smaller: asking for it should feel immediate. */
const SHOW_AFTER_PX = 24;
/**
 * How long the tally ignores the scroller after folding or unfolding.
 *
 * **Folding the header makes the scroller taller, and a scroller pinned to the
 * bottom answers that by moving.** That move is a scroll event, which the rule
 * below reads as somebody scrolling, which folds or unfolds again: measured on
 * the DT50 as a header oscillating around −8px for as long as the session
 * stayed live. Longer than the 200ms transition, so what is ignored is the
 * whole of the movement the fold itself caused.
 *
 * **The movement it was written for is gone**, since the caller hands the
 * header's pixels back at the top of the scroller (see below): the content
 * grows by exactly what the box grew by, the maximum scroll does not move, and
 * a pinned scroller has nothing to answer. It stays as the guard — nothing else
 * that folding can shake is worth finding out about from a bug report.
 */
const SETTLE_MS = 350;

/**
 * The header steps aside while you read downwards, and comes back the moment
 * you scroll up.
 *
 * A phone reading a conversation has about 500px of window, and a session's
 * header is 80 of them — permanently, for a name you have already read and
 * facts you looked at once. Every app on the device does this, which is the
 * other half of the argument: it is the behaviour a thumb already expects.
 *
 * It measures ACCUMULATED movement in one direction rather than each event's
 * delta, so a momentum scroll that wobbles a pixel the other way does not flap
 * the header in and out. Above `REVEAL_ABOVE_PX` it is always shown: at the top
 * of a conversation there is nothing being scrolled away from.
 *
 * Returns the flag, the handler to put on the scroller, and a way to ask for
 * the header back — something inside it taking the focus, say. The caller owns
 * how "hidden" is drawn; here it is a negative margin, which lets the
 * conversation grow into the space instead of sliding under a floating bar.
 *
 * **And whoever draws it owes the conversation those pixels back at the top of
 * the scroller**, or the fold moves the page under the reader: the scroll
 * offset does not change, but the box it is measured from rises by the header's
 * height. `SessionViewPage` pays it with a `margin-top` on the scroller's
 * content, transitioned in step with this one, and the note there is the whole
 * of why it may not be a spacer box instead.
 */
export function useHideOnScroll(active: boolean): {
  hidden: boolean;
  onScroll: (e: { currentTarget: HTMLElement }) => void;
  reveal: () => void;
} {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const run = useRef(0);
  /** Until when the scroller is the fold's own doing rather than a reader's. */
  const settled = useRef(0);
  useEffect(() => {
    if (!active) setHidden(false);
  }, [active]);
  useEffect(() => {
    settled.current = Date.now() + SETTLE_MS;
  }, [hidden]);
  const onScroll = useCallback(
    (e: { currentTarget: HTMLElement }) => {
      const y = e.currentTarget.scrollTop;
      const dy = y - lastY.current;
      lastY.current = y;
      if (!active) return;
      // Still settling after the last change of mind: the movement being
      // reported is the one the fold made, so it decides nothing.
      if (Date.now() < settled.current) {
        run.current = 0;
        return;
      }
      if (y <= REVEAL_ABOVE_PX) {
        run.current = 0;
        setHidden(false);
        return;
      }
      // A change of direction starts the tally again, which is what makes one
      // decisive flick enough and a jittery one not enough.
      if (dy > 0 !== run.current > 0) run.current = 0;
      run.current += dy;
      if (run.current > HIDE_AFTER_PX) setHidden(true);
      else if (run.current < -SHOW_AFTER_PX) setHidden(false);
    },
    [active],
  );
  // Whatever asked for it also resets the tally: otherwise the next flick
  // downwards would arrive with a run already banked and hide it at once.
  const reveal = useCallback(() => {
    run.current = 0;
    setHidden(false);
  }, []);
  return { hidden, onScroll, reveal };
}

/**
 * Is the caret in something you type into?
 *
 * Which is the only reliable way to ask "is the on-screen keyboard up".
 * `--kb-inset` cannot answer it: where `interactive-widget=resizes-content` is
 * honoured the layout viewport shrinks instead, so the two viewports agree and
 * the inset is correctly 0 — the keyboard is there and nothing measures it.
 *
 * What it is for is the bottom bar. With the keyboard open the window is barely
 * 300px tall, and a row of navigation between the field and the keys is 56px of
 * the wrong thing: nobody reaches for another tab in the middle of typing a
 * search. `focusin`/`focusout` on the document rather than a React handler
 * because the fields are in a dozen components and the bar is in none of them.
 */
export function useIsTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const editable = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    };
    const update = () => setTyping(editable());
    // `focusout` fires before the new element has focus, so the answer is read
    // on the next frame — otherwise every move from one field to the next would
    // flash the bar back for a frame.
    const onOut = () => requestAnimationFrame(update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onOut);
    update();
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return typing;
}

/**
 * The hardware Back button closes the sheet that is open, instead of leaving
 * the page.
 *
 * **Every layer that CAN be a route is one** — `/more`, the session's own file
 * and subagent columns, which live in the URL already. Back needs nothing
 * invented for those. This is for the rest: a filter sheet, a notifications
 * sheet, a dialog — layers whose state is a `useState` and which have no
 * business in anybody's history or in a shared link.
 *
 * What it does is push a MARKER onto the entry we are already standing on: same
 * URL, same router state object with one key added, so react-router's own index
 * bookkeeping is untouched and no navigation happens. Back then pops the marker,
 * `popstate` fires and the sheet closes; nothing else in the app notices,
 * because the location never changed.
 *
 * Two ways out and both are handled. Closed with its own ✕: the marker is still
 * the entry we stand on, so the cleanup takes it off with `history.back()`.
 * Closed by NAVIGATING from inside it — tapping a notification, say: something
 * has pushed on top of the marker, `history.state` is no longer ours, and going
 * back would undo that navigation, so the cleanup leaves it alone. The buried
 * marker then behaves exactly like the entry beneath it — same URL — so the
 * worst it can cost is one Back press that appears to do nothing, on a path
 * where the alternative was undoing the tap the user had just made.
 *
 * A no-op above the phone breakpoint, where sheets are panels and Escape is
 * already the way out.
 */
/**
 * The layers currently holding a marker, innermost last.
 *
 * A stack and not a listener each, because several can be open at once — a file
 * over a subagent's transcript over the inspector — and one Back must close ONE
 * of them. With a `popstate` listener per layer, every open layer answered the
 * same event and a single press closed the lot.
 *
 * Module scope rather than a context: there is one history object, so there is
 * one stack, and a provider would only be a way of accidentally having two.
 */
const sheetStack: Array<{ key: string; dismiss: () => void }> = [];

/**
 * Are we inside the task of a user gesture right now?
 *
 * Chrome's back-button-trap defence marks a same-document history entry
 * skippable unless it was pushed **during** a gesture's own dispatch, and
 * `navigator.userActivation.isActive` is NOT that question: it stays true for
 * seconds afterwards, so a push from a promise callback passes the check and is
 * skipped anyway. That was the terminal: it fills the window when its start
 * request comes back, the marker went on the stack, `isActive` said yes, and
 * Back stepped over the entry and left the session with a terminal covering it.
 *
 * So the answer is kept here instead, from the events themselves. React flushes
 * a discrete event synchronously — handler, render and layout effects all inside
 * the dispatch — so a sheet opened by a tap sees a depth above zero, and one
 * opened by anything else sees zero and waits for the next touch to carry it.
 *
 * `click` as well as `pointerdown` because that is the one React treats as
 * discrete; the counter is decremented from a task of its own, which is the
 * first moment the dispatch is certainly over.
 */
let gestureDepth = 0;

/**
 * Counted from module load, and that is the part that has to be right: a
 * listener installed from inside the effect is installed DURING the gesture
 * that opened the layer, so it has already missed it, and the first sheet of
 * every page would sit there waiting for a second touch that never comes.
 */
if (typeof document !== 'undefined') {
  const mark = () => {
    gestureDepth++;
    setTimeout(() => {
      gestureDepth--;
    }, 0);
  };
  // **`click`, not `pointerdown`**, and that is the second thing this had to
  // learn. Chrome grants the activation on the click — for a tap, at the point
  // the finger lifts — so a marker pushed from a `pointerdown` listener is
  // pushed BEFORE the gesture counts, and is skipped exactly like one pushed
  // from a timer. Measured on the DT50: the entry was there, `history.length`
  // grew, and the system Back stepped over it every time.
  document.addEventListener('click', mark, true);
  document.addEventListener('keyup', mark, true);
  // One listener for the life of the page, rather than one attached while
  // layers are open. It has to outlive the stack, because the stack going empty
  // is exactly when this module takes a marker off with `history.back()` — and
  // that press has to be swallowed rather than acted on.
  window.addEventListener('popstate', popTopSheet);
}

/**
 * Pops this module caused itself, which must dismiss nothing.
 *
 * A layer closed by its own ✕ takes its marker off with `history.back()`, and
 * that fires `popstate` like any other. Without this the press we made
 * ourselves would close the layer UNDERNEATH — the inspector vanishing because
 * the menu on top of it was tidying up after itself.
 */
let selfPops = 0;

function popTopSheet() {
  if (selfPops > 0) {
    selfPops--;
    return;
  }
  sheetStack.pop()?.dismiss();
  // Layers are still open below, and the entry we have landed on is the marker
  // of the innermost of them. Nothing to tidy.
  if (sheetStack.length > 0) return;
  // Nothing left to close, and we are standing on a marker no layer owns — one
  // left buried when a layer opened in the same gesture another closed in,
  // which is what tapping a panel inside the session sheet does. It would be a
  // press that appears to do nothing, so it is spent now instead; the entry
  // underneath carries the same URL by construction, so nothing on screen
  // changes either way.
  const now = window.history.state as { chSheet?: string } | null;
  if (now?.chSheet) {
    selfPops++;
    window.history.back();
  }
}

export function useBackDismiss(active: boolean, onDismiss: () => void): void {
  const mobile = useIsMobile();
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  // **A LAYOUT effect, and that is not a detail.** Chrome on Android skips
  // history entries a page pushed without a user gesture — its defence against
  // back-button traps — and a passive `useEffect` runs in a later task, by
  // which time the credit for the tap has expired. The entry is still there
  // (`history.back()` from script finds it) but the system Back button steps
  // straight over it, which looked exactly like the sheet ignoring Back and
  // leaving the page. A click is a discrete event, so React flushes the render
  // and the layout effects inside the same task as the tap; the push lands with
  // the gesture still counted and the entry stops being skippable.
  useLayoutEffect(() => {
    if (!mobile || !active) return;
    const key = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const entry = { key, dismiss: () => latest.current() };
    let pushed = false;

    const push = () => {
      if (pushed) return;
      pushed = true;
      const under = window.history.state as Record<string, unknown> | null;
      window.history.pushState({ ...under, chSheet: key }, '');
      sheetStack.push(entry);
      stopWaiting();
    };

    // **Some layers do not open on a tap**, and those are the ones that made
    // this necessary: the embedded terminal fills the window when its `start`
    // request comes back, seconds after the button was pressed. A marker pushed
    // there is pushed outside any gesture's dispatch, and Chrome skips it — so
    // it waits for a gesture it can ride instead, which in practice is the
    // first tap into the terminal. That is what somebody does with a terminal.
    const onGesture = () => push();
    const stopWaiting = () => {
      document.removeEventListener('click', onGesture, true);
      document.removeEventListener('keyup', onGesture, true);
    };
    if (gestureDepth > 0) {
      push();
    } else {
      document.addEventListener('click', onGesture, true);
      document.addEventListener('keyup', onGesture, true);
    }

    return () => {
      stopWaiting();
      if (!pushed) return;
      const at = sheetStack.indexOf(entry);
      if (at !== -1) sheetStack.splice(at, 1);
      /**
       * Closed by its own control rather than by Back: the marker is still the
       * entry we stand on, so take it off. Not if something has pushed on top of
       * it — going back would undo that navigation.
       *
       * **A task later, and that is not tidiness.** A layer can open in the very
       * gesture that closes this one — tapping a panel in the session sheet
       * closes the sheet and opens the panel — and the new layer pushes its
       * marker AFTER this cleanup runs, on top of ours. Taking ours off then
       * would take theirs instead, and the panel would open and vanish. Read a
       * task later, the state says whether that happened: if it is no longer
       * our key, our marker is buried and is left alone.
       */
      setTimeout(() => {
        const now = window.history.state as { chSheet?: string } | null;
        if (now?.chSheet !== key) return;
        selfPops++;
        window.history.back();
      }, 0);
    };
  }, [mobile, active]);
}
