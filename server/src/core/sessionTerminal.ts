import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { IPty } from '@lydell/node-pty';
import type { AppSettings, TerminalExit, TerminalStatus } from '@claude-history/shared';
import {
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
import { appHolderOf, pidOwnedByApp, registerWriter, type TranscriptWriter } from './writerGuard.ts';

const log = createLogger('terminal');

/**
 * Pseudo-terminals with a LIVE CLI at once. Same reasoning as the composer's
 * MAX_CHAT_SESSIONS: each holds a `claude` with its MCP servers loaded, so this
 * is about the machine and not about correctness. A terminal whose CLI has
 * exited holds no slot — it is a screen, not a process.
 */
const MAX_TERMINALS = 3;

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
 * Sent before a replay: leave the alternate screen, stop mouse reporting, show
 * the cursor, drop any colour still in force. A truncated backlog can begin
 * inside the sequence that switched one of those on, and then never contain the
 * one that switches it off.
 */
const RESET_BEFORE_REPLAY =
  '\u001b[?1049l\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006l\u001b[?25h\u001b[0m';

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
      return `The app is already running Claude in this session through ${holder} — stop it there first, or two writers would corrupt its transcript.`;
    }
    // A real terminal elsewhere. Our own pids are excluded (they register in
    // ~/.claude/sessions like any other CLI), and `pidAlive` is re-checked
    // rather than trusted from the list, which is only rebuilt when something
    // writes to that directory — a CLI killed outright writes nothing on the
    // way out, so its entry would block us forever.
    if (this.index.liveSessions.some((l) => l.sessionId === sessionId && !pidOwnedByApp(l.pid) && pidAlive(l.pid))) {
      return 'This session is open in a terminal — two writers would corrupt its transcript.';
    }
    if (!this.running(sessionId) && this.liveCount() >= MAX_TERMINALS) {
      return `Too many terminals are already running (${MAX_TERMINALS}).`;
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
    const child = pty.spawn(cli, args, {
      name: 'xterm-256color',
      cols: c,
      rows: r,
      cwd,
      // Inheriting our own CLAUDE_CODE_* markers makes the child treat itself as
      // a nested session and stop persisting its transcript — the same trap the
      // composer and the auto-reload both step around.
      env: cleanEnv() as Record<string, string>,
    });

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
    };
    this.procs.set(sessionId, p);

    child.onData((data) => {
      const bytes = Buffer.from(data, 'utf8');
      this.append(p, bytes);
      for (const client of p.clients) client.sendBytes(bytes);
    });

    child.onExit(({ exitCode }) => {
      // The process is gone; the terminal is NOT. Its last screen is the only
      // diagnosis there is for a CLI that failed to start, and dropping it here
      // is what would turn that into a flash of something unreadable.
      p.exit = { code: exitCode ?? null, at: localIso(new Date()) };
      p.pty = null;
      log.info(`terminal for ${sessionId} exited (code ${String(exitCode)})`);
      for (const client of p.clients) client.sendJson({ t: 'exit', code: exitCode ?? null });
      this.events.emit('terminal-changed', sessionId);
      // The LIVE badge is driven by ~/.claude/sessions, and a CLI on its way out
      // has just removed its file — give the directory a moment, then re-read.
      setTimeout(() => void this.index.refreshLive(), 300);
    });

    log.info(`terminal started for ${sessionId} (${fresh ? '--session-id' : '--resume'}) in ${cwd}`);
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
    client.sendJson({
      t: 'ready',
      pid: p.pty && p.pty.pid > 0 ? p.pty.pid : null,
      running: p.pty !== null && p.exit === null,
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
    for (const [sessionId, p] of this.procs) {
      if (!p.pty || p.exit !== null) continue;
      const live = this.index.liveSessions.find((l) => l.sessionId === sessionId && pidAlive(l.pid));
      if (live && live.status === 'busy') return true;
    }
    return false;
  }

  shutdown(): void {
    for (const [sessionId, p] of this.procs) {
      this.killPty(p, 'server shutting down');
      this.procs.delete(sessionId);
    }
  }

  // ---- internals ----

  private liveCount(): number {
    let n = 0;
    for (const p of this.procs.values()) if (p.pty && p.exit === null) n++;
    return n;
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
