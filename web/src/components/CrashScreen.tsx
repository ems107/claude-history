import { Component, Fragment, type ReactNode } from 'react';

/**
 * The last thing between a thrown render and a blank page.
 *
 * React 19 unmounts the WHOLE tree when nothing catches — `#root` is emptied,
 * the DOM is gone, and no amount of resizing, clicking or navigating brings it
 * back, because there is nothing left to receive any of it. Only F5 does. That
 * is what a hook-order bug in one menu did to the entire app the first time
 * somebody dragged the window past 48rem; the bug was one line, and what turned
 * it into a blank screen was the absence of this.
 *
 * So it says what happened and offers the two ways out, in the order they are
 * worth trying. **Try again** rebuilds the subtree, and it is the right button
 * for everything that threw on a TRANSITION — a breakpoint being crossed, a
 * panel opening, a query landing — because the state that threw is no longer
 * the state the app is in. **Reload** is for the rest.
 *
 * It retries on a resize by itself, for exactly that reason: a layout that
 * throws on the way past the breakpoint would otherwise leave this standing on
 * the far side of it, where the render that failed is one nothing will ask for
 * again. Being wrong about that costs one render, which throws again and puts
 * this straight back.
 *
 * Nothing is logged from here and that is deliberate: React reports a caught
 * error to the console itself, with the component stack a thrown `Error` does
 * not carry — and `console.*` is not ours to write (`docs/AI_LOGGING.md`). The
 * message is drawn instead, because whoever is looking at this is not
 * necessarily at a devtools window; on a phone it is the only copy of it they
 * will ever see.
 *
 * A class, because `componentDidCatch` has no hook and never will.
 */
export class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  /** Bumped on every retry, so the subtree is rebuilt rather than re-rendered. */
  private attempt = 0;
  /** The pending automatic retry, if a resize is still settling. */
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidMount() {
    window.addEventListener('resize', this.onResize);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.onResize);
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * **Debounced, and the debounce is the point.** A window being dragged fires
   * `resize` at the frame rate; retrying on each of them would re-run the
   * render that threw sixty times a second for as long as the hand is moving.
   * Waiting for the drag to stop costs a quarter of a second and asks the
   * question once, about the size the window actually ended up at — which is
   * the only size the answer was ever about.
   */
  private onResize = () => {
    if (!this.state.error) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.state.error) this.retry();
    }, 250);
  };

  private retry = () => {
    this.attempt++;
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    // A keyed Fragment and not a wrapper: `#root`'s child is the app's own
    // `h-full` column, and a `div` between them is a box with no height for it
    // to fill.
    if (!error) return <Fragment key={this.attempt}>{this.props.children}</Fragment>;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm space-y-3">
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="text-[var(--logo)]">claude</span> history
          </h1>
          <p className="text-sm">Something went wrong while drawing this page.</p>
          <p className="font-mono text-xs leading-relaxed break-words text-[var(--text-dim)]">
            {error.message || String(error)}
          </p>
          <p className="text-xs leading-relaxed text-[var(--text-dim)]">
            Nothing was written anywhere — this app only reads.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={this.retry}
              className="rounded border border-[var(--accent)] px-3 py-1 text-sm text-[var(--accent)] hover:bg-[var(--bg-hover)]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
