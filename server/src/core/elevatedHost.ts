import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ElevatedTerminalsStatus } from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import {
  HANDOFF_FILE,
  type Handoff,
  HOST_ERROR_FILE,
  type HostToServer,
  lineReader,
  type ServerToHost,
} from '../elevated/protocol.ts';
import {
  type HostLaunch,
  hostLaunch,
  readTask,
  registerTask,
  removeTask,
  runTask,
  taskArguments,
  taskNameFor,
} from '../util/elevatedTask.ts';
import { createLogger } from './logger.ts';

const log = createLogger('elevated');

/**
 * From `schtasks /run` to the host's hello. Task Scheduler, wscript and a cold
 * `node.exe` loading node-pty take a second or two; this is for a machine that
 * is busy, not a number anybody should ever wait out.
 */
const CONNECT_TIMEOUT_MS = 20_000;

/**
 * A child process the embedded terminal can hold, wherever it runs.
 *
 * node-pty's `IPty` is one implementation and `ElevatedChild` the other, and
 * the terminal service sees nothing but this: the scrollback, the mode scanner,
 * the replay and the sweep are the same code for both.
 */
export interface TerminalChild {
  /** 0 until ConPTY has reported it, which is about 100 ms after the spawn. */
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (e: { exitCode: number | null }) => void): void;
  /** Ends the CLI and every child it started. */
  terminate(): void;
}

/** A `claude.exe` running inside the elevated host's pseudo-console. */
class ElevatedChild implements TerminalChild {
  pid = 0;
  private dataListener: ((data: string) => void) | null = null;
  private exitListener: ((e: { exitCode: number | null }) => void) | null = null;
  private exited = false;
  /**
   * What arrived before anybody was listening.
   *
   * Not a corner case: the host's `spawned` and its first `data` lines can
   * share one socket chunk, and they are dispatched in one synchronous loop —
   * so `spawn()` resolves, but the terminal service only gets to `onData` a
   * microtask later, after those lines have been handed over. They are the
   * CLI's opening declarations (`?9001h`, `?2004h`, `?1049h`), and losing them
   * is Shift+Enter submitting and a paste arriving unbracketed.
   */
  private early: string[] = [];
  private earlyExit: { exitCode: number | null } | null = null;

  constructor(
    private readonly id: string,
    private readonly send: (message: ServerToHost) => void,
  ) {}

  write(data: string): void {
    if (!this.exited) this.send({ t: 'write', id: this.id, d: data });
  }

  resize(cols: number, rows: number): void {
    if (!this.exited) this.send({ t: 'resize', id: this.id, cols, rows });
  }

  onData(listener: (data: string) => void): void {
    this.dataListener = listener;
    const early = this.early;
    this.early = [];
    for (const d of early) listener(d);
  }

  onExit(listener: (e: { exitCode: number | null }) => void): void {
    this.exitListener = listener;
    if (this.earlyExit) listener(this.earlyExit);
    this.earlyExit = null;
  }

  /** The host does the killing: from here, `taskkill` on a High process is refused. */
  terminate(): void {
    if (!this.exited) this.send({ t: 'kill', id: this.id });
  }

  data(d: string): void {
    if (this.dataListener) this.dataListener(d);
    else this.early.push(d);
  }

  /** Once, whichever way it ended — the host saying so, or the host going away. */
  exit(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    this.pid = 0;
    if (this.exitListener) this.exitListener({ exitCode: code });
    else this.earlyExit = { exitCode: code };
  }
}

interface Connection {
  socket: net.Socket;
  send: (message: ServerToHost) => void;
  hostPid: number;
}

/**
 * The server's end of the elevated host: whether the scheduled task exists, and
 * the one connection to the host while it runs.
 *
 * **The host is started on demand and lives no longer than the server.** The
 * first elevated terminal starts it through the task — no prompt, which is the
 * point, and so no reason this has to be local — and it serves every elevated
 * terminal after that. Its connection is our life as far as it is concerned:
 * when this process ends, however it ends, the socket closes and the host kills
 * what it started.
 *
 * **The task's state is read when it can have changed, not on every status.**
 * The terminal status is polled by every open session page, and a `schtasks`
 * spawn per poll would be the cost of a feature most people never switch on.
 * So it is read at startup, after turning it on or off, and again whenever a
 * start through it fails — a task deleted by hand in Task Scheduler is found on
 * the first attempt to use it, which is when it matters.
 */
export class ElevatedHost {
  readonly taskName: string;
  private readonly dir: string;
  private launch: HostLaunch | { error: string };
  private task: { state: ElevatedTerminalsStatus['state']; detail: string | null } = { state: 'off', detail: null };
  private conn: Connection | null = null;
  private connecting: Promise<Connection> | null = null;
  private readonly children = new Map<string, ElevatedChild>();
  private readonly pending = new Map<string, { resolve: (host: string) => void; reject: (err: Error) => void }>();

