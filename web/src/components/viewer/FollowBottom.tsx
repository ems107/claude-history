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
  /** There is something to scroll — nothing to offer when everything fits. */
  scrollable: boolean;
}

/**
 * Keep a scroll container pinned to its end, the way a terminal or a chat does.
 *
 * Engaging and letting go are the same rule read in both directions: a scroll
 * event that lands at the bottom follows, one that moves away lets go. That is
 * what makes "scroll down to the end" arm it and "scroll up" release it without
 * either being a special case.
 *
 * It cannot be tripped by our own pinning: growing content does not fire a
 * scroll event (scrollHeight changes, scrollTop does not), and the scroll our
 * pinning does fire lands at distance zero, which reads as "still following".
 * Re-pinning is driven by a ResizeObserver rather than by new data, so an
 * expanding tool block or a late-loading image keeps the view at the end too.
 */
export function useFollowBottom(
  /** Changing this releases the follow — a different session starts fresh. */
  resetKey?: string,
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
  const [scrollable, setScrollable] = useState(false);
  // Read inside the observer, which must not be rebuilt on every toggle.
  const followingRef = useRef(false);
  followingRef.current = following;

  useEffect(() => {
    setFollowing(false);
  }, [resetKey]);

  useEffect(() => {
    if (!scrollEl) return;
    const onScroll = () => {
      const distance = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      setFollowing(distance <= BOTTOM_SLACK);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, [scrollEl]);

  useEffect(() => {
    if (!scrollEl || !contentEl) return;
    const observer = new ResizeObserver(() => {
      setScrollable(scrollEl.scrollHeight > scrollEl.clientHeight + BOTTOM_SLACK);
      if (followingRef.current) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [scrollEl, contentEl]);

  const toggle = useCallback(() => {
    if (followingRef.current) {
      setFollowing(false);
      return;
    }
    setFollowing(true);
    // Instant, not smooth: a smooth scroll fires events all the way down, and
    // the ones far from the bottom would read as "the user scrolled up".
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [scrollEl]);

  return { following, toggle, scrollable, scrollRef: setScrollEl, contentRef: setContentEl };
}

/** Floating pill over the bottom-right of the scroll area. */
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
