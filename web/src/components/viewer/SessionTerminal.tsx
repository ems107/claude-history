import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client.ts';
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
}: {
  sessionId: string;
  /** A CSS length, not a number — `min(896px, 100vw)` and the like. */
  columnWidth?: string;
  onStarted?: () => void;
}) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['terminal', sessionId], queryFn: () => api.terminalStatus(sessionId) });
  const [height, setHeight] = useState(readHeight);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

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
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5_000,
      theme: themeFrom(hostRef.current),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
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
        term.write(decoder.decode(event.data as ArrayBuffer, { stream: true }));
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

    const input = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'i', d: data }));
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
            onClick={() => close.mutate()}
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
    <div className="relative shrink-0 bg-[var(--bg)] pt-1 pb-3">
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
      {open && !full && (
        <div
          className="mb-1 h-1 cursor-row-resize rounded hover:bg-[var(--accent-dim)]"
          onMouseDown={startResize}
          title="Drag to resize"
        />
      )}
      {open && !full && (
        <div className="flex flex-col" style={{ height }}>
          {screen}
        </div>
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
      {full &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] p-2" data-terminal>
            {screen}
          </div>,
          document.body,
        )}
    </div>
  );
}
