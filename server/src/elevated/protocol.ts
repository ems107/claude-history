/**
 * The wire between this server and the elevated host (`host.ts`): one JSON
 * object per line, in both directions, over a loopback socket the SERVER owns.
 *
 * Kept in a file of its own because both ends import it and the host must stay
 * small: it is bundled separately (`elevated-host.cjs`) and runs with
 * administrator rights, so nothing it loads should be there by accident.
 *
 * Output travels as base64 inside the JSON. A terminal's volume is a few KB a
 * second at its busiest, and a framing of our own would be a second parser to
 * get right on the one channel where a parsing bug runs elevated.
 */

/** What the server says to the host. */
export type ServerToHost =
  | {
      t: 'spawn';
      /** The session id — one terminal per session, so it is the key on both ends. */
      id: string;
      file: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      cols: number;
      rows: number;
    }
  | { t: 'write'; id: string; d: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'kill'; id: string };

/** What the host says to the server. */
export type HostToServer =
  | {
      t: 'hello';
      token: string;
      /** `os.userInfo().username` — the account the task actually ran as. */
      user: string;
      home: string;
      /** The host's own token is a High-integrity one. */
      elevated: boolean;
      pid: number;
    }
  | { t: 'spawned'; id: string; host: string }
  | { t: 'spawn-failed'; id: string; message: string }
  /** ConPTY reports the child about 100 ms after the spawn returns, so the pid follows on its own. */
  | { t: 'pid'; id: string; pid: number }
  | { t: 'data'; id: string; d: string }
  | { t: 'exit'; id: string; code: number | null };

/**
 * What the server leaves for the host to find, in `<data folder>\elevated\`.
 *
 * The scheduled task's arguments are fixed when it is registered, so this file
 * is the only way to hand a freshly started host the port and the token of
 * THIS run.
 */
export interface Handoff {
  port: number;
  token: string;
  /** The server's pid, so a host can tell a handoff left by a server that is gone. */
  serverPid: number;
}

export const HANDOFF_FILE = 'handoff.json';
/** Written by the host when it fails before it could say so on the socket. */
export const HOST_ERROR_FILE = 'host-error.txt';

/**
 * The ONLY command line the host will run: `claude.exe` and one of the two
 * ways `sessionTerminal.ts` opens a session. Checked on the host, where the
 * rights are — the server is not trusted to have asked for nothing else.
 */
const SESSION_ARG = /^--(resume|session-id)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAllowedSpawn(file: string, args: string[]): boolean {
  const name = file.split(/[\\/]/).pop()?.toLowerCase();
  return name === 'claude.exe' && args.length === 2 && SESSION_ARG.test(args[0]) && UUID.test(args[1]);
}

/** Splits a stream into lines, keeping the unfinished tail for the next chunk. */
export function lineReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let tail = '';
  return (chunk) => {
    const text = tail + chunk.toString('utf8');
    const lines = text.split('\n');
    tail = lines.pop() ?? '';
    for (const line of lines) if (line) onLine(line);
  };
}
