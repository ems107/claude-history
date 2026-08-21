import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { IPty } from '@lydell/node-pty';
import type { AppSettings, TerminalExit, TerminalStatus } from '@claude-history/shared';
import {
  activeSessionLimitMessage,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
} from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { cleanEnv, findClaudeCli } from '../util/launcher.ts';
import type { SessionIndex } from './index.ts';
import { pidAlive } from './live.ts';
import { createLogger } from './logger.ts';
import type { SessionChatService } from './sessionChat.ts';
import {
  appHolderOf,
  atActiveSessionLimit,
  pidOwnedByApp,
  registerWriter,
  type TranscriptWriter,
  type WriterSession,
} from './writerGuard.ts';

const log = createLogger('terminal');

/**
 * How much output is kept per terminal so a reconnecting browser can be shown
 * what it missed.
 *
 * A cap in BYTES, trimmed whole chunks at a time from the front. Trimming can
 * cut an escape sequence in half, which is what the repaint nudge in `attach`
 * is for — and why this is a record of what happened rather than a claim to be
 * a faithful screen.
 */
const SCROLLBACK_BYTES = 256 * 1024;

/**
 * A CLI that dies sooner than this never really started, whatever it says on
 * the way out — so its last screen is kept even on a zero exit. Long enough to
 * cover a spawn that fails after printing something, short enough that nobody
 * typing `/exit` lands inside it.
 */
const STARTUP_GRACE_MS = 3_000;

/**
 * Sent before a replay: leave the alternate screen, stop mouse reporting, show
 * the cursor, drop any colour still in force. A truncated backlog can begin
 * inside the sequence that switched one of those on, and then never contain the
 * one that switches it off.
 */
const RESET_BEFORE_REPLAY =
  '\u001b[?1049l\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006l\u001b[?25h\u001b[0m';

/**
 * The sequences by which the program inside says whether it wants to hear about
 * modifiers — the one fact that decides whether Shift+Enter can be sent as a key
 * of its own instead of the bare CR every terminal sends for Enter.
 *
 * Two protocols, because two are in use: `CSI > <flags> u` / `CSI < u` push and
 * pop the **kitty keyboard protocol**, and `CSI ? 9001 h` / `l` turn
 * **win32-input-mode** on and off. Claude Code used to push the first and now
 * asks for the second — measured on v2.1.238: `?9001h`, `?1004h`, `?2004h`,
 * `?2031h`, and no kitty push anywhere in the stream. That is how a fix verified
 * once came to fail again with nothing in this repo having changed.
 *
 * Read HERE rather than in the browser, and that is the point: the sequence is
 * sent once, at startup, and the scrollback a reconnecting browser is replayed
 * is bounded — so on a terminal that has been up for a while it has been trimmed
 * away, and a client that learns this from the stream alone is right only until
 * the first reload. The server sees every byte, so it is the only place that can
 * still answer afterwards.
 */
