import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

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
 * 500px because the DT50 in landscape is 360px tall: a header, a bottom bar and
 * a composer leave nothing for the conversation. Anything that costs permanent
 * vertical space answers this as well as `MOBILE_QUERY`.
 */
export const SHORT_QUERY = '(height < 500px)';

function subscribe(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  };
}

function useMedia(query: string): boolean {
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
export function useBackDismiss(active: boolean, onDismiss: () => void): void {
  const mobile = useIsMobile();
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    if (!mobile || !active) return;
    const key = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const under = window.history.state as Record<string, unknown> | null;
    window.history.pushState({ ...under, chSheet: key }, '');
    let consumed = false;
    const onPop = () => {
      consumed = true;
      latest.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const now = window.history.state as { chSheet?: string } | null;
      if (!consumed && now?.chSheet === key) window.history.back();
    };
  }, [mobile, active]);
}
