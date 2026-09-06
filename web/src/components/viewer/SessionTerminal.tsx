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
import { useBackDismiss, useIsMobile } from '../../lib/mobile.ts';
import { selectionText } from '../../lib/selection.ts';
import {
  clamp,
  getTerminalFontSize,
  HEIGHT_KEY,
  readHeight,
  stepTerminalFontSize,
  TERMINAL_FONT_DEFAULT,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_MIN,
  useTerminalFontSize,
} from '../../lib/terminalPrefs.ts';
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
/**
 * The keys a terminal needs and a phone keyboard does not have.
 *
 * Esc, Tab, Ctrl and the arrows are not conveniences here: without them a CLI
 * cannot be answered at all — no interrupt, no menu dismissed, no history
 * walked, no completion. `|`, `~`, `-` and `/` are on the soft keyboard's
 * second page and used constantly, so they are worth a tap each.
 *
 * Everything goes through `term.input()`, which is xterm's own way of saying
 * "this arrived from the user": it fires `onData`, so it takes the same path up
 * the socket as a keystroke, sticky Ctrl and all, and nothing here needs to know
 * a socket exists.
 *
 * `onPointerDown` with `preventDefault`, not `onClick`: a tap on a button would
 * otherwise take the focus off the terminal, which on Android closes the
 * keyboard — so the bar would put a key through and dismiss the keyboard in the
 * same gesture, every time.
 */
interface Key {
  label: string;
  data: string;
  title: string;
}

/** First on the row, because it is the key a CLI dialog is answered NO with. */
const ESC: Key = { label: 'Esc', data: '\u001b', title: 'Escape' };
/** After the modifiers, because Shift+Tab is what it is most often pressed with. */
const TAB: Key = { label: 'Tab', data: '\t', title: 'Tab — completion, and Shift+Tab cycles the CLI’s modes' };

/** The rest, in the order a thumb reaches for them. */
const TERMINAL_KEYS: Key[] = [
  { label: '↑', data: '\u001b[A', title: 'Up — the previous command' },
  { label: '↓', data: '\u001b[B', title: 'Down' },
  { label: '←', data: '\u001b[D', title: 'Left' },
  { label: '→', data: '\u001b[C', title: 'Right' },
  { label: '^C', data: '\u0003', title: 'Ctrl+C — interrupt' },
  { label: '|', data: '|', title: 'Pipe' },
  { label: '~', data: '~', title: 'Tilde' },
  { label: '-', data: '-', title: 'Hyphen' },
  { label: '/', data: '/', title: 'Slash' },
];

/** The three the bar holds for the next key. See [applyMods]. */
type Mod = 'ctrl' | 'alt' | 'shift';
type Mods = Record<Mod, boolean>;
const NO_MODS: Mods = { ctrl: false, alt: false, shift: false };

/** Shift's own sequence for the keys that have one. */
const SHIFTED: Record<string, string> = {
  '\t': '\u001b[Z', // back-tab
  '\u001b[A': '\u001b[1;2A',
  '\u001b[B': '\u001b[1;2B',
  '\u001b[C': '\u001b[1;2C',
  '\u001b[D': '\u001b[1;2D',
};

/**
 * The font xterm is asked for.
 *
 * It is not taste, and the last entry is not decoration either. The CLI draws
 * its logo and its panels out of block and box-drawing characters, and those
 * only line up in a font whose cell the glyphs were cut for — while
 * `ch-terminal-symbols` is 5 KB of Noto Sans Symbols 2 at the END of the
 * stack, holding the handful of glyphs an Android device turns out not to
 * have (`web/src/fonts/README.md`). CSS fallback is per CHARACTER, so it is
 * reached only for a glyph none of the others could draw.
 */
const TERMINAL_FONT =
  "'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, 'Courier New', 'ch-terminal-symbols', monospace";

/**
 * Is this `onData` really a KEY?
 *
 * Not everything that leaves xterm is one. With focus tracking on it reports
 * every focus in and out (`ESC [ I` / `ESC [ O`), and with mouse reporting on —
 * which Claude Code turns on — every tap, drag and synthetic wheel goes out as
 * an SGR mouse report. An armed modifier applied to one of those is a modifier
 * silently spent on something the user did not press: measured on the DT50 as
 * Alt arming, the keyboard closing, and the ESC landing on the focus report
 * instead of on the next key.
 */
function isKeystroke(data: string): boolean {
  if (data === '\u001b[I' || data === '\u001b[O') return false;
  return !data.startsWith('\u001b[<') && !data.startsWith('\u001b[M');
}

/**
 * What the armed modifiers turn the next keystroke into.
 *
 * A phone keyboard has none of these, and without them a CLI is unusable: no
 * interrupt, no chords, and no Shift+Tab — which in Claude Code is how you
 * cycle its modes, so it is not an edge case. Sticky rather than held, because
 * there is nothing to hold: they arm, the next key goes through changed, and
 * they disarm themselves.
 *
 * Applied in the order a terminal encodes them. **Shift first**, because it
 * changes the key itself — a real back-tab or an arrow with its modifier
 * parameter, and for an ordinary character the capital. **Then Ctrl**, which is
 * the letter's own code with the top three bits cleared, exactly as the
 * keyboard does it. **Then Alt**, which is an ESC in front of whatever came out
 * of the other two, which is how every terminal has sent Meta since before it
 * was called Alt.
 *
 * Anything that is not a single character and has no shifted form of its own
 * passes through untouched, and still disarms them: Ctrl plus an escape
 * sequence is not what a bar like this is for.
 */
