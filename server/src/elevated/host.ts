/**
 * The elevated host: the one process of this app that runs with administrator
 * rights, and the parent of every `claude.exe` an elevated terminal holds.
 *
 * Started by the scheduled task `util/elevatedTask.ts` registers with
 * `RunLevel Highest` — the only way Windows hands out a full token without a
 * UAC prompt at the moment of use, which is what makes an elevated terminal
 * startable from another machine at all. The server cannot do this job itself:
 * it runs with the filtered token, so a pseudo-console it owns can only hold a
 * child at its own level, and `taskkill` from it to a High process is refused.
 *
 * Everything here is deliberately narrow, because this is the code that runs
 * elevated:
 *
 * - **It connects OUT to the server and listens to nothing.** The port and a
 *   token come from the handoff file the server wrote a moment before starting
 *   the task, and the file is deleted as soon as it is read.
 * - **It runs one command line and no other** (`isAllowedSpawn`): `claude.exe`
 *   with `--resume <uuid>` or `--session-id <uuid>`, exactly as the embedded
 *   terminal opens one. No shell, so the elevated channel is a CLI and not a
 *   way to run anything else as administrator.
 * - **It dies with the connection.** When the socket closes — the server
 *   stopped, restarted or was killed outright — every tree it started is
 *   killed and it exits, so no elevated CLI outlives the server that asked for
 *   it. With no terminal left it exits on its own after `IDLE_EXIT_MS`.
 *
 * No logger: the app's logs belong to the server, and this process has no
 * business writing them. What happens here is reported over the socket, and a
 * failure before there is a socket goes to `HOST_ERROR_FILE`, which the server
 * quotes when the host never arrives.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { IPty } from '@lydell/node-pty';
import {
  HANDOFF_FILE,
  type Handoff,
  HOST_ERROR_FILE,
  type HostToServer,
  isAllowedSpawn,
  lineReader,
  type ServerToHost,
} from './protocol.ts';

/** With no terminal running and nothing said for this long, the host goes away. */
const IDLE_EXIT_MS = 60_000;
/** How long to wait for ConPTY to report the child's pid. */
const PID_WAIT_MS = 5_000;

const dataDir = argValue('--data-dir');
const ptys = new Map<string, IPty>();
let lastActivity = Date.now();

function argValue(name: string): string {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) {
    process.exitCode = 2;
    throw new Error(`${name} is required`);
  }
  return value;
}

/** The one record of a failure nobody else can hear. Overwritten, never appended. */
function fail(message: string): never {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, HOST_ERROR_FILE), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Nowhere left to say it.
  }
  process.exit(1);
}