  constructor(
    config: AppConfig,
    private readonly installRoot: string | null,
  ) {
    this.taskName = taskNameFor(config.port);
    // Beside userdata.json, in this instance's own data folder: the handoff is
    // the one thing a host reads from us, and two instances must never read
    // each other's.
    this.dir = path.resolve(config.cacheDir, '..', 'elevated');
    this.launch = hostLaunch(this.dir, installRoot);
  }

  async start(): Promise<void> {
    await this.refresh();
    log.info(`elevated terminals: ${this.task.state}${this.task.detail ? ` (${this.task.detail})` : ''}`);
  }

  status(): ElevatedTerminalsStatus {
    return {
      state: this.task.state,
      taskName: this.taskName,
      detail: this.task.detail,
      hostRunning: this.conn !== null,
      terminals: this.children.size,
    };
  }

  /** Why an elevated terminal cannot be started, or null. Read from the cached state. */
  blockedReason(): string | null {
    switch (this.task.state) {
      case 'on':
        return null;
      case 'off':
        return 'Administrator terminals are turned off. Turn them on in Settings → Claude, on this machine.';
      case 'stale':
        return `Administrator terminals were set up for another copy of claude-history${
          this.task.detail ? ` (${this.task.detail})` : ''
        }. Turn them on again in Settings → Claude, on this machine.`;
      case 'unavailable':
        return `Administrator terminals are unavailable: ${this.task.detail ?? 'unknown reason'}`;
    }
  }

  /** Looks at the task again and decides what it means for THIS copy. */
  async refresh(): Promise<ElevatedTerminalsStatus> {
    if ('error' in this.launch) {
      this.task = { state: 'unavailable', detail: this.launch.error };
      return this.status();
    }
    const reading = await readTask(this.taskName);
    if (reading.state === 'absent') this.task = { state: 'off', detail: null };
    else if (reading.state === 'unreadable') this.task = { state: 'unavailable', detail: reading.error };
    else if (!reading.highest) this.task = { state: 'stale', detail: 'it does not run with the highest privileges' };
    else if (
      reading.command.toLowerCase() !== 'wscript.exe' ||
      reading.args.toLowerCase() !== taskArguments(this.launch).toLowerCase()
    ) {
      this.task = { state: 'stale', detail: `it starts ${reading.args || reading.command}` };
    } else this.task = { state: 'on', detail: null };
    return this.status();
  }

  /** Registers the task, behind a UAC prompt on this machine. */
  async enable(): Promise<ElevatedTerminalsStatus> {
    // Asked again rather than trusted: the launch depends on files that may
    // have appeared since the server started (a `pnpm install`, say).
    this.launch = hostLaunch(this.dir, this.installRoot);
    if ('error' in this.launch) throw new Error(this.launch.error);
    log.info(`registering the scheduled task "${this.taskName}"`);
    await registerTask(this.taskName, this.launch);
    return this.refresh();
  }

  /** Removes the task. What is running goes on running until it is closed. */
  async disable(): Promise<ElevatedTerminalsStatus> {
    log.info(`removing the scheduled task "${this.taskName}"`);
    await removeTask(this.taskName);
    return this.refresh();
  }

