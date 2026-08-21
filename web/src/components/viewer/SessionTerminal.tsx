import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionDetailResponse, TerminalServerMessage } from '@claude-history/shared';
import { api } from '../../api/client.ts';
import { busyFromLive, cacheClockOf, CloseSessionDialog, closingNeedsAsking } from './CloseSessionDialog.tsx';
import { clamp, HEIGHT_KEY, readHeight } from '../../lib/terminalPrefs.ts';
import { BlockedBar } from './BlockedBar.tsx';
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
   * Start it without being asked, and put the cursor in it.
   *
   * `/new` only, and that is the whole of it: a session being started from the
   * app has no other reason to exist, so a bar asking whether to start the thing
   * that was just asked for is a click that means nothing — the folder was the
   * question, and it has been answered. Everywhere else the button stays,
   * because opening a conversation to READ it must never spawn a CLI.
   */
  autoStart,
  /**
   * Take the keys on MOUNT, not only after a start of this component's own.
   *
   * One caller, and it is the handover: `/new` navigates to `/session/<id>` as
   * soon as the transcript appears, which remounts this and rebuilds the xterm
   * — so somebody who has just typed their first prompt into it would find the
   * next keystroke going nowhere and the panel needing a click. It is the same
   * focus they had a second earlier, which is the only case where taking it is
   * not taking it from somebody who was reading.
   */
  autoFocus,
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
  autoStart?: boolean;
  autoFocus?: boolean;
  onLayout?: (layout: { full: boolean; open: boolean; height: number; rightGap: number }) => void;
}) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['terminal', sessionId], queryFn: () => api.terminalStatus(sessionId) });
  const [height, setHeight] = useState(readHeight);
  const [full, setFull] = useState(false);
  /**
   * Collapsed to its title bar. The CLI keeps running and the socket stays
   * attached — this is a panel getting out of the way of the conversation, not a
   * session being closed, which is the distinction the × button owns.
   *
   * **NOT remembered, anywhere, on purpose.** Opening a conversation is READING
   * it, so the terminal starts out of the way and the focus decides the rest:
   * clicking the bar opens it, the focus leaving it puts it away again
   * ([collapseOnFocusOut]). A remembered flag was answering a question nobody
   * had asked — "how did you leave this one?" — and the answer only ever showed
   * up as a panel that came up hiding itself.
   *
   * The one exception is a session being STARTED (`autoStart`/`autoFocus`, i.e.
   * `/new` and the handover that follows it): the folder was the question, the
   * terminal is the answer, and it comes up open with the cursor in it.
   */
  const [minimised, setMinimised] = useState(!(autoStart || autoFocus));
  /**
   * Held open on purpose: the one way to switch the focus rule off.
   *
   * The rule is right for reading and wrong for watching — a turn you want to
   * see arrive while you scroll back through the conversation is a panel that
   * must not tuck itself away the moment you click a message. So the pin is an
   * ANSWER to that rule rather than an exception to it: nothing else changes,
   * the bar still opens it, the × still closes it, and the focus simply stops
   * being what puts it away ([collapseOnFocusOut]).
   *
   * **Not remembered either**, and for the same reason as the rest of this
   * panel: a session is opened to be read, so it opens as a title bar, unpinned.
   * Held open until you leave the conversation, not until you take it back.
   */
  const [pinned, setPinned] = useState(false);
  // The route is `/session/:id` for every session, so going from one to another
  // keeps this component mounted: the next session is one being read, whatever
  // this one was left doing — pin included, since a pin is something done to the
  // conversation you were in. A session being STARTED is never reached this way:
  // `/new` is another page, so its handover is a fresh mount.
  const firstSession = useRef(sessionId);
  useEffect(() => {
    if (firstSession.current === sessionId) return;
    firstSession.current = sessionId;
    setMinimised(true);
    setPinned(false);
  }, [sessionId]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Closing is asked about only when there is something to lose by it — a warm
   * cache, or a turn in flight ([CloseSessionDialog]). A terminal holding a dead
   * process's screen, or a live one whose hour is already up, closes on the
   * first click: a dialog whose own text says it does not matter is what teaches
   * people to click through the one that does.
   */
  const [confirmClose, setConfirmClose] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /**
   * The keys go to the terminal as soon as there is one to type into.
   *
   * Set by the start that asked for it — the button, or `autoStart` — and never
   * by a mount: arriving at a session that already has one running is READING,
   * and taking the focus there would take Ctrl+F and Escape away from a page
   * somebody is only looking at ([isFromTerminal]). It cannot be done at the
   * moment of the click either, because until the panel is open there is no
   * xterm to focus — so the intention waits here until there is one.
   */
  const focusOnOpen = useRef(autoFocus ?? false);
  /**
   * Whether the program inside has asked to be told about modifiers, which is
   * what makes Shift+Enter a key of its own rather than another Enter.
   *
   * Told to us by the SERVER, on attach and whenever it changes: the sequence
   * that asks for it is sent once at startup and the replayed backlog is
   * bounded, so the browser can only read it off the stream on a terminal young
   * enough still to have it — which is a fix that works until the first reload.
   * The reasoning, and the two protocols involved, live where the reading is
   * done ([server/src/core/sessionTerminal.ts]).
   */
  const enhancedKeysRef = useRef(false);

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
    if (focusOnOpen.current) {
      focusOnOpen.current = false;
      term.focus();
    }
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

    const decoder = new TextDecoder();
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        // PTY output. Binary because it is 99% of the traffic and wrapping it
        // in JSON would cost a parse per keystroke echoed back.
        const text = decoder.decode(event.data as ArrayBuffer, { stream: true });
        term.write(text);
        return;
      }
      try {
        const message = JSON.parse(event.data) as TerminalServerMessage;
        if (message.t === 'error') setError(message.message);
        else if (message.t === 'exit') void queryClient.invalidateQueries({ queryKey: ['terminal', sessionId] });
        // Both frames carry the same fact, from the two moments it can arrive:
        // `ready` is what the terminal was already doing before this browser
        // attached, `keys` is it changing while we watch.
        else if (message.t === 'ready') enhancedKeysRef.current = message.enhancedKeys;
        else if (message.t === 'keys') enhancedKeysRef.current = message.enhanced;
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
     * for Shift+Enter — the modifier has nowhere to go. An enhanced encoding is
     * what gives it one; xterm.js implements none of them, so without this the
     * shift is dropped on the floor and the CLI sees two identical keys.
     *
     * `13;2u` is Enter with shift in the kitty encoding, and the CLI still reads
     * it as a newline even now that it asks for win32-input-mode instead —
     * measured on v2.1.238, against the win32 record for the same key, which it
     * takes for a plain Enter and submits. So the ENCODING is settled by what the
     * program understands and the GATE by what it asked for: sent only while it
     * has asked to hear about modifiers, because otherwise the sequence lands in
     * the prompt as text, which is a worse bug than the one being fixed.
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
      if (!shiftEnter || !enhancedKeysRef.current) return true;
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
  // `minimised` among them: coming back from a hidden host means xterm has been
  // measuring a box of zero, and nothing else would tell it otherwise.
  useEffect(refit, [height, full, minimised, refit]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(refit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [open, full, refit]);
  /**
   * The cursor lands in the terminal only once it has been MEASURED.
   *
   * Declared after the refit above so it runs after it in the same commit: the
   * host was `display: none`, so xterm's idea of the console is a box of zero
   * until `fit()` has had a look, and a CLI told its real size a moment after
   * being typed into repaints over what was typed.
   *
   * `full` is in here with the other two because filling the window is one of
   * the three ways a terminal becomes the thing you are using, and it is the one
   * that changes neither of them: going full screen from an already open panel
   * moves nothing else this effect could watch.
   */
  useEffect(() => {
    if (minimised || !focusOnOpen.current) return;
    const term = termRef.current;
    if (!term) return;
    focusOnOpen.current = false;
    term.focus();
  }, [minimised, open, full]);

  /**
   * Open it, which is the only thing the title bar does now.
   *
   * The focus goes with it, always: the bar is not a switch, it is the way in —
   * and the way out is the focus leaving ([collapseOnFocusOut]), so a panel
   * opened without the cursor in it would be a panel that closes on the next
   * click for no reason anyone could see.
   */
  const expand = useCallback(() => {
    setMinimised(false);
    // Either there is an xterm to focus — the ordinary case, since the panel is
    // open — or the effect that builds one takes the focus when it does.
    focusOnOpen.current = true;
    if (termRef.current && !minimised) {
      focusOnOpen.current = false;
      termRef.current.focus();
    }
  }, [minimised]);

  /**
   * A press anywhere in this panel means the terminal, and keeps the focus in it.
   *
   * `preventDefault` is the load-bearing half. None of the title bar, the drag
   * handle or the padding is focusable, so a press on any of them moves the
   * focus to `body` — which both puts the panel away mid-gesture and leaves the
   * focus nowhere, so the next click outside would have no `focusout` to fire
   * and the panel would stay open instead.
   *
   * Two things are left alone: a button, which owns its own click and its own
   * focus, and the xterm host, where a press is a cursor being placed or a
   * selection being dragged and the terminal does both itself.
   *
   * The LEFT button only. A right-click is asking for a menu and a middle one is
   * a paste on the platforms that have it; neither is a way into a terminal, and
   * opening the panel on either would be a click doing two things.
   */
  const takeFocus = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || confirmClose) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('button')) return;
      if (hostRef.current?.contains(target)) return;
      e.preventDefault();
      expand();
    },
    [confirmClose, expand],
  );

  /**
   * The focus leaving puts the panel away again, which is the other half of the
   * bar being the way in — and the whole reason nothing has to be remembered.
   *
   * Watched on the ROOT and not on the xterm: the title bar's buttons, the drag
   * handle and the close dialog are all in here, and taking the focus off the
   * terminal is not what any of them means.
   *
   * Deferred by a tick and then asked of `document.activeElement`, because
   * `relatedTarget` is null for the commonest move there is — a click on a
   * paragraph of the conversation, which nothing can focus, so the focus lands
   * on `body`. `document.hasFocus()` is what tells that apart from alt-tabbing
   * away: leaving the BROWSER says nothing about this panel, and coming back to
   * find it collapsed would be an answer to a question nobody asked.
   *
   * Full screen is exempt: there is one way out of it and it is its own button,
   * and a `fixed inset-0` panel with a hidden host is a blank window. So is a
   * panel somebody has pinned, which is the whole of what the pin does.
   */
  const collapseOnFocusOut = useCallback(() => {
    if (full || minimised || confirmClose || pinned) return;
    window.setTimeout(() => {
      const root = rootRef.current;
      if (!root || !document.hasFocus()) return;
      const active = document.activeElement;
      if (active && active !== document.body && root.contains(active)) return;
      setMinimised(true);
    }, 0);
  }, [full, minimised, confirmClose, pinned]);

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
      // Starting one is asking to SEE it: a terminal that comes up as a title
      // bar the moment it was asked for is the one behaviour nobody could
      // explain. Pressing the button is the same statement `/new` makes by
      // existing, so it gets the same answer — open, with the cursor in it.
      setMinimised(false);
      // Either the xterm is there already — "start again" on a panel keeping a
      // dead process's screen — or it is about to be built, and the effect that
      // builds it takes the focus then.
      if (termRef.current) termRef.current.focus();
      else focusOnOpen.current = true;
      onStarted?.();
      void queryClient.invalidateQueries({ queryKey: ['terminal', sessionId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  /**
   * `autoStart`: once per session, and only from a state that can be started.
   *
   * Guarded by the id and not by a boolean, because this component survives a
   * navigation from one session to another and "already tried" has to mean this
   * one. A refusal is never retried — `blocked` is a sentence in the bar, and a
   * loop of POSTs against it would be a spinner nobody can stop.
   */
  const autoStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!autoStart || !status.data || open || blocked) return;
    if (autoStarted.current === sessionId) return;
    autoStarted.current = sessionId;
    start.mutate();
  }, [autoStart, status.data, open, blocked, sessionId, start]);

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

  /**
   * Full screen is the one thing about this panel that IS remembered — and only
   * for as long as it lasts.
   *
   * Filling the window has to open the panel (the host is hidden while collapsed,
   * and a full screen with a hidden host is a blank window), so leaving it has to
   * put back whatever that opening interrupted: sent full screen from a title bar,
   * the panel comes back a title bar. It is the same reasoning as everything else
   * here — going full screen is a look at the terminal, not a statement about what
   * the conversation should look like afterwards — and a ref rather than state,
   * because nothing renders differently for it.
   *
   * **It takes the focus into the terminal, and NOTHING here answers Escape.** A
   * terminal filling the window is a terminal being used, so the keys are the
   * CLI's, all of them: Escape closes its menus and cancels its turn, and a page
   * that took that one key would be a page reaching into a program somebody is
   * typing into for the sake of a shortcut its own button already offers. There
   * was a `keydown` listener here doing exactly that, and it only ever worked
   * while the cursor was NOT in the terminal — the state that no longer exists.
   */
  const collapsedBeforeFull = useRef(false);
  const enterFull = useCallback(() => {
    collapsedBeforeFull.current = minimised;
    setMinimised(false);
    setFull(true);
    // The panel may be a hidden host this instant, so the intention waits for
    // the effect that focuses after the refit rather than being acted on here.
    focusOnOpen.current = true;
  }, [minimised]);
  const leaveFull = useCallback(() => {
    setFull(false);
    if (!collapsedBeforeFull.current) return;
    collapsedBeforeFull.current = false;
    setMinimised(true);
  }, []);

  // What went WRONG, and nothing else: a `blocked` session takes the place of
  // the start bar instead ([BlockedBar]), because a greyed-out button with a
  // sentence over it is two rows saying one thing.
  const notice = error;

  const screen = (
    <div
      // Read by the page's keyboard handlers, which stand aside for anything
      // born in here: with the focus in a terminal, Ctrl+F is the CLI's and
      // Escape is the CLI's.
      data-terminal
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]"
    >
      {/* The bar IS the way in, so there is no button to press: a click on it
          opens the panel and puts the cursor in the terminal, and the focus
          leaving is what puts it away again. `cursor-pointer` only while
          collapsed — open, the bar is a label and the click is a no-op that
          merely keeps the focus where it already is. */}
      <div
        className={`flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-dim)] ${
          minimised ? 'cursor-pointer hover:text-[var(--text)]' : ''
        }`}
        title={minimised ? 'Click to open the terminal' : undefined}
      >
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
          {/* Only on an OPEN panel, and never in full screen: the pin answers
              the focus rule, and neither a title bar nor a window-filling
              terminal is subject to it. */}
          {!full && !minimised && (
            <button
              type="button"
              aria-pressed={pinned}
              onClick={() => setPinned((v) => !v)}
              title={
                pinned
                  ? 'Pinned open — click to let the focus put it away again'
                  : 'Keep it open even when the focus goes elsewhere'
              }
              // Pressed, it keeps the lit background rather than borrowing the
              // hover one: a state you have to point at to see is a state that
              // is invisible from where the panel is being read.
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)] ${
                pinned ? 'bg-[var(--bg-hover)] text-[var(--accent)]' : 'hover:text-[var(--text)]'
              }`}
            >
              {/* A tack: the wide cap a thumb presses, the body under it, and
                  the needle. The silhouette is what has to survive 12 px, so it
                  is the shape that carries the icon and the detail inside it is
                  allowed to close up — a circle on a stick was the first attempt
                  and read as a balloon, which is a different symbol entirely.
                  The FILL is the state, pressed in while it is holding the panel
                  open, and the word beside it never changes: the buttons are
                  right-aligned, so a label that grew would slide the icon out
                  from under the pointer that was clicking it. */}
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="size-3 shrink-0"
                fill={pinned ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                <path d="M12 17v5" fill="none" />
              </svg>
              pin
            </button>
          )}
          <button
            type="button"
            // Opens the panel on the way in, puts it back on the way out, and
            // takes the focus into the terminal ([enterFull]).
            onClick={full ? leaveFull : enterFull}
            // It says *full screen* on the way out too, and never "close": one
            // word for two different things is how a button that gives the
            // conversation back gets read as the one that ends a CLI mid-turn.
            title={full ? 'Leave full screen — the terminal is not closed' : 'Fill the window'}
            className="rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            {full ? '⤡ exit full screen' : '⤢ full screen'}
          </button>
          {/* Not offered while the panel is filling the window. Ending the CLI
              is not a way out of a view, and the only × on a screen with nothing
              else on it is the one that gets pressed to get out of it — beside a
              button that used to say *close* about something else entirely. Come
              back first; it is one click either way, and only one of them is
              irreversible. */}
          {!full && (
            <button
              type="button"
              onClick={() => {
                if (running && closingNeedsAsking(queryClient, sessionId)) setConfirmClose(true);
                else close.mutate();
              }}
              title={running ? 'Stop Claude and close this terminal' : 'Close this terminal'}
              className="rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {/* The xterm host. `min-h-0` so it can be smaller than its content, which
          is what lets the flex column own the height instead of the terminal
          growing the page. */}
      {/* Hidden, never unmounted: xterm is attached to this div, so taking it
          out of the tree would take the terminal's whole DOM with it — the same
          trap the full-screen class avoids. */}
      <div ref={hostRef} className={minimised ? 'hidden' : 'min-h-0 flex-1 overflow-hidden px-1 py-0.5'} />
    </div>
  );

  return (
    // The page's own background, so the conversation scrolls UNDER this rather
    // than through it — which it literally does: this is stuck to the bottom of
    // the scroller the turns are in. `relative` is what the fade below hangs on.
    //
    // The two halves of "the panel is open while you are in it" hang here, on
    // the whole thing rather than on the terminal: a press anywhere inside means
    // the terminal ([takeFocus]), and the focus reaching anything outside means
    // the conversation ([collapseOnFocusOut]).
    <div
      ref={rootRef}
      onMouseDown={takeFocus}
      onBlur={collapseOnFocusOut}
      className="relative shrink-0 bg-[var(--bg)] pt-1 pb-3"
    >
      {confirmClose && (
        <CloseSessionDialog
          // From the cache the page already holds: a dialog is no reason to go
          // and re-read a whole transcript.
          cache={cacheClockOf(queryClient.getQueryData<SessionDetailResponse>(['session', sessionId]))}
          // The CLI's own `status`, which is what makes "that turn will be cut
          // off" a fact rather than a guess. Read at render, right after the
          // click that opened this.
          busy={busyFromLive(queryClient, sessionId)}
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false);
            close.mutate();
          }}
        />
      )}
      {notice && (
        <div className="mb-1.5 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-[11px] text-red-300">
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
          {full || minimised ? null : (
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
          {full && (
            // The strip keeps its place with a line saying where the panel went,
            // exactly as the plan panel does: two live copies of one terminal
            // would be two views fighting over one cursor.
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1.5 text-[11px] text-[var(--text-dim)]">
              The terminal is filling the window. Its own ⤡ exit full screen brings it back.
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
            // Nothing but the height — and none at all when collapsed, so the
            // box is exactly its own title bar. The follow pill floats over this corner
            // and the composer answers that by keeping `Send` out of it — but a
            // terminal has no spare corner to give: every cell is content, and
            // reserving the pill's width just makes the panel narrower than the
            // conversation above it for no reason anyone can see. The pill moves
            // up instead; the page does it, from the height reported above.
            style={full || minimised ? undefined : { height }}
          >
            {screen}
          </div>
        </>
      )}
      {/* Blocked replaces the start bar rather than disabling its button: there
          is nothing to press, and the reason is the row. */}
      {!open && blocked && <BlockedBar reason={blocked} columnWidth={columnWidth} />}
      {!open && !blocked && (
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
            disabled={start.isPending}
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-[var(--text)] hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {start.isPending ? 'starting…' : '❯ Start an embedded terminal here'}
          </button>
        </div>
      )}
    </div>
  );
}
