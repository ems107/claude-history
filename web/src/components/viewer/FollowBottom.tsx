import { useCallback, useEffect, useRef, useState } from 'react';
import { CountBadge } from '../CountBadge.tsx';

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
  /**
   * Messages that have landed since the reader let go of the end. Always 0 while
   * following — what arrives is on screen as it arrives — so it is only ever a
   * number while the pill reads "To the end".
   */
  unseen: number;
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
  {
    autoFollow = false,
    messageCount = 0,
  }: {
    /**
     * Arm it as the session opens: a live or busy conversation is one being
     * written, and it is opened to watch that arrive. Once per session, and never
     * over the top of a reader who has already scrolled — this arrives a moment
     * after the page does (the live query is a round trip), and yanking the view
     * to the end then would be the app fighting whoever is reading.
     */
    autoFollow?: boolean;
    /**
     * How many messages the conversation holds right now. The count of what the
     * reader has not seen is the same question as the follow — what has arrived
     * at the end while they were not looking at it — so it is answered here,
     * where "not following" and "another session" already live.
     */
    messageCount?: number;
  } = {},
): FollowBottom & {
  /** Callback refs, NOT ref objects: the elements appear a render after this
   * hook first runs (the page renders a loading state first), and a ref object
   * being filled in silently would leave the effects below never armed. */
  scrollRef: (el: HTMLDivElement | null) => void;
  contentRef: (el: HTMLDivElement | null) => void;
  /**
   * The box stuck to the foot of the scroller — the composer, or the embedded
   * terminal. It is content like any other, so growing it makes the conversation
   * shorter on screen: at the end, the last message would go behind it, which is
   * not the same thing as being at the end of it. Only at the end, though —
   * elsewhere the box is left to float over the conversation rather than shift
   * it, which is the note in the observer below.
   */
  footerRef: (el: HTMLDivElement | null) => void;
} {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
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
  const [unseen, setUnseen] = useState(0);
  /** What the count was when it was last read, to tell growth from a redraw. */
  const lastCount = useRef(messageCount);

  useEffect(() => {
    setFollowing(false);
    setUnseen(0);
    touched.current = false;
    armed.current = false;
  }, [resetKey]);

  useEffect(() => {
    const before = lastCount.current;
    lastCount.current = messageCount;
    // Following means watching them land, so there is never anything unseen.
    if (following) {
      setUnseen(0);
      return;
    }
    // Only growth counts, and a conversation ARRIVING is not growth: `before` is
    // 0 while the query is in flight — for this session and for the one before
    // it — so counting that would open every session claiming its whole history
    // as news.
    if (before === 0 || messageCount <= before) return;
    setUnseen((n) => n + (messageCount - before));
  }, [messageCount, following]);

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
    /** Null until the first callback, which is the one that only measures. */
    let footerHeight: number | null = null;
    const observer = new ResizeObserver(() => {
      const height = footerEl?.offsetHeight ?? 0;
      const grew = footerHeight === null ? 0 : height - footerHeight;
      footerHeight = height;
      /**
       * The stuck box grew — a line typed, a terminal opened. The growth is also
       * new scrollable height, so scrolling by the difference hands the view back
       * exactly what was just covered.
       *
       * **Only while the view was already AT the end**, and that is the rule this
       * whole thing turns on: down there the box grows into the conversation's
       * last line and moving with it is what keeps the end the end. Anywhere else
       * the reader is looking at something in the middle, nothing about their page
       * has changed, and scrolling it would be the app moving the text under
       * somebody's eyes to protect a strip they are not reading. Opening the
       * embedded terminal is what made the difference impossible to miss: the
       * composer grows by a line and the compensation reads as a nudge, a terminal
       * arrives 380 px tall and the same code reads as the page jumping. So the
       * box floats over the conversation instead, and the conversation stays where
       * it was put.
       *
       * Where the end was BEFORE this: the growth is all at the bottom, so the
       * distance measured now, less what has just appeared, is the one the reader
       * had.
       *
       * **Shrinking needs nothing at all.** At the end, the browser's own clamp
       * has already pulled `scrollTop` down to the new maximum, which leaves the
       * last line exactly where it was with more history above it; in the middle
       * there is nothing to clamp and nothing that should move. It is the same
       * answer as growing, arrived at for free.
       */
      if (grew > 0) {
        const distance = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight - grew;
        if (distance <= BOTTOM_SLACK) scrollEl.scrollTop += grew;
      }
      if (followingRef.current) scrollEl.scrollTop = scrollEl.scrollHeight;
      // AFTER both, and on every content change whether we moved or not: this is
      // the geometry the next scroll event is compared against, and neither the
      // content nor this is the reader scrolling.
      lastTop.current = scrollEl.scrollTop;
      lastHeight.current = scrollEl.scrollHeight;
    });
    observer.observe(contentEl);
    if (footerEl) observer.observe(footerEl);
    // The scroller itself too: the end can leave the view without the content
    // changing at all — the window being resized, or anything above the
    // conversation gaining a row — and following means being at the end however
    // the end got away.
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [scrollEl, contentEl, footerEl]);

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

  return {
    following,
    toggle,
    unseen,
    scrollRef: setScrollEl,
    contentRef: setContentEl,
    footerRef: setFooterEl,
  };
}