function applyMods(data: string, mods: Mods): string {
  let out = data;
  if (mods.shift) {
    if (SHIFTED[out]) out = SHIFTED[out];
    else if (out.length === 1) out = out.toUpperCase();
  }
  if (mods.ctrl && out.length === 1) {
    const code = out.toUpperCase().charCodeAt(0);
    if (code >= 63 && code <= 95) out = String.fromCharCode(code & 31);
  }
  if (mods.alt) out = `\u001b${out}`;
  return out;
}

/**
 * A long path with its middle taken out, rather than its end.
 *
 * The cwd of a session started from the app is a temp folder six segments deep,
 * and the only two anybody reads are the first (which drive) and the last
 * (which project). Cut by SEGMENT rather than by character count, so what is
 * left is still a path. If it is still too wide the box truncates it, and that
 * truncation eats the front — see `truncate-start` in `styles.css`.
 */
function elidePath(path: string): string {
  const parts = path.split(/[\\/]/);
  if (parts.length <= 5) return path;
  const sep = path.includes('\\') ? '\\' : '/';
  return [parts[0], parts[1], '…', parts[parts.length - 2], parts[parts.length - 1]].join(sep);
}

/**
 * Paste, on a page that cannot read the clipboard.
 *
 * `navigator.clipboard` is `[SecureContext]` and this app is served over plain
 * HTTP on a LAN ([AI_REMOTE_ACCESS.md]), so it does not exist here at all. On a
 * desktop that costs nothing — Ctrl+V is a browser command and xterm's own
 * paste listener takes it — but a phone has no Ctrl+V, and long-pressing the
 * terminal lands on xterm's canvas rather than on a text field.
 *
 * So the paste goes somewhere it CAN happen: a real textarea, which Android's
 * own long-press menu will paste into. What arrives is handed to the terminal
 * the way a paste would be, and the box goes away.
 */
function PasteBox({ onSend, onCancel }: { onSend: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--accent-dim)] bg-[var(--bg-raised)] p-2">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Long-press here and choose Paste, then Send"
        className="w-full resize-none rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-10 flex-1 rounded border border-[var(--border)] px-3 text-sm text-[var(--text-dim)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={text === ''}
          onClick={() => onSend(text)}
          className="min-h-10 flex-1 rounded border border-[var(--accent-dim)] px-3 text-sm text-[var(--accent)] disabled:opacity-40"
        >
          Send to the terminal
        </button>
      </div>
    </div>
  );
}

/**
 * How far a finger may travel between going down and coming up and still be a
 * tap rather than a scroll. The row is wider than the screen, so the commonest
 * gesture over these buttons is a drag ACROSS them; firing on `pointerdown`
 * meant every attempt to reach `/` typed an `Esc` on the way.
 */
const TAP_SLOP_PX = 10;

/**
 * One key on the accessory bar.
 *
 * **It fires on the way UP, not on the way down**, and only if the finger has
 * not travelled — see `TAP_SLOP_PX`. `preventDefault` still goes on the way
 * down, and that is what it is for: it stops the press taking focus off the
 * terminal, which on Android closes the keyboard. It does not stop the row
 * scrolling; `touch-action` decides that, and this row is left free to pan.
 *
 * **One width for one kind of key.** A glyph key is a fixed square, so ↑ and ←
 * are the same size however differently the font draws them — the arrows came
 * out three pixels apart when the width was left to the text. A word key takes
 * the same height and floor with padding around its label.
 */
function TerminalKey({
  label,
  title,
  active,
  onPress,
}: {
  label: string;
  title: string;
  active?: boolean;
  onPress: () => void;
}) {
  const from = useRef<{ id: number; x: number; y: number } | null>(null);
  // Two characters or fewer is a glyph: a fixed square. Anything longer is a
  // word, and gets the same floor with room around it.
  const shape = label.length <= 2 ? 'w-11' : 'min-w-11 px-3';
  return (
    <button
      type="button"
      title={title}
      onPointerDown={(e) => {
        e.preventDefault();
        from.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = from.current;
        from.current = null;
        if (!start || start.id !== e.pointerId) return;
        if (Math.abs(e.clientX - start.x) > TAP_SLOP_PX || Math.abs(e.clientY - start.y) > TAP_SLOP_PX) return;
        onPress();
      }}
      onPointerCancel={() => {
        from.current = null;
      }}
      className={`flex h-10 shrink-0 items-center justify-center rounded border font-mono text-sm active:bg-[var(--bg-hover)] active:text-[var(--text)] ${shape} ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--text-dim)]'
      }`}
    >
      {label}
    </button>
  );
}

const MOD_TITLE: Record<Mod, string> = {
  ctrl: 'Ctrl — the next key goes through as a control code',
  alt: 'Alt — the next key is sent with an Escape in front of it, which is what Meta is',
  shift: 'Shift — the next key is sent shifted: Tab becomes back-tab, an arrow carries the modifier',
};

/**
 * The row, in the order a thumb wants it: the way out, the three modifiers,
 * the key they are most often pressed with, the paste this page cannot do any
 * other way, then movement, then punctuation the soft keyboard buries.
 */