  /**
   * Starts `file args` inside the host's pseudo-console, starting the host
   * first if it is not running. Rejects with a sentence for the start bar.
   */
  async spawn(
    id: string,
    file: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; cols: number; rows: number },
  ): Promise<{ child: TerminalChild; host: string }> {
    const conn = await this.connection();
    if (this.children.has(id)) throw new Error('An elevated terminal is already running for this session.');
    const child = new ElevatedChild(id, conn.send);
    this.children.set(id, child);
    const spawned = new Promise<string>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    conn.send({ t: 'spawn', id, file, args, ...options });
    try {
      const host = await spawned;
      return { child, host };
    } catch (err) {
      this.children.delete(id);
      throw err;
    }
  }

  shutdown(): void {
    // Closing the socket is the whole signal: the host kills its trees on it.
    this.conn?.socket.destroy();
  }

  // ---- internals ----

  private connection(): Promise<Connection> {
    if (this.conn) return Promise.resolve(this.conn);
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  /**
   * Starts the host and waits for it to call back.
   *
   * The listener is ours and on loopback, with a port the OS picks; the host
   * learns it and a one-time token from the handoff file, and the first
   * connection that presents that token is the host. Anything else that finds
   * the port is closed on its first line. The listener stops listening as soon
   * as the host is in.
   */
  private async connect(): Promise<Connection> {
    if (this.task.state !== 'on') throw new Error(this.blockedReason() ?? 'Administrator terminals are unavailable.');
    const token = crypto.randomBytes(32).toString('hex');
    const listener = net.createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (listener.address() as net.AddressInfo).port;

    fs.mkdirSync(this.dir, { recursive: true });
    fs.rmSync(path.join(this.dir, HOST_ERROR_FILE), { force: true });
    const handoff: Handoff = { port, token, serverPid: process.pid };
    fs.writeFileSync(path.join(this.dir, HANDOFF_FILE), JSON.stringify(handoff));

    try {
      const accepted = this.accept(listener, token);
      try {
        await runTask(this.taskName);
      } catch (err) {
        // A task deleted in Task Scheduler since we last looked is found here.
        void this.refresh();
        throw err;
      }
      return await accepted;
    } finally {
      listener.close();
      fs.rmSync(path.join(this.dir, HANDOFF_FILE), { force: true });
    }
  }

  private accept(listener: net.Server, token: string): Promise<Connection> {
    return new Promise<Connection>((resolve, reject) => {
      const timer = setTimeout(() => {
        let why = '';
        try {
          why = fs.readFileSync(path.join(this.dir, HOST_ERROR_FILE), 'utf8').trim();
        } catch {
          // Nothing written: the host never started at all, or died without a word.
        }
        log.warn(`the elevated host did not connect within ${String(CONNECT_TIMEOUT_MS / 1000)}s`, { why: why || null });
        reject(
          new Error(
            `The elevated host did not start${why ? `: ${why}` : '. Check the task in Task Scheduler.'}`,
          ),
        );
      }, CONNECT_TIMEOUT_MS);

      listener.on('connection', (socket) => {
        socket.setNoDelay(true);
        let greeted = false;
        const send = (message: ServerToHost): void => {
          if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
        };
        socket.on('error', () => {
          // `close` follows and does the bookkeeping.
        });
        socket.on(
          'data',
          lineReader((line) => {
            let msg: HostToServer;
            try {
              msg = JSON.parse(line) as HostToServer;
            } catch {
              return;
            }
            if (!greeted) {
              const refusal = this.checkHello(msg, token);
              if (refusal) {
                log.warn(`refused a connection to the elevated host's port: ${refusal}`);
                socket.destroy();
                if (msg.t === 'hello' && msg.token === token) {
                  clearTimeout(timer);
                  reject(new Error(refusal));
                }
                return;
              }
              greeted = true;
              clearTimeout(timer);
              const hostPid = msg.t === 'hello' ? msg.pid : 0;
              const conn: Connection = { socket, send, hostPid };
              this.conn = conn;
              socket.on('close', () => this.lost(conn));
              log.info(`elevated host connected (pid ${String(hostPid)})`);
              resolve(conn);
              return;
            }
            this.dispatch(msg);
          }),
        );
      });
    });
  }

  /** Why this first line is not our host, or null when it is. */
  private checkHello(msg: HostToServer, token: string): string | null {
    if (msg.t !== 'hello') return 'it did not introduce itself';
    const expected = Buffer.from(token);
    const given = Buffer.from(String(msg.token));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return 'wrong token';
    // Another administrator's credentials on the UAC prompt would register a
    // task for THAT account, and its CLI would read and write another
    // ~/.claude — where `--resume` finds nothing of ours.
    if (msg.user.toLowerCase() !== os.userInfo().username.toLowerCase() || path.resolve(msg.home).toLowerCase() !== path.resolve(os.homedir()).toLowerCase()) {
      return `the task runs as ${msg.user}, not as ${os.userInfo().username}. Turn administrator terminals off and on again, approving with your own account.`;
    }
    if (!msg.elevated) {
      return 'the task ran without administrator rights — is this account an administrator?';
    }
    return null;
  }

  private dispatch(msg: HostToServer): void {
    switch (msg.t) {
      case 'spawned':
        this.pending.get(msg.id)?.resolve(msg.host);
        this.pending.delete(msg.id);
        break;
      case 'spawn-failed':
        this.pending.get(msg.id)?.reject(new Error(msg.message));
        this.pending.delete(msg.id);
        break;
      case 'pid': {
        const child = this.children.get(msg.id);
        if (child) child.pid = msg.pid;
        break;
      }
      case 'data':
        this.children.get(msg.id)?.data(Buffer.from(msg.d, 'base64').toString('utf8'));
        break;
      case 'exit': {
        const child = this.children.get(msg.id);
        this.children.delete(msg.id);
        child?.exit(msg.code);
        break;
      }
      case 'hello':
        break;
    }
  }

  /** The host is gone, and with it every CLI it held. */
  private lost(conn: Connection): void {
    if (this.conn !== conn) return;
    this.conn = null;
    log.info(`elevated host disconnected (pid ${String(conn.hostPid)})`);
    for (const p of this.pending.values()) p.reject(new Error('The elevated host went away before the terminal started.'));
    this.pending.clear();
    for (const [id, child] of [...this.children]) {
      this.children.delete(id);
      child.exit(null);
    }
  }
}
