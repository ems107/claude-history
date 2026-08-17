import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Distance from the bottom, in pixels, still counted as being AT the bottom.
 * Not zero: sub-pixel layout and a trackpad's last few pixels would otherwise
 * make "scrolled to the end" almost unreachable.
 */
const BOTTOM_SLACK = 24;

export interface FollowBottom {
  /** Pinned to the bottom: new content keeps the view at the end. */
  following: boolean;
  toggle: () => void;
}

/**
 * Keep a scroll container pinned to its end, the way a terminal or a chat does.
 *
 * Engaging and letting go are the same rule read in both directions: the reader
 * scrolling down to the bottom follows, the reader moving away lets go. That is
 * what makes "scroll down to the end" arm it and "scroll up" release it without
 * either being a special case.
 *
 * The reader is the whole of that rule — and a `scroll` event does not say who
 * fired it. Three things move this scroll with nobody touching it: the browser
 * clamps a `scrollTop` past the end when content shrinks, scroll anchoring
 * scrolls under content that grows above the viewport, and our own pinning
 * scrolls on purpose. All three land AT the bottom when the reader was already
 * there, and taking them for a gesture is what switched the follow back on one
 * message after it was switched off. So an event counts as the reader's only
 * while `scrollHeight` is the one the previous event left behind, and the
 * ResizeObserver re-reads that geometry after every content change — which is
 * what makes a scroll the content caused impossible to mistake for a scroll the
 * reader made.
 */
export function useFollowBottom(
  /** Changing this releases the follow — a different session starts fresh. */
  resetKey?: string,
  /**
   * Arm it as the session opens: a live or busy conversation is one being
   * written, and it is opened to watch that arrive. Once per session, and never
   * over the top of a reader who has already scrolled — this arrives a moment
   * after the page does (the live query is a round trip), and yanking the view
   * to the end then would be the app fighting whoever is reading.
   */
  autoFollow = false,
): FollowBottom & {
  /** Callback refs, NOT ref objects: the elements appear a render after this
   * hook first runs (the page renders a loading state first), and a ref object
   * being filled in silently would leave the effects below never armed. */
  scrollRef: (el: HTMLDivElement | null) => void;
  contentRef: (el: HTMLDivElement | null) => void;
} {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(false);
  // Read inside the observer, which must not be rebuilt on every toggle.
  const followingRef = useRef(false);
  followingRef.current = following;
  /** The geometry every scroll event is judged against — see the note above. */
  const lastTop = useRef(0);
  const lastHeight = useRef(0);
  /** The reader has taken the scroll over, so `autoFollow` no longer may. */
  const touched = useRef(false);
  /** Armed once per session, whatever the live query does afterwards. */
  const armed = useRef(false);

  useEffect(() => {
    setFollowing(false);
    touched.current = false;
    armed.current = false;
  }, [resetKey]);

  useEffect(() => {
    if (!scrollEl) return;
    lastTop.current = scrollEl.scrollTop;
    lastHeight.current = scrollEl.scrollHeight;
    const onScroll = () => {
      const top = scrollEl.scrollTop;
      const height = scrollEl.scrollHeight;
      const byTheReader = height === lastHeight.current;
      const distance = height - top - scrollEl.clientHeight;
      const down = top > lastTop.current;
      lastTop.current = top;
      lastHeight.current = height;
      // The content moved the view, not the reader: nothing to read into it.
      if (!byTheReader) return;
      touched.current = true;
      if (distance > BOTTOM_SLACK) setFollowing(false);
      else if (down) setFollowing(true);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, [scrollEl]);

  useEffect(() => {
    if (!scrollEl || !contentEl) return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) scrollEl.scrollTop = scrollEl.scrollHeight;
      // AFTER the pin, and on every content change whether we pinned or not:
      // this is the geometry the next scroll event is compared against, and
      // what the content did to it is not the reader scrolling.
      lastTop.current = scrollEl.scrollTop;
      lastHeight.current = scrollEl.scrollHeight;
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [scrollEl, contentEl]);

  useEffect(() => {
    if (!autoFollow || !scrollEl || armed.current || touched.current) return;
    armed.current = true;
    setFollowing(true);
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [autoFollow, scrollEl]);

  const toggle = useCallback(() => {
    // Either way the reader has just said what they want, which is also an
    // answer to `autoFollow`: it must not arm over a follow just let go of.
    touched.current = true;
    if (followingRef.current) {
      setFollowing(false);
      return;
    }
    setFollowing(true);
    // Instant, not smooth: a smooth scroll fires events all the way down, and
    // the ones far from the bottom would read as "the reader scrolled up".
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [scrollEl]);

  return { following, toggle, scrollRef: setScrollEl, contentRef: setContentEl };
}

/**
 * Floating pill over the bottom-right of the conversation, at the foot of the
 * window — over the composer rather than above it, because the composer is
 * inside the scroller now (see `SessionViewPage`) and there is no lower place
 * to stand. Always offered, whether or not there is anything to scroll: with
 * nothing to scroll it is the switch that says the next message will be
 * followed, which is exactly the state a live session is opened in.
 */
export function FollowBottomButton({ following, toggle }: { following: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      onClick={toggle}
      title={
        following
          ? 'Following the end of the conversation — click, or scroll up, to stop'
          : 'Jump to the end and follow new messages'
      }
      className={`absolute right-4 bottom-4 flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs shadow-lg backdrop-blur-sm transition-colors ${
        following
          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
          : 'border-[var(--border)] bg-[var(--bg-raised)]/90 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      <span aria-hidden="true">↓</span>
      {following ? 'Following' : 'To the end'}
    </button>
  );
}