function TerminalKeys({
  onKey,
  mods,
  onMod,
  onPaste,
}: {
  onKey: (data: string) => void;
  mods: Mods;
  onMod: (mod: Mod) => void;
  onPaste: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-[var(--border)] bg-[var(--bg-raised)] px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <TerminalKey label={ESC.label} title={ESC.title} onPress={() => onKey(ESC.data)} />
      {(['ctrl', 'alt', 'shift'] as const).map((mod) => (
        <TerminalKey
          key={mod}
          label={mod === 'ctrl' ? 'Ctrl' : mod === 'alt' ? 'Alt' : 'Shift'}
          title={MOD_TITLE[mod]}
          active={mods[mod]}
          onPress={() => onMod(mod)}
        />
      ))}
      <TerminalKey label={TAB.label} title={TAB.title} onPress={() => onKey(TAB.data)} />
      <TerminalKey
        label="Paste"
        title="Paste — opens a box to paste into, because a page served over plain HTTP cannot read the clipboard"
        onPress={onPaste}
      />
      {TERMINAL_KEYS.map((k) => (
        <TerminalKey key={k.label} label={k.label} title={k.title} onPress={() => onKey(k.data)} />
      ))}
    </div>
  );
}

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
  /**
   * The size of the type, which is NOT this panel's to keep.
   *
   * Subscribed rather than held: it is one answer for every terminal in the
   * browser, so the button that changes it is here but the value lives in
   * [terminalPrefs] and every terminal there is redraws off the same store —
   * this tab's, the next tab's, and the one opened tomorrow.
   */
  const fontSize = useTerminalFontSize();
  /**
   * A phone, where the panel is the window and the keys a terminal needs are
   * not on the keyboard.
   */
  const mobile = useIsMobile();
  // The same answer, readable from callbacks that must not be rebuilt when it
  // changes — `expand` is a `useCallback` the title bar holds, and the start
  // mutation's `onSuccess` is built once.
  const mobileRef = useRef(mobile);
  mobileRef.current = mobile;
  // Full screen from the start on a phone: 380px of panel inside a 620px window
  // under a header and a chip strip is about eight rows, and a CLI that draws
  // boxes needs more than that to be read at all. Read from the query rather
  // than from `mobile` because this is an initial value and the hook has not
  // answered on the first render.
  const [full, setFull] = useState(false);
  /**
   * Ctrl, Alt and Shift, held for the next key. See [applyMods] for what each
   * of them does to it.
   *
   * A ref as well as state because the transform happens inside `term.onData`,
   * which is set up once by an effect that must not depend on it.
   */
  const [mods, setMods] = useState<Mods>(NO_MODS);
  const modsRef = useRef<Mods>(NO_MODS);
  const armMod = useCallback((mod: Mod) => {
    const next = { ...modsRef.current, [mod]: !modsRef.current[mod] };
    modsRef.current = next;
    setMods(next);
  }, []);
  /** The paste box is open. See [PasteBox] for why one is needed at all. */
  const [pasting, setPasting] = useState(false);
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
   * Filling the window, and actually doing it.
   *
   * On a phone `full` starts true, before the panel has been opened — and a
   * `fixed inset-0` box whose xterm host is `hidden` is a blank screen, which is
   * the exact trap the class comment further down warns about. So the two are
   * kept apart: `full` is the intent and survives the panel being put away,
   * `fullNow` is what is drawn.
   */
  const fullNow = full && !minimised;

  // A terminal filling a phone's screen is the top layer of the page, so Back
  // has to mean "out of this" before it means "out of the session" — otherwise
  // the one control every Android user reaches for first would leave the
  // conversation while a terminal was covering it. It does exactly what the
  // panel's own ▾ does: puts it away as a title bar, still running. Through a
  // ref because `leaveFull` is declared with the rest of the callbacks, far
  // below, and this has to be registered with the other layers.
  const leaveFullRef = useRef<() => void>(() => undefined);
  useBackDismiss(mobile && fullNow, () => leaveFullRef.current());

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
  /**
   * The socket comes back on its own, and these two are how.
   *
   * A dropped line is not always somebody leaving — the wifi blinks, the laptop
   * suspends, the phone is locked — and until this the panel simply froze until
   * it was remounted or the page reloaded. That was already a nuisance; with the
   * server closing an unattached terminal on a session that never became a
   * conversation ([UNBORN_GRACE_MINUTES]), it is the difference between a blip
   * and a terminal that is gone when you come back.
   *
   * The count lives in a REF and only the tick is state: resetting the attempt
   * counter through `setState` inside `onopen` would re-run the effect and tear
   * down the socket that had just succeeded.
   */
  const attemptRef = useRef(0);
  const [reconnect, setReconnect] = useState(0);

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
      fontFamily: TERMINAL_FONT,
      // The GETTER, not the subscribed value, and that is load-bearing: this
      // effect's cleanup disposes the terminal, so a size in its dependency
      // list would tear the whole thing down and build it again on every press
      // — losing the screen this component exists to keep, and leaving the
      // socket, whose dependencies are different, writing into a dead terminal.
      // A live change is applied by the effect below instead.
      fontSize: getTerminalFontSize(),
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
    /**
     * Ask the on-screen keyboard not to suggest anything in here.
     *
     * A terminal is not prose: every key has to reach the CLI as it is pressed,
     * and there is nothing for a corrector to correct. xterm sets `autocorrect`
     * and `autocapitalize` off already; these are the other two halves of the
     * same request, and on a keyboard that honours it the suggestion strip goes
     * away — measured on the check device, where it did.
     *
     * **It does not fix the one keyboard that ignores it.** Samsung Keyboard
     * with predictive text on composes regardless, and the whole story — what
     * that breaks, what was tried, and what would actually fix it — is in
     * [AI_MOBILE.md](../../../../docs/AI_MOBILE.md) under *Samsung Keyboard*.
     * What is NOT set here is `inputMode`: the two non-linguistic variations
     * were tried and neither stopped it, and both cost the comma key — which a
     * prompt written to Claude needs and which is nowhere else on a phone,
     * where `/` is already a key on the accessory bar.
     */
    const ime = term.textarea;
    if (ime) {
      ime.spellcheck = false;
      ime.setAttribute('autocomplete', 'off');
    }
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

    /**
     * Make the symbol fallback arrive, and rebuild the atlas when it does.
     *
     * **xterm rasterises each glyph ONCE**, into a texture atlas it never
     * revisits. A webfont that is still downloading when the CLI paints its
     * first frame therefore loses: the box gets cached and stays cached for the
     * life of the terminal, which is exactly what happened — the font reported
     * `loaded`, a canvas drew the glyph perfectly, and the terminal went on
     * showing `□□ accept edits on`.
     *
     * Two things fix it and both are here. `document.fonts.load` is what starts
     * the download at all — nothing in the DOM uses this family, and a canvas
     * drawing text does not ask for a font that has never been requested — and
     * clearing the atlas afterwards throws away whatever was rasterised before
     * it arrived. Resolves immediately once it is cached, so a second terminal
     * pays a repaint and nothing else.
     */
    void document.fonts.load(`${getTerminalFontSize()}px ch-terminal-symbols`, '⏵').then(() => {
      // Disposed while the font was in flight: everything below would throw.
      if (termRef.current !== term) return;
      term.clearTextureAtlas();
      term.refresh(0, term.rows - 1);
    });
    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [open]);

  /**
   * A finger dragged over the terminal scrolls it, exactly as a wheel does.
   *
   * Nothing scrolled at all before, and the reason is a layer: xterm builds a
   * `.xterm-viewport` that really is a scrollable div and a `.xterm-screen`
   * that sits ON TOP of it, so a touch lands on the screen and the viewport
   * under it never hears about it. A wheel event is forwarded across that gap
   * by xterm itself. A touch is not.
   *
   * **So the drag is turned into wheel events rather than into scrolling**, and
   * that is the decision worth writing down. `term.scrollLines()` would have
   * been the obvious call and it would have done nothing here: Claude Code runs
   * in the ALTERNATE screen buffer (`buffer.active.type === 'alternate'`), which
   * by definition has no scrollback to move, and it turns full mouse reporting
   * on — so on a desktop the wheel is not scrolling anything either. It is
   * being SENT to the CLI, which scrolls its own transcript. One synthetic
   * wheel per row puts a phone on that same path, and whatever xterm decides to
   * do with it — report it, translate it to cursor keys in an alt buffer with
   * no mouse mode, or scroll a real scrollback — is decided in one place for
   * both kinds of pointer.
   *
   * `deltaMode: DOM_DELTA_LINE` and one event per row, because that is what
   * survives the translation: in pixel mode xterm damps anything under 50px to
   * 30% and carries the remainder, and a mouse report is one notch per event
   * however large the delta.
   *
   * The 8px slop keeps a TAP a tap — `preventDefault` on a touchmove suppresses
   * the compatibility mouse events after it, and those are what put the cursor
   * in the terminal.
   */
  useEffect(() => {
    if (!open || !mobile) return;
    const host = hostRef.current;
    if (!host) return;
    /** Wheel's own units: 0 is pixels, 1 is lines. */
    const DOM_DELTA_LINE = 1;
    /** A flick can cover the window; forwarding all of it would be a burst. */
    const MAX_ROWS_PER_MOVE = 8;
    /** Below this the gesture is still a tap being made slightly untidily. */
    const TAP_SLOP = 8;
    let lastY = 0;
    let carried = 0;
    let travelled = 0;
    let tracking = false;
    const rowHeight = (): number => {
      const term = termRef.current;
      if (!term || term.rows === 0) return 0;
      const screen = host.querySelector('.xterm-screen');
      const px = screen instanceof HTMLElement ? screen.clientHeight : host.clientHeight;
      return px / term.rows;
    };
    const onStart = (e: TouchEvent) => {
      tracking = e.touches.length === 1;
      if (!tracking) return;
      lastY = e.touches[0].clientY;
      carried = 0;
      travelled = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const row = rowHeight();
      if (row <= 0) return;
      const touch = e.touches[0];
      // Finger up means read further down, the way a page moves under a hand.
      const dy = lastY - touch.clientY;
      lastY = touch.clientY;
      travelled += Math.abs(dy);
      if (travelled < TAP_SLOP) return;
      e.preventDefault();
      carried += dy;
      const rows = Math.trunc(carried / row);
      if (rows === 0) return;
      carried -= rows * row;
      // On the screen, which is what a mouse would be over: with reporting on,
      // xterm turns the coordinates into the cell the CLI is told about.
      const target = host.querySelector('.xterm-screen') ?? host;
      const step = rows > 0 ? 1 : -1;
      for (let i = 0; i < Math.min(Math.abs(rows), MAX_ROWS_PER_MOVE); i++) {
        target.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: step,
            deltaMode: DOM_DELTA_LINE,
            clientX: touch.clientX,
            clientY: touch.clientY,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    };
    host.addEventListener('touchstart', onStart, { passive: true });
    host.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      host.removeEventListener('touchstart', onStart);
      host.removeEventListener('touchmove', onMove);
    };
  }, [open, mobile]);

  /**
   * One socket per open terminal, and it comes back by itself.
   *
   * It only ever attaches: starting is the POST, so a refusal is a sentence and
   * not a socket that closes again for reasons nobody can read. What it does do
   * on its own is RECONNECT — a line dropped by the network is indistinguishable
   * here from one dropped by a tab closing, and only one of the two means
   * anybody left ([attemptRef]).
   */
  useEffect(() => {
    if (!open) return;
    const term = termRef.current;
    if (!term) return;
    /**
     * An attach is the whole screen, so it starts from an empty one.
     *
     * The server opens every attach with its entire backlog, which is what a
     * fresh mount has always been given — this only makes a RECONNECT behave
     * like one, instead of appending a second copy of the last 256 KB under the
     * first. It is also what keeps two sessions apart in the same panel: the
     * xterm is built once for the life of the component, and `/session/:id` is
     * one route, so without this the next conversation's replay would land
     * under the last one's.
     */
    term.reset();
    const url = new URL(`/api/sessions/${sessionId}/terminal/ws`, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    /** The cleanup has run: this socket's closing is ours and asks for nothing. */
    let gone = false;
    let retry: number | undefined;

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
        // The status goes with it: "no terminal is open for this session" is
        // how a tab that was away finds out its terminal was closed while it
        // was — by the server's own sweep, or from another page — and without
        // this it would sit on a dead screen instead of offering to start one.
        if (message.t === 'error') {
          setError(message.message);
          void queryClient.invalidateQueries({ queryKey: ['terminal', sessionId] });
        } else if (message.t === 'exit') void queryClient.invalidateQueries({ queryKey: ['terminal', sessionId] });
        // Both frames carry the same fact, from the two moments it can arrive:
        // `ready` is what the terminal was already doing before this browser
        // attached, `keys` is it changing while we watch.
        else if (message.t === 'ready') enhancedKeysRef.current = message.enhancedKeys;
        else if (message.t === 'keys') enhancedKeysRef.current = message.enhanced;
      } catch {
        // A control frame we cannot read is a control frame we ignore.
      }
    };
    /**
     * Nothing is said about a dropped line until it has failed to come back.
     *
     * `onerror` used to put the red box up at once, and with a retry behind it
     * that reads as a fault where there was a hiccup — the panel is normally
     * back before anybody has read the sentence. So the error is the CLOSE
     * handler's to raise, and only once the second attempt has failed too.
     */
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      // Ours (the cleanup), or a refusal: 1008 is cross-origin or a session the
      // server does not know, and neither is going to be different in a second.
      if (gone || event.code === 1008) return;
      const wait = Math.min(10_000, 1_000 * 2 ** attemptRef.current);
      attemptRef.current += 1;
      if (attemptRef.current >= 2) setError('The connection to the terminal was lost — reconnecting…');
      retry = window.setTimeout(() => setReconnect((n) => n + 1), wait);
    };
    /**
     * The two moments a phone comes back, and neither can wait for the backoff:
     * the network returning, and the tab being looked at again. The server gives
     * an unattached terminal a minute when the session never became a
     * conversation, so a browser that dawdles is a terminal that is gone.
     */
    const nudge = (): void => {
      if (gone || document.visibilityState !== 'visible') return;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) return;
      window.clearTimeout(retry);
      attemptRef.current = 0;
      setReconnect((n) => n + 1);
    };
    window.addEventListener('online', nudge);
    document.addEventListener('visibilitychange', nudge);
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
      // The ref, never the state: a `setReconnect` here would re-run this very
      // effect and close the socket that has just come up.
      attemptRef.current = 0;
      setError(null);
      socket.send(JSON.stringify({ t: 'r', cols: term.cols, rows: term.rows }));
    };

    const input = term.onData((data) => {
      // Whatever the accessory bar is holding, applied to whatever comes next —
      // from the soft keyboard or from the bar itself ([applyMods]).
      let out = data;
      const armed = modsRef.current;
      if ((armed.ctrl || armed.alt || armed.shift) && isKeystroke(data)) {
        modsRef.current = NO_MODS;
        setMods(NO_MODS);
        out = applyMods(data, armed);
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'i', d: out }));
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
      gone = true;
      window.clearTimeout(retry);
      window.removeEventListener('online', nudge);
      document.removeEventListener('visibilitychange', nudge);
      input.dispose();
      resize.dispose();
      socket.close();
    };
  }, [open, sessionId, queryClient, reconnect]);

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
  /**
   * The text got bigger or smaller, which to the CLI is a smaller or bigger
   * CONSOLE: the panel is the same box, so the cells change size and the number
   * of them changes with it. `fit()` is what works that out, and the `onResize`
   * it provokes is what tells the pseudo-terminal — nothing new goes on the wire
   * for this feature.
   *
   * Guarded on the option itself so the mount is a no-op: the constructor above
   * already read the store, and re-setting `fontSize` to what it is would throw
   * away xterm's glyph atlas for nothing.
   *
   * The second `fit()` on the next frame is the belt to that braces. xterm
   * remeasures the cell when the option is set, but if it ever published that a
   * frame late the first `fit()` would have measured with the old cell and
   * NOTHING would come back for it: the host's box has not changed, so the
   * `ResizeObserver` below never fires. A wasted measurement is cheaper than a
   * panel that needs a drag to come right.
   */
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    refit();
    const frame = requestAnimationFrame(refit);
    return () => cancelAnimationFrame(frame);
  }, [fontSize, refit]);
  /**
   * A step up or down, and the keys go back to the CLI.
   *
   * The press itself moved the focus to the button — nothing collapses for that,
   * since the button is inside the root and that is what [collapseOnFocusOut]
   * asks about — but the next thing anybody does after making the text readable
   * is type into it, and a terminal you have to click back into first is one
   * that took the keyboard for a decoration.
   */
  const zoomBy = useCallback((dir: 1 | -1) => {
    stepTerminalFontSize(dir);
    termRef.current?.focus();
  }, []);
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
    // Full screen is what "open" means on a phone. 380px of panel inside a
    // 620px window, under a header and a chip strip, is about eight rows — and
    // a CLI that draws boxes cannot be read in eight. Set HERE rather than as
    // an initial state, so it lands on the tap that opened the panel: that is
    // what lets `useBackDismiss` push a history entry Android's Back will
    // honour, and what keeps the title bar's own ⤢/⤡ telling the truth.
    if (mobileRef.current) setFull(true);
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
   * focus to `body` — which puts the panel away mid-gesture, in the middle of
   * the very drag that was resizing it. (It also used to leave the focus
   * nowhere, so the next click outside had no `focusout` to fire and the panel
   * stayed open for good; the presses are watched directly now
   * ([collapseOnRelease]), so that half is answered twice over.)
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
   * The collapse itself, once whatever took the focus away has finished.
   *
   * `document.hasFocus()` is what tells a click on the conversation apart from
   * alt-tabbing away: leaving the BROWSER says nothing about this panel, and
   * coming back to find it collapsed would be an answer to a question nobody
   * asked. `body` counts as outside, because the commonest move of all — a click
   * on a paragraph — lands the focus exactly nowhere.
   */
  const collapseIfOutside = useCallback(() => {
    const root = rootRef.current;
    if (!root || !document.hasFocus()) return;
    const active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) return;
    setMinimised(true);
  }, []);
  /**
   * A press outside the panel whose meaning is not settled yet: it is a click if
   * it is let go of where it went down, and a selection if it is dragged
   * ([collapseOnRelease]). Cleared by the decision itself rather than by the
   * release, so the `focusout`'s own tick — always the earlier of the two, since
   * it is queued at the press — finds it still up and stands aside.
   */
  const pendingRelease = useRef(false);
  /**
   * What was highlighted when that press went down, so the release can be asked
   * whether the gesture selected anything or merely happened while something was.
   */
  const selectionAtPress = useRef('');

  /**
   * The focus leaving puts the panel away again, which is the other half of the
   * bar being the way in — and the whole reason nothing has to be remembered.
   *
   * Watched on the ROOT and not on the xterm: the title bar's buttons, the drag
   * handle and the close dialog are all in here, and taking the focus off the
   * terminal is not what any of them means.
   *
   * Deferred by a tick and then asked of `document.activeElement`
   * ([collapseIfOutside]), because `relatedTarget` is null for the commonest
   * move there is — a click on a paragraph of the conversation, which nothing
   * can focus.
   *
   * Full screen is exempt: there is one way out of it and it is its own button,
   * and a `fixed inset-0` panel with a hidden host is a blank window. So is a
   * panel somebody has pinned, which is the whole of what the pin does. And so
   * is a press that turns out to be a SELECTION rather than a click
   * ([collapseOnRelease]), which is the one exception the rule itself carries.
   */
  const collapseOnFocusOut = useCallback(() => {
    // Never on a phone: opening or closing the on-screen keyboard takes the
    // focus, and the panel would fold to its title bar under the user, mid
    // command. See the press rule below, which is exempt for the same reason.
    if (mobile) return;
    if (full || minimised || confirmClose || pinned) return;
    window.setTimeout(() => {
      // A button still held is a gesture still being made: what it meant is
      // known when it is let go of, and until then nothing may move.
      if (pendingRelease.current) return;
      collapseIfOutside();
    }, 0);
  }, [mobile, full, minimised, confirmClose, pinned, collapseIfOutside]);

  /**
   * Reading text out of the conversation is the exception to that rule, and the
   * press is not what says so — the RELEASE is.
   *
   * A press outside means "I am done with the terminal", and for a click that is
   * exactly what it means. A drag is the same press meaning the opposite: the
   * conversation is being read with the panel in plain sight, and what it used
   * to get was the panel folding to its bar on `mousedown`, under a held button,
   * halfway through the gesture — the sticky slot losing 350 px, the whole
   * conversation sliding down under a pointer that went on selecting, and the
   * highlighted text ending up somewhere below the words it was drawn across.
   *
   * So the decision waits for the button to come up, which is the first moment
   * the two can be told apart: a gesture that left NEW text highlighted holds
   * the panel open, and one that left none collapses it exactly as before. A
   * click still puts the terminal away; it just does it a gesture later.
   *
   * **New text, not merely text**, which is the difference between an exception
   * and a second pin. Whether anything is highlighted at all is the wrong
   * question: a selection made and let go of is still standing when the next
   * press lands somewhere that is not text — a button in the header does not
   * clear it — and a panel that read that as "still selecting" would never
   * close again. So the press remembers what was highlighted underneath it and
   * the release compares.
   *
   * **The press arms it, not the `focusout`**, which is what keeps the rule
   * alive after the exception has fired once. By then the focus is already on
   * `body`, so no further `focusout` is ever coming — the panel would sit open
   * until it had been clicked into and out of again. Watching
   * the presses themselves means every later one outside gets the same question
   * asked of it, and the click that follows the reading still folds the panel.
   *
   * Installed only while the panel is subject to the rule, so a pinned, full or
   * collapsed one arms nothing.
   */
  useEffect(() => {
    // Never on a phone, for the reason on `collapseOnFocusOut`. There the panel
    // is full screen with its own ✕ and Android's Back — two ways out that mean
    // it, rather than one the keyboard triggers by accident.
    if (mobile) return;
    if (full || minimised || confirmClose || pinned) return;
    const armRelease = (e: MouseEvent) => {
      // The LEFT button only, and only outside the panel: a press inside is the
      // terminal being used ([takeFocus]), and the other buttons are a menu and
      // a paste rather than a way out of anything.
      const target = e.target;
      const outside = e.button === 0 && target instanceof Node && rootRef.current?.contains(target) === false;
      pendingRelease.current = outside;
      // Read on the CAPTURE phase, so this is the selection as the press found
      // it: nothing has placed a caret or collapsed anything yet.
      selectionAtPress.current = outside ? selectionText() : '';
    };
    const collapseOnRelease = () => {
      if (!pendingRelease.current) return;
      // A tick, for the same reason the `focusout` needs one: what a release
      // did to the selection is the mouseup's DEFAULT ACTION, and that happens
      // after every handler it has. Measured — a click landing inside the words
      // just highlighted is held as a possible drag-and-drop and only collapsed
      // to a caret once this had already read it as "still selected", so the
      // panel stayed open for a click that meant the opposite.
      window.setTimeout(() => {
        pendingRelease.current = false;
        const selected = selectionText();
        if (selected && selected !== selectionAtPress.current) return;
        collapseIfOutside();
      }, 0);
    };
    document.addEventListener('mousedown', armRelease, true);
    // On the WINDOW, so a drag let go of over the browser's own chrome still
    // answers. One let go of outside the window is not heard at all, and the
    // panel simply stays open until the next press — the safe way round.
    window.addEventListener('mouseup', collapseOnRelease, true);
    return () => {
      document.removeEventListener('mousedown', armRelease, true);
      window.removeEventListener('mouseup', collapseOnRelease, true);
      pendingRelease.current = false;
    };
  }, [mobile, full, minimised, confirmClose, pinned, collapseIfOutside]);

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
      // And on a phone, filling the window. See `expand`.
      if (mobileRef.current) setFull(true);
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

  /**
   * The room this panel has to be tall IN: the scroller it is stuck to the
   * bottom of, or the window if it is not in one. That is the only ceiling the
   * height has — [terminalPrefs] holds why it is a measurement rather than a
   * number — and it is measured on demand rather than kept, because it changes
   * with the window alone and both callers ask at a moment they can measure at.
   */
  const roomFor = useCallback((root: HTMLElement | null): number => {
    const scroller = root?.closest('[data-conversation-scroller]');
    return scroller instanceof HTMLElement ? scroller.clientHeight : window.innerHeight;
  }, []);

  // Dragging the TOP edge, because the bottom one is the window. Same shape as
  // the session list's sidebar handle, turned on its side — and on the same
  // POINTER events, so the one drag in this panel is reachable with a finger.
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const grip = e.currentTarget as HTMLElement;
      const id = e.pointerId;
      const startY = e.clientY;
      // Once, here: nobody resizes the window in the middle of a drag, and a
      // ceiling that moved under the pointer would make the panel fight it.
      const room = roomFor(rootRef.current);
      const from = clamp(readHeight(), room);
      try {
        grip.setPointerCapture(id);
      } catch {
        // The pointer has already gone; the listeners below still tidy up.
      }
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        const next = clamp(from + startY - ev.clientY, room);
        setHeight(next);
        localStorage.setItem(HEIGHT_KEY, String(next));
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    },
    [roomFor],
  );

  /**
   * One measurement, three answers, because all of them are about where this
   * panel ends.
   *
   * The height comes first because it is the one that can go wrong on its own:
   * the stored number was dragged to in whatever window it was dragged in, and a
   * panel taller than the scroller loses its own title bar off the top. So it is
   * re-clamped against the room there is now, every time that room changes —
   * from `readHeight()` rather than from the state, so the number that was
   * dragged to survives a small window and comes back with a tall one. Only the
   * drag writes `localStorage`; being squeezed by a window is not a preference.
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
      setHeight(clamp(readHeight(), roomFor(root)));
      const rootBox = root.getBoundingClientRect();
      if (!(scroller instanceof HTMLElement)) {
        setBleed(null);
        onLayout?.({ full: fullNow, open, height: root.offsetHeight, rightGap: 0 });
        return;
      }
      const scrollerBox = scroller.getBoundingClientRect();
      setBleed(
        open && !fullNow
          ? {
              width: scroller.clientWidth,
              marginLeft: Math.round(scrollerBox.left + scroller.clientLeft - rootBox.left),
            }
          : null,
      );
      onLayout?.({
        full: fullNow,
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
  }, [open, fullNow, onLayout, roomFor]);

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
    // **On a phone there are only two states: filling the window, or a title
    // bar.** An inline panel there is eight rows under a header and a chip
    // strip, which is not a terminal you can work in — so the way out of full
    // screen is the way back to the bar, and the way out of the terminal is the
    // × on that bar. The desktop keeps its third state and its own rule: full
    // screen puts back whatever opening it interrupted.
    if (mobileRef.current) {
      collapsedBeforeFull.current = false;
      setMinimised(true);
      return;
    }
    if (!collapsedBeforeFull.current) return;
    collapsedBeforeFull.current = false;
    setMinimised(true);
  }, []);
  // What Android's Back calls. See the registration far above.
  leaveFullRef.current = leaveFull;

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
        // **Never wrapped**, and that is the fix rather than the preference:
        // with `flex-wrap` on, a long cwd does not fit after the `❯` at its
        // full content width, so it is placed on the NEXT line and shrunk
        // there — leaving a first row holding one glyph and nothing else. It
        // truncates on one line instead, which is what the ellipsis was for.
        className={`flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-dim)] max-md:py-1.5 ${
          minimised ? 'cursor-pointer hover:text-[var(--text)]' : ''
        }`}
        title={minimised ? 'Click to open the terminal' : undefined}
      >
        <span className="shrink-0 text-[var(--accent)]">❯</span>
        <span className="shrink-0">
          {running ? 'claude' : exit ? `claude exited (code ${exit.code ?? 'killed'})` : 'claude'}
        </span>
        {/* The folder, with its middle taken out and — if it STILL does not fit
            — its front. Which end survives is the whole point: every session
            started from the app lives six segments down the same temp folder,
            so the first half of the path is the half that says nothing. */}
        {cwd && (
          <span className="truncate-start min-w-0 flex-1 truncate opacity-80" title={cwd}>
            {elidePath(cwd)}
          </span>
        )}
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
          {/* The text size — two buttons, and the number lives in the tooltip.
              A reading on the bar would be a third control on a row that is
              right-aligned, so every press would slide the buttons beside it
              out from under the pointer doing the pressing.

              On an OPEN panel, full screen INCLUDED, which is where it differs
              from the pin: a title bar has no text to size, and a terminal
              filling the window is the one most worth sizing. The pin is absent
              there because it answers a focus rule full screen is not subject
              to; this answers nothing but the eyes.

              And it is not this panel's setting: it is every terminal's
              ([terminalPrefs]), which is why the button holds no state of its
              own and the tooltip says so.

              The tooltip carries the default beside the size, because there is
              no Reset here and a bare number cannot tell you how far from
              ordinary you have got — 8 px means nothing until you know it
              started at 12. Two presses back is the reset, and knowing which
              way is all it takes. */}
          {!minimised && (
            <>
              <button
                type="button"
                onClick={() => zoomBy(-1)}
                disabled={fontSize <= TERMINAL_FONT_MIN}
                title={`Smaller text, in every terminal (now ${String(fontSize)} px, default ${String(TERMINAL_FONT_DEFAULT)})`}
                className="rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
              >
                A−
              </button>
              <button
                type="button"
                onClick={() => zoomBy(1)}
                disabled={fontSize >= TERMINAL_FONT_MAX}
                title={`Bigger text, in every terminal (now ${String(fontSize)} px, default ${String(TERMINAL_FONT_DEFAULT)})`}
                className="rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
              >
                A+
              </button>
            </>
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
            // It never says "close": one word for two different things is how a
            // button that gives the conversation back gets read as the one that
            // ends a CLI mid-turn. On a phone it says *minimise*, because that
            // is what it now does — there is no inline state to return to.
            title={
              full
                ? mobile
                  ? 'Put it away — the terminal keeps running, and × is what closes it'
                  : 'Leave full screen — the terminal is not closed'
                : 'Fill the window'
            }
            className={`rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${
              // Redundant on a phone while it is a bar: the bar IS the way in.
              !full && mobile ? 'hidden' : ''
            }`}
          >
            {full ? (mobile ? '▾ minimise' : '⤡ exit full screen') : '⤢ full screen'}
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
      {/* Inside the panel, so it comes full screen with it and sits directly on
          the on-screen keyboard rather than behind it. */}
      {mobile && !minimised && !pasting && (
        <TerminalKeys
          onKey={(data) => termRef.current?.input(data)}
          mods={mods}
          onMod={armMod}
          onPaste={() => setPasting(true)}
        />
      )}
      {mobile && !minimised && pasting && (
        <PasteBox
          onCancel={() => setPasting(false)}
          onSend={(text) => {
            setPasting(false);
            // Through `input()` like every other key, so it takes the same path
            // up the socket. Not through xterm's `paste()`, which would wrap it
            // in bracketed-paste markers a second time.
            termRef.current?.input(text);
            termRef.current?.focus();
          }}
        />
      )}
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
              className="group relative -mb-1 h-2 cursor-row-resize touch-none max-md:h-4"
              style={bleed ? { width: bleed.width, marginLeft: bleed.marginLeft } : undefined}
              onPointerDown={startResize}
              title="Drag to resize"
            >
              <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded transition-colors group-hover:bg-[var(--accent-dim)]" />
            </div>
          )}
          {fullNow && (
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
              fullNow
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
              ? `max(0.75rem, calc(${String(PILL_CORNER_PX)}px - var(--conv-box, 100vw) / 2 + ${columnWidth} / 2))`
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