/**
 * How much of the scroller's bottom-right corner this pill needs: its own width
 * plus the 16 px it floats off the edge (`right-4 bottom-4` below).
 *
 * It lives here because it is a fact about the pill, and two places have to give
 * that corner up wherever the conversation's column reaches the window's edge:
 * the composer's action row, so `Send` is not covered, and the working
 * indicator's clocks, so `last tool` is not. Both do it with the same `max()`
 * over the column width — no measuring, no re-render on resize.
 */
export const PILL_CORNER_PX = 120;

/**
 * Floating pill over the bottom-right of the conversation, at the foot of the
 * window — over the composer rather than above it, because the composer is
 * inside the scroller now (see `SessionViewPage`) and there is no lower place
 * to stand. Always offered, whether or not there is anything to scroll: with
 * nothing to scroll it is the switch that says the next message will be
 * followed, which is exactly the state a live session is opened in.
 *
 * While it is NOT following, what arrives is counted on a badge — the app's own
 * shape for "there is something here you have not seen", the same one
 * `UpdateButton` wears for a new version, down to the ring in the page's
 * background colour that keeps a two-digit number legible over a bubble. The
 * pill itself does not change colour with it: the badge is the news, and turning
 * the whole control amber would read as a warning about the button.
 */
export function FollowBottomButton({
  following,
  toggle,
  unseen,
  working = false,
  workingWhat = 'Claude is working',
  liftPx = 0,
}: {
  following: boolean;
  toggle: () => void;
  /** Messages landed since the reader let go of the end; 0 draws no badge. */
  unseen: number;
  /**
   * What that is, when it is not Claude: a turn can END with the agents it sent
   * out still running, and the answer to "is anything more coming" is yes — the
   * report they file will land in this conversation. The spinner says the same
   * thing either way; only the sentence changes.
   */
  workingWhat?: string;
  /**
   * A turn is in flight. The working row says so far better, with its clocks, but
   * it says it at the END of the conversation — scroll up, or fold the turn away,
   * and the one question left is whether anything more is coming. This pill is on
   * screen whatever the scroll is doing, so it answers that: spinning means the
   * answer is still arriving, still means it has landed.
   */
  working?: boolean;
  /**
   * Sit this far above the foot of the scroller instead of the usual 16 px.
   *
   * For the embedded terminal, which fills the corner this floats in. The
   * composer answers the same problem by keeping `Send` out of the corner, and
   * that works because a composer has spare corner to give; a terminal is
   * content in every cell, and reserving the pill's width there just makes the
   * panel narrower than the conversation above it for no visible reason. So the
   * pill moves and the panel does not.
   */
  liftPx?: number;
}) {
  const badge = following ? 0 : unseen;
  return (
    <button
      type="button"
      onClick={toggle}
      title={
        // The turn comes first: it is news about the session, while the rest is
        // about this control.
        (working ? `${workingWhat} — ` : '') +
        (following
          ? 'following the end of the conversation; click, or scroll up, to stop'
          : badge > 0
            ? `${badge} new message${badge === 1 ? '' : 's'} below — click to jump to the end and follow`
            : 'jump to the end and follow new messages')
      }
      style={liftPx > 0 ? { bottom: liftPx + 16 } : undefined}
      className={`absolute right-4 bottom-4 flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs shadow-lg backdrop-blur-sm transition-colors ${
        following
          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
          : 'border-[var(--border)] bg-[var(--bg-raised)]/90 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      {/* Both live in the same 12 px box, so the pill does not change width when
          a turn starts or ends — and the spinner takes the arrow's place rather
          than sitting beside it, because that is where the eye already is.
          `animate-spin` is the whole animation: `turn-spinner` carries no CSS
          any more and is kept as the handle the checks grab, since the same ring
          also spins on the update button and twice in Remote access. */}
      <span aria-hidden="true" className="flex size-3 items-center justify-center">
        {working ? (
          <span className="turn-spinner size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          '↓'
        )}
      </span>
      {following ? 'Following' : 'To the end'}
      <CountBadge count={badge} />
    </button>
  );
}
