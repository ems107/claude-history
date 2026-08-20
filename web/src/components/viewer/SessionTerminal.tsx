import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionDetailResponse } from '@claude-history/shared';
import { api } from '../../api/client.ts';
import { cacheClockOf, CloseSessionDialog } from './CloseSessionDialog.tsx';
import { clamp, HEIGHT_KEY, readHeight } from '../../lib/terminalPrefs.ts';
import { PILL_CORNER_PX } from './FollowBottom.tsx';

/**
 * The colours xterm is given, read from the page's own custom properties rather
 * than written twice. The ANSI sixteen are xterm's defaults with the app's
 * accent in the two places a CLI actually shows one — anything more would be a
 * second theme to keep in step with the first.
 */
function themeFrom(el: HTMLElement): Record<string, string> {
  const style = getComputedStyle(el);
  const v = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--bg', '#0f1115'),
    foreground: v('--text', '#d7dde6'),
    cursor: v('--accent', '#d97757'),
    cursorAccent: v('--bg', '#0f1115'),
    selectionBackground: v('--accent-dim', '#a05a44'),
  };
}

/**
 * The Claude Code CLI, running in the page.
 *
 * It sits exactly where the composer would, and inherits everything that slot
 * imposes — the sticky wrapper, `footerRef`, `data-sticky-bottom` and the click
 * that must not deselect — from `SessionViewPage`, which owns them for both.
 *
 * The pseudo-terminal itself belongs to the SERVER. This component is a view of
 * it: mounting attaches and replays what was missed, unmounting detaches and
 * nothing more. Closing the tab loses the picture, never the process.
 */