const KEY_MODE_RE = /\u001b\[(?:([<>])[0-9;]*u|\?([0-9;]*)([hl]))/g;

/**
 * How much of a chunk's tail is carried into the next scan. PTY output arrives
 * in arbitrary pieces, and one of them can end halfway through
 * `ESC [ ? 1000;1002;1003;1006;2004;9001 h`.
 */
const MODE_SCAN_TAIL = 64;

/**
 * The modes a newly attached browser is TOLD, because the backlog cannot be
 * trusted to carry them.
 *
 * Each of these is a session-level statement the program makes once, at
 * startup, and every one of them is a visible feature when it survives and a
 * bug report when it does not: **1049** the alternate screen (without it the
 * CLI's repaint lands on top of the replayed text — two status lines, a screen
 * that reads as corrupt), **2004** bracketed paste (without it a paste arrives
 * as typing, so every newline in it submits and only the last fragment is left
 * in the box, with no `[Pasted text]`), **1000/1002/1003/1006** mouse reporting
 * (without it a click never reaches the CLI, so it cannot move the cursor),
 * **1004** focus reporting and **25** the cursor itself. Measured, all four
 * symptoms at once, by shrinking `SCROLLBACK_BYTES` and reattaching.
 *
 * An ALLOW-LIST rather than everything the scanner saw, because a mode is not
 * always a state worth restating: `?2026` (synchronized output) is a frame
 * marker, and a chunk that ends between its `h` and its `l` would have us
 * assert "hold the screen" for ever — a blank panel, arrived at by trying to
 * be faithful. 1049 goes LAST: it decides which buffer everything else lands
 * in.
 */
const REASSERTED_MODES = [25, 1000, 1002, 1003, 1004, 1006, 2004, 1049];

interface TerminalProcess {
  sessionId: string;
  cwd: string;
  /** Null once the CLI has exited. The entry itself stays: its screen is the diagnosis. */
  pty: IPty | null;
  /** Bounded ring of raw UTF-8 output, oldest first. */
  buffer: Buffer[];
  bufferBytes: number;
  startedAt: Date;
  exit: TerminalExit | null;
  cols: number;
  rows: number;
  clients: Set<TerminalClient>;
  /** The program inside has asked to be told about modifiers ([KEY_MODE_RE]). */
  enhancedKeys: boolean;
  /**
   * Every DEC private mode the program has set or reset, latest value winning.
   *
   * The state of the terminal as the program believes it to be, which is the
   * one thing a bounded backlog cannot carry ([REASSERTED_MODES]).
   */
  modes: Map<number, boolean>;
  /** The tail of the last chunk, so a mode sequence split across two survives. */
  modeTail: string;
}

/** What the route hands us: one browser attached to one terminal. */
export interface TerminalClient {
  /** Raw PTY output, as a binary frame. */
  sendBytes(data: Buffer): void;
  /** A control message, as JSON text. */
  sendJson(message: unknown): void;
}

/**
 * The embedded terminals: one `claude.exe` per session, inside a Windows
 * pseudo-console, with no shell around it.
 *
 * **No shell is load-bearing.** The pid of the PTY's direct child is the one
 * Claude Code registers in `~/.claude/sessions/<pid>.json`, so the two-writers
 * guard keeps working unchanged; with a shell in between, the pid we know would
 * be the shell's and Claude's would be a grandchild we would have to go looking
 * for — and a guard that gets that wrong blocks the app against itself. It also
 * keeps a signed-in remote browser exactly as powerful as the composer already
 * makes it, and no more.
 */
export class SessionTerminalService implements TranscriptWriter {
  readonly what = 'the embedded terminal';
  readonly kind = 'terminal' as const;
  readonly events = new EventEmitter();

  private readonly procs = new Map<string, TerminalProcess>();

  /**
   * The native module, or why it could not be loaded.
   *
   * Imported dynamically and caught: a prebuilt binary that does not load is a
   * broken feature, not a server that will not start, and the reason has to
   * reach the button — `blockedReason` is the only place anyone finds out.
   */
  private pty: typeof import('@lydell/node-pty') | null = null;
  private ptyError: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly index: SessionIndex,
    private readonly chat: SessionChatService,
    private readonly settings: () => AppSettings,
  ) {
    // One listener per SSE client, same as the index's and the chat's emitters.
    this.events.setMaxListeners(100);
    registerWriter(this);
  }

  /** Loads the native module. Failure is recorded, never thrown. */
  async start(): Promise<void> {
    try {
      this.pty = await import('@lydell/node-pty');
      log.info('node-pty loaded');
    } catch (err) {
      this.ptyError = err instanceof Error ? err.message : String(err);
      log.error('node-pty could not be loaded — the embedded terminal is unavailable', err);
    }
  }

  // ---- TranscriptWriter ----

  holds(sessionId: string): boolean {
    return this.running(sessionId);
  }

  /**
   * Read from the live getter every time, never from a snapshot: ConPTY reports
   * the child's pid on `ready_datapipe`, about 100 ms after the spawn returns,
   * and until then `pty.pid` is 0.
   */
  ownsPid(pid: number): boolean {
    for (const p of this.procs.values()) if (p.pty && p.pty.pid === pid) return true;
    return false;
  }

  // ---- public API ----

  /** Is the CLI inside this session's terminal still alive? */
  running(sessionId: string): boolean {
    const p = this.procs.get(sessionId);
    return !!p && p.pty !== null && p.exit === null;
  }

  /**
   * Why a terminal cannot be started, in the words the start bar shows. One
   * string for the endpoint and the button both, exactly like the composer's
   * `sendBlockedReason`.
   */
  blockedReason(sessionId: string): string | null {
    const s = this.settings();
    if (!s.chatEnabled) return 'Sending from the app is turned off in Settings.';
    if (s.chatMode !== 'terminal') return 'The app is set to use the composer instead of a terminal.';
    if (!this.pty) {
      return `The terminal backend could not be loaded: ${this.ptyError ?? 'unknown error'}`;
    }
    // The index first and a reservation second, like the composer: a session
    // being born has no summary to read a folder off.
    const cwd = this.chat.cwdOf(sessionId);
    if (!cwd) return 'This session is not in the index.';
    if (!findClaudeCli()) return 'The Claude Code CLI could not be found.';
    if (!fs.existsSync(cwd)) return `The project folder no longer exists: ${cwd}`;
    // Another part of this app already holding it — the composer, today.
    const holder = appHolderOf(sessionId, this);
    if (holder) {
      return `This session is already open in ${holder}. Close it if you want to continue here.`;
    }
    // A real terminal elsewhere. Our own pids are excluded (they register in
    // ~/.claude/sessions like any other CLI), and `pidAlive` is re-checked
    // rather than trusted from the list, which is only rebuilt when something
    // writes to that directory — a CLI killed outright writes nothing on the
    // way out, so its entry would block us forever.
    if (this.index.liveSessions.some((l) => l.sessionId === sessionId && !pidOwnedByApp(l.pid) && pidAlive(l.pid))) {
      return 'This session is already open in a terminal. Close it if you want to continue here.';
    }
    // One cap for both doors: a composer process elsewhere in the app fills one
    // of these slots too, because what it costs is the same machine.
    if (atActiveSessionLimit(sessionId, s.maxActiveSessions)) {
      return activeSessionLimitMessage(s.maxActiveSessions);
    }
    return null;
  }

  status(sessionId: string): TerminalStatus {
    const p = this.procs.get(sessionId);
    return {
      sessionId,
      open: !!p,
      running: this.running(sessionId),
      pid: p?.pty && p.exit === null && p.pty.pid > 0 ? p.pty.pid : null,
      startedAt: p ? localIso(p.startedAt) : null,
      exit: p?.exit ?? null,
      cwd: p?.cwd ?? this.chat.cwdOf(sessionId),
      blockedReason: this.blockedReason(sessionId),
    };
  }

  /**
   * Spawns `claude` inside a pseudo-terminal. Throws the blocked reason, so the
   * route can answer 409 with the same sentence the button would have shown.
   */
  open(sessionId: string, cols: number, rows: number): void {
    const blocked = this.blockedReason(sessionId);
    if (blocked) throw new Error(blocked);
    if (this.running(sessionId)) return; // already up; the socket just attaches
    const pty = this.pty;
    const cli = findClaudeCli();
    const cwd = this.chat.cwdOf(sessionId);
    if (!pty || !cli || !cwd) throw new Error('The Claude Code CLI could not be found.');

    // A terminal holding a dead process's last screen is replaced, not reused.
    this.procs.delete(sessionId);

    // Nothing to resume means the session is being born, and the id goes TO the
    // CLI instead of coming back from it — the same question the composer asks,
    // asked of the disk for the same reason: Claude Code writes no transcript
    // when the process starts, only when the first turn does.
    const fresh = this.index.get(sessionId) === undefined && !this.transcriptExists(sessionId);
    const args = fresh ? ['--session-id', sessionId] : ['--resume', sessionId];

    const c = clamp(cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS);
    const r = clamp(rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS);
    const spawnOptions = {
      name: 'xterm-256color',
      cols: c,
      rows: r,
      cwd,
      env: terminalEnv(),
    };
    /**
     * **The pseudo-console is PINNED, like the Node runtime a release carries.**
     *
     * `useConptyDll` makes node-pty load the `conpty.dll` + `OpenConsole.exe`
     * that ship inside the package instead of asking Windows for its own — and
     * Windows' own is a component that has changed for years and is different on
     * every build. Measured, same app and same CLI on two machines: on Windows
     * 11 26100 the CLI's declarations all arrive, and on Windows 10 19045 the
     * alternate screen, mouse reporting and win32-input-mode never appear at all
     * while `ESC[?25l` comes out as `ESC[25l` — and on the way IN, the kitty
     * encoding for Shift+Enter and the brackets around a paste are eaten, so
     * Shift+Enter sent the prompt and a multi-line paste submitted every line
     * but the last. Four bug reports, one component, and nothing in this app
     * could have corrected for it.
     *
     * A real console window is not affected because there is no pseudo-console
     * in that path at all, and Windows Terminal ships this very OpenConsole
     * rather than using the system's — which is the whole reason it is safe to
     * pin: it is what a terminal on Windows already runs.
     *
     * The fallback covers a host that cannot be LOADED (a stripped copy, a
     * blocked file): better this machine's ConPTY than no terminal. It cannot
     * cover one that loads and then misbehaves, and the log line is there to say
     * which one answered. See [AI_RUNNING_CLAUDE.md].
     */
    let child: IPty;
    let host = 'the bundled pseudo-console';
    try {
      child = pty.spawn(cli, args, { ...spawnOptions, useConptyDll: true });
    } catch (err) {
      host = 'the pseudo-console this Windows provides';
      log.warn(`the bundled pseudo-console could not be used for ${sessionId} — falling back`, err);
      child = pty.spawn(cli, args, spawnOptions);
    }

    const p: TerminalProcess = {
      sessionId,
      cwd,
      pty: child,
      buffer: [],
      bufferBytes: 0,
      startedAt: new Date(),
      exit: null,
      cols: c,
      rows: r,
      clients: new Set(),
      enhancedKeys: false,
      modes: new Map(),
      modeTail: '',
    };
    this.procs.set(sessionId, p);

    child.onData((data) => {
      const bytes = Buffer.from(data, 'utf8');
      this.append(p, bytes);
      const before = p.enhancedKeys;
      this.scanModes(p, data);
      for (const client of p.clients) client.sendBytes(bytes);
      // Rare enough to be an event rather than a field on the status: the CLI
      // asks once, at startup, and gives it up on the way out.
      if (p.enhancedKeys !== before) {
        log.info(`terminal for ${sessionId}: modifier-aware keys ${p.enhancedKeys ? 'on' : 'off'}`);
        for (const client of p.clients) client.sendJson({ t: 'keys', enhanced: p.enhancedKeys });
      }
    });

    child.onExit(({ exitCode }) => {
      p.exit = { code: exitCode ?? null, at: localIso(new Date()) };
      p.pty = null;
      /**
       * Whether the terminal outlives the process inside it, and the two
       * answers are both wanted.
       *
       * A CLI that failed to start has its last screen as the only diagnosis
       * there is, and clearing it would turn a readable error into a flash of
       * something — so a bad exit, or one that came too soon to be a real
       * session, keeps the panel with its exit code on the header.
       *
       * Somebody typing `/exit`, though, has said they are done, and leaving a
       * dead panel for them to dismiss by hand is one click that means nothing.
       * A clean exit from a session that actually ran takes the terminal with
       * it and the start bar comes back.
       */
      const lived = Date.now() - p.startedAt.getTime();
      const finished = exitCode === 0 && lived >= STARTUP_GRACE_MS;
      log.info(
        `terminal for ${sessionId} exited (code ${String(exitCode)}) after ${String(Math.round(lived / 1000))}s — ` +
          (finished ? 'closing it' : 'keeping the screen'),
      );
      for (const client of p.clients) client.sendJson({ t: 'exit', code: exitCode ?? null });
      if (finished) this.procs.delete(sessionId);
      this.events.emit('terminal-changed', sessionId);
      // The LIVE badge is driven by ~/.claude/sessions, and a CLI on its way out
      // has just removed its file — give the directory a moment, then re-read.
      setTimeout(() => void this.index.refreshLive(), 300);
    });

    log.info(`terminal started for ${sessionId} (${fresh ? '--session-id' : '--resume'}) in ${cwd} via ${host}`);
    this.events.emit('terminal-changed', sessionId);
  }

  /**
   * Attaches a browser: replays what it missed, then follows. Returns the
   * detach.
   *
   * The replay is raw bytes and can begin mid-escape-sequence, so a live CLI is
   * given a one-column resize nudge afterwards. A full-screen TUI redraws itself
   * on a resize, which repairs anything the truncated backlog left crooked —
   * cheaper, and more reliable, than keeping a rendered screen server-side.
   */
  attach(sessionId: string, client: TerminalClient): () => void {
    const p = this.procs.get(sessionId);
    if (!p) {
      client.sendJson({ t: 'error', message: 'No terminal is open for this session.' });
      return () => {};
    }
    p.clients.add(client);
    if (p.bufferBytes > 0) {
      client.sendBytes(Buffer.concat([Buffer.from(RESET_BEFORE_REPLAY, 'utf8'), ...p.buffer]));
    }
    /**
     * The modes, AFTER the replay and before the nudge — so the last word on
     * the state of this terminal is the truth rather than whatever the backlog
     * happened to still contain.
     *
     * Only for a live CLI: a panel keeping a dead process's last screen has
     * nothing left to repaint, and putting it into the alternate screen would
     * replace that screen — the diagnosis — with an empty one.
     */
    if (p.pty && p.exit === null) {
      const assertion = REASSERTED_MODES.filter((mode) => p.modes.has(mode))
        .map((mode) => `\u001b[?${String(mode)}${p.modes.get(mode) === true ? 'h' : 'l'}`)
        .join('');
      if (assertion) client.sendBytes(Buffer.from(assertion, 'utf8'));
    }
    client.sendJson({
      t: 'ready',
      pid: p.pty && p.pty.pid > 0 ? p.pty.pid : null,
      running: p.pty !== null && p.exit === null,
      // The one thing the replay cannot carry: the sequence that asks for it is
      // sent once, at startup, and this backlog is bounded ([KEY_MODE_RE]).
      enhancedKeys: p.enhancedKeys,
    });
    if (p.pty && p.exit === null) {
      const { cols, rows } = p;
      try {
        p.pty.resize(Math.max(TERMINAL_MIN_COLS, cols - 1), rows);
        p.pty.resize(cols, rows);
      } catch {
        // A process that died between the check and here — onExit will say so.
      }
    }
    return () => p.clients.delete(client);
  }

  write(sessionId: string, data: string): void {
    const p = this.procs.get(sessionId);
    if (p?.pty && p.exit === null) p.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const p = this.procs.get(sessionId);
    if (!p) return;
    p.cols = clamp(cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS);
    p.rows = clamp(rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS);
    if (p.pty && p.exit === null) {
      try {
        p.pty.resize(p.cols, p.rows);
      } catch {
        // Same as above: the exit handler is the authority on a dead process.
      }
    }
  }

  /** Kills the CLI if it is alive and forgets the terminal, screen and all. */
  close(sessionId: string): void {
    const p = this.procs.get(sessionId);
    if (!p) return;
    this.procs.delete(sessionId);
    this.killPty(p, 'closed by the user');
    for (const client of p.clients) client.sendJson({ t: 'exit', code: null });
    p.clients.clear();
    this.events.emit('terminal-changed', sessionId);
    setTimeout(() => void this.index.refreshLive(), 300);
  }

  /**
   * Is a terminal in the middle of something a restart would destroy?
   *
   * An OPEN terminal is not enough — with no idle timeout one can sit there for
   * days, and blocking every update behind it would quietly stop the app being
   * maintainable. What counts is the CLI actually working, which
   * `~/.claude/sessions` already reports for an interactive session.
   */
  get busy(): boolean {
    return this.activeSessions().some((s) => s.busy);
  }

  /**
   * `TranscriptWriter`: every terminal with a live CLI in it.
   *
   * An OPEN terminal whose CLI has exited is left out — it is a screen kept for
   * the diagnosis, it writes nothing and it costs nothing. `busy` comes from
   * `~/.claude/sessions`, the same reading `busy` above is built on, because an
   * interactive CLI is the one thing that reports its own state there.
   */
  activeSessions(): WriterSession[] {
    const out: WriterSession[] = [];
    for (const [sessionId, p] of this.procs) {
      if (!p.pty || p.exit !== null) continue;
      const live = this.index.liveSessions.find((l) => l.sessionId === sessionId && pidAlive(l.pid));
      out.push({ sessionId, busy: live?.status === 'busy', startedAt: localIso(p.startedAt) });
    }
    return out;
  }

  shutdown(): void {
    for (const [sessionId, p] of this.procs) {
      this.killPty(p, 'server shutting down');
      this.procs.delete(sessionId);
    }
  }

  // ---- internals ----

  /**
   * Follows the program's own modes through the output stream: what it has
   * switched on, and therefore what a browser attaching later has to be told
   * ([REASSERTED_MODES]) as well as whether Shift+Enter is a key of its own
   * ([KEY_MODE_RE]).
   *
   * In stream order, because these are sets and resets: the last one wins, and
   * reading them in any other order would answer with a mode that has already
   * been given up. The tail carried over is what survives a chunk boundary, and
   * it never contains a sequence that has already been counted — it begins at
   * the end of the last complete match, or at the last `MODE_SCAN_TAIL` bytes,
   * whichever is later.
   */
  private scanModes(p: TerminalProcess, chunk: string): void {
    const s = p.modeTail + chunk;
    let end = 0;
    KEY_MODE_RE.lastIndex = 0;
    for (let m = KEY_MODE_RE.exec(s); m; m = KEY_MODE_RE.exec(s)) {
      end = m.index + m[0].length;
      // `CSI > flags u` pushes the kitty protocol, `CSI < u` pops it.
      if (m[1]) {
        p.enhancedKeys = m[1] === '>';
        continue;
      }
      if (m[2] === undefined) continue;
      // One parameter at a time, because modes arrive several at a time
      // (`CSI ? 1000;1002;9001 h`) and each is its own switch. 9001 is
      // win32-input-mode, which is what Claude Code asks for today.
      const on = m[3] === 'h';
      for (const param of m[2].split(';')) {
        if (!param) continue;
        const mode = Number(param);
        if (!Number.isInteger(mode)) continue;
        p.modes.set(mode, on);
        if (mode === 9001) p.enhancedKeys = on;
      }
    }
    p.modeTail = s.slice(Math.max(end, s.length - MODE_SCAN_TAIL));
  }

  private append(p: TerminalProcess, bytes: Buffer): void {
    p.buffer.push(bytes);
    p.bufferBytes += bytes.length;
    while (p.bufferBytes > SCROLLBACK_BYTES && p.buffer.length > 1) {
      const dropped = p.buffer.shift();
      p.bufferBytes -= dropped ? dropped.length : 0;
    }
  }

  private killPty(p: TerminalProcess, why: string): void {
    const child = p.pty;
    if (!child) return;
    p.pty = null;
    const pid = child.pid;
    log.info(`killing terminal for ${p.sessionId} (${why})`);
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    // `claude` spawns children, and closing the pseudo-console does not
    // reliably take them down with it.
    if (pid > 0) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  }

  /** Same question, same answer, as `sessionChat.transcriptExists`. */
  private transcriptExists(sessionId: string): boolean {
    try {
      return fs
        .readdirSync(this.config.projectsDir)
        .some((dir) => fs.existsSync(path.join(this.config.projectsDir, dir, `${sessionId}.jsonl`)));
    } catch {
      return false; // no ~/.claude/projects at all
    }
  }
}