/** High Mandatory Level is S-1-16-12288; a filtered admin token is Medium. */
function isElevated(): boolean {
  const r = spawnSync('whoami', ['/groups'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 && r.stdout.includes('S-1-16-12288');
}

function killTree(pid: number): void {
  if (pid > 0) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
}

function killAll(): void {
  for (const [id, pty] of ptys) {
    ptys.delete(id);
    const pid = pty.pid;
    try {
      pty.kill();
    } catch {
      // Already gone.
    }
    killTree(pid);
  }
}

async function main(): Promise<void> {
  const handoffPath = path.join(dataDir, HANDOFF_FILE);
  let handoff: Handoff;
  try {
    handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8')) as Handoff;
  } catch (err) {
    fail(`no readable handoff at ${handoffPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Read once: the token is good for one connection, and leaving it on disk
  // would only be leaving it.
  try {
    fs.rmSync(handoffPath, { force: true });
  } catch {
    // The server overwrites it on the next start anyway.
  }

  let nodePty: typeof import('@lydell/node-pty') | null = null;
  let ptyError: string | null = null;
  try {
    nodePty = await import('@lydell/node-pty');
  } catch (err) {
    ptyError = err instanceof Error ? err.message : String(err);
  }

  const socket = net.connect({ host: '127.0.0.1', port: handoff.port });
  socket.setNoDelay(true);
  const send = (message: HostToServer): void => {
    if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  };

  let connected = false;
  // Before the connection, an error is the whole story and goes to the file;
  // after it, `close` follows and says everything that needs saying.
  socket.on('error', (err) => {
    if (!connected) fail(`could not reach the server on port ${String(handoff.port)}: ${err.message}`);
  });
  // The connection IS the server's life, as far as this process is concerned.
  socket.on('close', () => {
    killAll();
    process.exit(0);
  });

  socket.once('connect', () => {
    connected = true;
    send({
      t: 'hello',
      token: handoff.token,
      user: os.userInfo().username,
      home: os.homedir(),
      elevated: isElevated(),
      pid: process.pid,
    });
  });

  const spawn = (msg: Extract<ServerToHost, { t: 'spawn' }>): void => {
    if (!nodePty) {
      send({ t: 'spawn-failed', id: msg.id, message: `The terminal backend could not be loaded: ${ptyError ?? 'unknown error'}` });
      return;
    }
    if (!isAllowedSpawn(msg.file, msg.args)) {
      send({ t: 'spawn-failed', id: msg.id, message: 'The elevated host only runs claude.exe on a session.' });
      return;
    }
    if (ptys.has(msg.id)) {
      send({ t: 'spawn-failed', id: msg.id, message: 'An elevated terminal is already running for this session.' });
      return;
    }
    const options = { name: 'xterm-256color', cols: msg.cols, rows: msg.rows, cwd: msg.cwd, env: msg.env };
    let pty: IPty;
    // The same pinned pseudo-console as an ordinary terminal, with the same
    // fallback — see `sessionTerminal.ts`.
    let host = 'the bundled pseudo-console';
    try {
      try {
        pty = nodePty.spawn(msg.file, msg.args, { ...options, useConptyDll: true });
      } catch {
        host = 'the pseudo-console this Windows provides';
        pty = nodePty.spawn(msg.file, msg.args, options);
      }
    } catch (err) {
      send({ t: 'spawn-failed', id: msg.id, message: err instanceof Error ? err.message : String(err) });
      return;
    }
    ptys.set(msg.id, pty);
    send({ t: 'spawned', id: msg.id, host });

    const since = Date.now();
    const waitForPid = (): void => {
      if (ptys.get(msg.id) !== pty) return;
      if (pty.pid > 0) send({ t: 'pid', id: msg.id, pid: pty.pid });
      else if (Date.now() - since < PID_WAIT_MS) setTimeout(waitForPid, 25);
    };
    waitForPid();

    pty.onData((data) => send({ t: 'data', id: msg.id, d: Buffer.from(data, 'utf8').toString('base64') }));
    pty.onExit(({ exitCode }) => {
      // A kill has already taken it out of the map, and the server already
      // knows: it asked.
      if (ptys.get(msg.id) !== pty) return;
      ptys.delete(msg.id);
      lastActivity = Date.now();
      send({ t: 'exit', id: msg.id, code: exitCode ?? null });
    });
  };

  socket.on(
    'data',
    lineReader((line) => {
      lastActivity = Date.now();
      let msg: ServerToHost;
      try {
        msg = JSON.parse(line) as ServerToHost;
      } catch {
        return; // a line we cannot read is a line we ignore
      }
      if (msg.t === 'spawn') spawn(msg);
      else if (msg.t === 'write') ptys.get(msg.id)?.write(msg.d);
      else if (msg.t === 'resize') {
        try {
          ptys.get(msg.id)?.resize(msg.cols, msg.rows);
        } catch {
          // A process that died between the two — its exit is on its way.
        }
      } else if (msg.t === 'kill') {
        const pty = ptys.get(msg.id);
        if (!pty) return;
        ptys.delete(msg.id);
        const pid = pty.pid;
        try {
          pty.kill();
        } catch {
          // Already gone.
        }
        killTree(pid);
        send({ t: 'exit', id: msg.id, code: null });
      }
    }),
  );

  setInterval(() => {
    if (ptys.size === 0 && Date.now() - lastActivity > IDLE_EXIT_MS) socket.end();
  }, 15_000).unref();
}

void main().catch((err: unknown) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