export function SessionTerminal({
  sessionId,
  columnWidth,
  /** Called once a terminal has really started, so `/new` can begin waiting for a transcript. */
  onStarted,
  /**
   * Full screen is the PAGE's business, not just this component's.
   *
   * The slot this sits in is `position: sticky`, and sticky creates a stacking
   * context — so a `fixed inset-0 z-50` panel rendered inside it is numbered
   * only against its siblings, and the follow pill, a later sibling of the
   * scroller with no z-index at all, paints straight over it. Measured:
   * `elementFromPoint` in the middle of a full-screen terminal answered with
   * the pill. The page lifts the whole slot instead.
   *
   * The height goes with it for a second reason: the follow pill floats in the
   * corner this panel now fills, and the page moves it up rather than the panel
   * giving ground. Measured off the root, not added up from the parts, because
   * an arithmetic answer would be wrong the day a padding changes.
   */
  onLayout,
}: {
  sessionId: string;
  /** A CSS length, not a number — `min(896px, 100vw)` and the like. */
  columnWidth?: string;
  onStarted?: () => void;
  onLayout?: (layout: { full: boolean; open: boolean; height: number; rightGap: number }) => void;
}) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['terminal', sessionId], queryFn: () => api.terminalStatus(sessionId) });
  const [height, setHeight] = useState(readHeight);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Closing is asked about while a CLI is alive, for the reason in
   * [CloseSessionDialog]: the next prompt would come from one that has just
   * started, and that is what risks the cached prefix. A terminal holding a dead
   * process's screen has nothing to lose and closes on the first click.
   */
  const [confirmClose, setConfirmClose] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  /**
   * Whether the program inside has asked for the kitty keyboard protocol.
   *
   * Read off the output stream rather than assumed, so a key is only ever
   * encoded the enhanced way while something is listening for it. Claude Code
   * pushes it at startup (verified in the raw stream), which is what makes
   * Shift+Enter a distinguishable key at all.
   */
  const kittyRef = useRef(false);

  const open = status.data?.open ?? false;
  const running = status.data?.running ?? false;
  const blocked = status.data?.blockedReason ?? null;
  const exit = status.data?.exit ?? null;
  const cwd = status.data?.cwd ?? null;

  /**
   * Build the xterm once and keep it for the life of the component, across
   * reconnects and across the CLI exiting. Tearing it down on every status
   * change would throw away the very screen this feature keeps on purpose.
   */
  useLayoutEffect(() => {
    if (!open || termRef.current || !hostRef.current) return;
    const term = new Terminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      // The font a Windows terminal actually uses, ahead of the generic stack.
      // It is not taste: the CLI draws its logo and its panels out of block and
      // box-drawing characters, and those only line up in a font whose cell the
      // glyphs were cut for. `customGlyphs` (on by default) draws the box rules
      // geometrically whatever the font does, which is the other half of it.
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, 'Courier New', monospace",
      fontSize: 12,
      // Exactly 1, and this is the logo. The CLI draws it out of half-block
      // characters that are meant to tile edge to edge; any leading at all puts
      // a stripe of background through every row of it. 1.2 reads better for
      // prose and this is not prose.
      lineHeight: 1,
      scrollback: 5_000,
      theme: themeFrom(hostRef.current),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Emoji and CJK are two cells wide in every terminal written this decade,
    // and one cell wide under the Unicode 6 tables xterm.js defaults to. Get
    // that wrong by one and everything drawn after it on the line is shifted —
    // which is what a panel border landing in a different column each row is.
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';
    term.open(hostRef.current);
    // AFTER `open`, which is a requirement of the addon and not a preference.
    //
    // The default DOM renderer draws every cell as a span, so box-drawing and
    // block characters are whatever the font makes of them — and
    // `customGlyphs`, which draws those geometrically so they tile perfectly at
    // any size, is a canvas/WebGL feature that the DOM renderer simply does not
    // have. That is the difference between a logo with stripes through it and
    // the one a real terminal draws.
    //
    // A lost context is not an error worth showing anybody: dispose the addon
    // and xterm falls back to the DOM renderer, which still works.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL here (a locked-down browser, a headless run without a GPU).
      // The DOM renderer is the fallback and it is the one we started with.
    }
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [open]);

  /**
   * One socket per open terminal. It only ever attaches: starting is the POST,
   * so a refusal is a sentence and not a socket that closes again for reasons
   * nobody can read.
   */
  useEffect(() => {
    if (!open) return;
    const term = termRef.current;
    if (!term) return;
    const url = new URL(`/api/sessions/${sessionId}/terminal/ws`, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    const decoder = new TextDecoder();
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        // PTY output. Binary because it is 99% of the traffic and wrapping it
        // in JSON would cost a parse per keystroke echoed back.
        const text = decoder.decode(event.data as ArrayBuffer, { stream: true });
        // `CSI > <flags> u` pushes the kitty keyboard protocol, `CSI < u` pops
        // it. xterm.js implements neither, so this is the only way to know
        // whether an enhanced key encoding would be understood or would land in
        // the prompt as rubbish.
        if (/\u001b\[>\d*u/.test(text)) kittyRef.current = true;
        else if (text.includes('\u001b[<u')) kittyRef.current = false;
        term.write(text);
        return;
      }
      try {
        const message = JSON.parse(event.data) as { t: string; message?: string };
        if (message.t === 'error') setError(message.message ?? 'The terminal reported an error.');
        else if (message.t === 'exit') void queryClient.invalidateQueries({ queryKey: ['terminal', sessionId] });
      } catch {
        // A control frame we cannot read is a control frame we ignore.
      }
    };
    socket.onerror = () => setError('The connection to the terminal was lost.');
    // The FIRST thing said up the socket is how big this panel really is.
    //
    // Two moments need it and neither can be served by the server's own guess.
    // At the start the CLI was spawned before an xterm existed to measure — the
    // panel is a one-line bar until the terminal opens — so it is born at a
    // fallback size and would draw its whole layout for a console nobody has.
    // And on a reconnect the window may be a different one entirely: opened on
    // a laptop, come back to on a monitor. Sending it here also makes the CLI
    // repaint in full, which is what tidies a replayed backlog.
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: 'r', cols: term.cols, rows: term.rows }));
    };

    const input = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'i', d: data }));
    });
    /**
     * Shift+Enter, which is a newline in the CLI and was sending the prompt.
     *
     * A terminal sends a bare CR for Enter and, historically, the same bare CR
     * for Shift+Enter — the modifier has nowhere to go. The kitty keyboard
     * protocol is what gives it one, and Claude Code enables it at startup;
     * xterm.js does not implement it, so the shift was being dropped on the
     * floor and the CLI saw two identical keys.
     *
     * `13;2u` is Enter with shift in that encoding. Only sent while the program
     * has actually asked for the protocol — otherwise the sequence would be
     * typed into the prompt as text, which is a worse bug than the one being
     * fixed.
     */
    term.attachCustomKeyEventHandler((e) => {
      /**
       * Ctrl+V pastes, and the way to make it paste is to do nothing.
       *
       * xterm maps every Ctrl+letter to its control code — `\x16` here — and
       * that mapping carries `cancel: true`, so xterm calls `preventDefault`
       * and the browser's own paste command never runs. Its `paste` listener
       * was there all along, bracketed-paste and all; nothing was ever
       * reaching it. Returning false makes `_keyDown` bail before that
       * `cancel`, the browser pastes into the helper textarea as it would
       * anywhere else, and the listener turns it into `ESC[200~ … ESC[201~`.
       *
       * This is the native paste command, not `navigator.clipboard`, so it
       * keeps working from a browser on another machine over plain HTTP, where
       * that API does not exist at all ([AI_REMOTE_ACCESS.md]).
       */
      if ((e.key === 'v' || e.key === 'V') && e.ctrlKey && !e.altKey && !e.metaKey) return false;

      const shiftEnter = e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
      if (!shiftEnter || !kittyRef.current) return true;
      if (e.type === 'keydown') {
        e.preventDefault();
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ t: 'i', d: '\u001b[13;2u' }));
        }
      }
      // FALSE FOR THE KEYPRESS TOO, and that line is the fix.
      //
      // Returning false makes xterm's `_keyDown` bail BEFORE it calls its own
      // `cancel()`, so nothing has stopped the browser firing `keypress` — and
      // `_keyPress` asks this same handler again. An earlier version answered
      // only for `keydown` and let the keypress through, so xterm sent `\r`
      // from its char code: the CLI got the sequence AND a carriage return, a
      // newline followed instantly by the prompt being submitted, which is the
      // exact behaviour this exists to remove. Proved by putting it back:
      // Shift+Enter sent `bbb` on its own.
      //
      // `preventDefault` above suppresses the keypress at source, so either
      // line alone is enough in Chrome. Both stay because they fail
      // differently, and this is not a place to be clever.
      return false;
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'r', cols, rows }));
    });

    return () => {
      input.dispose();
      resize.dispose();
      socket.close();
      socketRef.current = null;
    };
  }, [open, sessionId, queryClient]);

  // The panel changed shape: re-measure and tell the CLI, which decides its
  // whole layout from the console size.
  const refit = useCallback(() => {
    try {
      fitRef.current?.fit();
    } catch {
      // Measuring a panel that is mid-transition; the next call gets it.
    }
  }, []);
  useEffect(refit, [height, full, refit]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(refit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [open, full, refit]);

  const start = useMutation({
    mutationFn: async () => {
      // The size the CLI is born into decides its layout, and the panel is
      // already on screen at its real height — so measure first and start with
      // the answer, rather than starting at a default and resizing after.
      const term = termRef.current;
      const cols = term?.cols ?? 100;
      const rows = term?.rows ?? 24;
      return api.terminalStart(sessionId, { cols, rows });
    },
    onSuccess: () => {
      setError(null);
      onStarted?.();
      void queryClient.invalidateQueries({ queryKey: ['terminal', sessionId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const close = useMutation({
    mutationFn: () => api.terminalStop(sessionId),
    onSuccess: () => {
      setError(null);
      termRef.current?.clear();
      void queryClient.invalidateQueries({ queryKey: ['terminal', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  // Dragging the TOP edge, because the bottom one is the window. Same shape as
  // the session list's sidebar handle, turned on its side.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const from = readHeight();
    const onMove = (ev: MouseEvent) => {
      const next = clamp(from + startY - ev.clientY);
      setHeight(next);
      localStorage.setItem(HEIGHT_KEY, String(next));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  /**
   * One measurement, two answers, because both are about where this panel ends.
   *
   * `bleed` stretches the drag handle across the whole scroller instead of the
   * column: a resize bar the width of the panel reads as part of the panel, and
   * one that runs edge to edge reads as the seam between two things, which is
   * what it is. The width is measured rather than written as `100vw` — the
   * scroller reserves a scrollbar gutter on both edges and pads itself, so a
   * viewport-wide child would hang outside its padding box and earn the page a
   * horizontal scrollbar. `clientWidth` is exactly the box that cannot overflow.
   *
   * `rightGap` is how much room is left between this panel and the scroller's
   * right edge, which is the only thing that decides whether the follow pill has
   * anywhere to sit beside it. Reported rather than acted on here: the pill
   * belongs to the page.
   */
  const [bleed, setBleed] = useState<{ width: number; marginLeft: number } | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scroller = root.closest('[data-conversation-scroller]');
    const measure = (): void => {
      const rootBox = root.getBoundingClientRect();
      if (!(scroller instanceof HTMLElement)) {
        setBleed(null);
        onLayout?.({ full, open, height: root.offsetHeight, rightGap: 0 });
        return;
      }
      const scrollerBox = scroller.getBoundingClientRect();
      setBleed(
        open && !full
          ? {
              width: scroller.clientWidth,
              marginLeft: Math.round(scrollerBox.left + scroller.clientLeft - rootBox.left),
            }
          : null,
      );
      onLayout?.({
        full,
        open,
        height: root.offsetHeight,
        rightGap: Math.round(scrollerBox.right - rootBox.right),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (scroller instanceof HTMLElement) observer.observe(scroller);
    observer.observe(root);
    return () => observer.disconnect();
  }, [open, full, onLayout]);

  // Escape leaves full screen and stops there: the page's own handler ends in
  // `navigate(-1)`, so letting it through would leave the session as well.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFull(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  const notice = error ?? (open ? null : blocked);

  const screen = (
    <div
      // Read by the page's keyboard handlers, which stand aside for anything
      // born in here: with the focus in a terminal, Ctrl+F is the CLI's and
      // Escape is the CLI's.
      data-terminal
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-dim)]">
        <span className="text-[var(--accent)]">❯</span>
        <span className="truncate" title={cwd ?? undefined}>
          {running ? 'claude' : exit ? `claude exited (code ${exit.code ?? 'killed'})` : 'claude'}
          {cwd ? ` — ${cwd}` : ''}
        </span>
        {status.data?.pid ? <span className="shrink-0">pid {status.data.pid}</span> : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {!running && (
            <button
              type="button"
              onClick={() => start.mutate()}
              disabled={start.isPending || !!blocked}
              className="rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
            >
              {start.isPending ? 'starting…' : '❯ start again'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setFull((v) => !v)}
            title={full ? 'Back to the conversation (Esc)' : 'Fill the window'}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            {full ? '⤡ close' : '⤢ full screen'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (running) setConfirmClose(true);
              else close.mutate();
            }}
            title={running ? 'Stop Claude and close this terminal' : 'Close this terminal'}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            ×
          </button>
        </div>
      </div>
      {/* The xterm host. `min-h-0` so it can be smaller than its content, which
          is what lets the flex column own the height instead of the terminal
          growing the page. */}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden px-1 py-0.5" />
    </div>
  );

  return (
    // The page's own background, so the conversation scrolls UNDER this rather
    // than through it — which it literally does: this is stuck to the bottom of
    // the scroller the turns are in. `relative` is what the fade below hangs on.
    <div ref={rootRef} className="relative shrink-0 bg-[var(--bg)] pt-1 pb-3">
      {confirmClose && (
        <CloseSessionDialog
          // From the cache the page already holds: a dialog is no reason to go
          // and re-read a whole transcript.
          cache={cacheClockOf(queryClient.getQueryData<SessionDetailResponse>(['session', sessionId]))}
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false);
            close.mutate();
          }}
        />
      )}
      {notice && (
        <div
          className={`mb-1.5 rounded-lg border px-3 py-1.5 text-[11px] ${
            error
              ? 'border-red-900/60 bg-red-950/30 text-red-300'
              : 'border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-dim)]'
          }`}
        >
          {notice}
        </div>
      )}
      {/* The fade over the gap the sticky wrapper leaves, exactly as the
          composer draws it: the last message stops above the strip instead of
          dissolving into it. Outside the flow, so it takes no space. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-b from-transparent to-[var(--bg)]"
      />
      {open && (
        <>
          {full ? (
            // The strip keeps its place with a line saying where the panel went,
            // exactly as the plan panel does: two live copies of one terminal
            // would be two views fighting over one cursor.
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1.5 text-[11px] text-[var(--text-dim)]">
              The terminal is filling the window. Esc brings it back.
            </div>
          ) : (
            // The grab area straddles the panel's top edge instead of floating
            // above it: 8 px tall with a negative margin of half that, so the
            // hairline sits exactly ON the border and there is something to
            // catch on either side of it. A 1 px target four pixels clear of
            // the thing it resizes is a target you have to aim at.
            <div
              className="group relative -mb-1 h-2 cursor-row-resize"
              style={bleed ? { width: bleed.width, marginLeft: bleed.marginLeft } : undefined}
              onMouseDown={startResize}
              title="Drag to resize"
            >
              <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded transition-colors group-hover:bg-[var(--accent-dim)]" />
            </div>
          )}
          {/*
            ONE element, in one place, whatever `full` is doing — and that is not
            a simplification, it is the whole trick. xterm is attached to the host
            div below by `term.open()`, so moving the panel into a portal unmounts
            that div and takes the terminal's entire DOM with it: measured, and
            what it looks like is a full screen with nothing in it. So full screen
            is a class on this element rather than a different place to render it.
          */}
          <div
            className={
              full
                ? 'fixed inset-0 z-50 flex flex-col bg-[var(--bg)] p-2'
                : 'flex flex-col'
            }
            // Nothing but the height. The follow pill floats over this corner
            // and the composer answers that by keeping `Send` out of it — but a
            // terminal has no spare corner to give: every cell is content, and
            // reserving the pill's width just makes the panel narrower than the
            // conversation above it for no reason anyone can see. The pill moves
            // up instead; the page does it, from the height reported above.
            style={full ? undefined : { height }}
          >
            {screen}
          </div>
        </>
      )}
      {!open && (
        <div
          className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-xs"
          style={{
            // The follow pill floats in this corner; give it back where the
            // column reaches the window's edge. Same `max()` the composer does.
            paddingRight: columnWidth
              ? `max(0.75rem, calc(${String(PILL_CORNER_PX)}px - 50vw + ${columnWidth} / 2))`
              : undefined,
          }}
        >
          <button
            type="button"
            onClick={() => start.mutate()}
            disabled={start.isPending || !!blocked}
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-[var(--text)] hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {start.isPending ? 'starting…' : '❯ Start a terminal here'}
          </button>
          <span className="min-w-0 truncate text-[var(--text-dim)]" title={cwd ?? undefined}>
            {cwd ? `Claude Code, in ${cwd}` : 'Claude Code'}
          </span>
        </div>
      )}
    </div>
  );
}