/**
 * The environment for a CLI whose display we drew ourselves.
 *
 * `cleanEnv()` first, for the reason every spawn here uses it: inheriting our
 * own `CLAUDE_CODE_*` markers makes the child treat itself as a nested session
 * and stop persisting its transcript. Then three lines that exist only for a
 * terminal, because only a terminal has a screen to be wrong about.
 *
 * **`NO_COLOR` has to go, and it is not hypothetical.** It is not persisted
 * anywhere on this machine — Claude Code injects it into the environment of the
 * subprocesses it runs, so a dev server started from inside a Claude Code
 * session inherits it, passes it on, and the embedded terminal comes up
 * monochrome: measured, ONE SGR sequence against 62 for the same CLI spawned by
 * hand. The variable is a statement about the device that launched us, and the
 * device the CLI is drawing on is this one — an xterm.js panel that renders
 * 24-bit colour and was built to. Same shape as the `CLAUDE_CODE_*` strip:
 * an inherited fact about somebody else's terminal, corrected on the way in.
 *
 * `TERM` and `COLORTERM` are the other half of that sentence. node-pty on
 * Windows takes a `name` and stores it on the terminal object, but **never puts
 * it in the child's environment** (`windowsTerminal.js` reads it and keeps it),
 * so without this the CLI is told nothing at all about what it is talking to.
 */
function terminalEnv(): Record<string, string> {
  const env = { ...(cleanEnv() as Record<string, string>) };
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  delete env.NO_COLOR;
  return env;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Local ISO-8601 with offset — the shape every other date crossing this API uses. */
function localIso(d: Date): string {
  const pad = (n: number): string => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}
