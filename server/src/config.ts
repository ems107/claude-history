import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AppConfig {
  dataRoot: string;
  projectsDir: string;
  sessionsDir: string;
  /**
   * Where Claude Code saves the plan of a session, as `<slug>.md`. Newer
   * versions have the model write the plan there and send `ExitPlanMode` with
   * no input at all, so this is the only place the plan can be read from while
   * it is being approved.
   */
  plansDir: string;
  historyFile: string;
  cacheDir: string;
  /** User data that must survive cache wipes (e.g. local title overrides). */
  userdataFile: string;
  /** Daily JSONL log files. Same place for every way of running the server. */
  logsDir: string;
  /**
   * The address to bind. `0.0.0.0` for a release, `127.0.0.1` for a dev
   * instance, `--host` over both.
   *
   * A release listens on every interface ALWAYS, whatever `remoteAccessEnabled`
   * says, and that is deliberate: a request that is refused can be answered and
   * explained ("remote access is off, here is how to turn it on"), while one
   * that never reaches a socket is a browser error page nobody can act on. It
   * also means the setting can be flipped without re-listening.
   *
   * What pays for it is `routes/auth.ts` plus the hook in `app.ts`: anything
   * arriving from a non-loopback address gets NOTHING until it authenticates.
   * These two are one feature — never widen the bind without it.
   */
  host: string;
  port: number;
  /** Absolute path to built web assets, or null in dev (Vite serves the UI). */
  staticDir: string | null;
  /**
   * Exit when the parent process dies. Used by the installed scheduled task:
   * its wscript launcher is what Task Scheduler actually terminates on
   * "End" / Stop-ScheduledTask — the node child is NOT killed with it.
   */
  exitWithParent: boolean;
  /**
   * A source checkout run beside the installed release, never instead of it.
   *
   * The release owns port 7433 and `%LOCALAPPDATA%\claude-history`, and nothing
   * we do while developing may take either from it: it is the copy that always
   * works, and the one whose composer answers while this instance restarts.
   * So the flag moves BOTH — the port and the whole data folder, cache,
   * `userdata.json`, its backups and the logs with it — and the two instances
   * share only `~/.claude`, which is read-only for both.
   *
   * It is explicit rather than inferred from "am I installed?": a portable run
   * of a release is not installed either, and it should behave like the release
   * it is. The repo's own `pnpm dev` / `pnpm start` pass it.
   */
  devInstance: boolean;
  /**
   * Problems found while reading the arguments. Collected instead of printed:
   * config is resolved before logging is up, so a warning printed here would
   * never reach the log files.
   */
  warnings: string[];
}

/** The installed release's port. A dev instance must never bind it. */
export const RELEASE_PORT = 7433;
export const DEV_PORT = 7434;

/** Every interface — what a release binds so remote access is possible at all. */
export const ANY_HOST = '0.0.0.0';
/** This machine only — a dev instance, and anything asked for explicitly. */
export const LOOPBACK_HOST = '127.0.0.1';

/** Does this bind address reach nothing but this machine? */
export function isLoopbackHost(host: string): boolean {
  return host === LOOPBACK_HOST || host === '::1' || host === 'localhost';
}

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq >= 0) {
        args.set(arg.slice(2, eq), arg.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          args.set(arg.slice(2), next);
          i++;
        } else {
          args.set(arg.slice(2), '');
        }
      }
    }
  }
  return args;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): AppConfig {
  const args = parseArgs(argv);

  const dataRoot = path.resolve(
    args.get('data-root') || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  );

  const devInstance = args.has('dev-instance') || process.env.CLAUDE_HISTORY_DEV === '1';
  // One name change carries the cache, userdata.json, its backups and the logs:
  // all four are resolved from this folder, so nothing else has to know.
  const folder = devInstance ? 'claude-history-dev' : 'claude-history';

  const cacheBase =
    process.env.CLAUDE_HISTORY_CACHE ||
    (process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, folder, 'cache')
      : path.join(os.homedir(), `.${folder}`, 'cache'));

  const warnings: string[] = [];
  let staticDir: string | null = null;
  const serveStatic = args.get('serve-static');
  if (serveStatic) {
    const resolved = path.resolve(serveStatic);
    if (fs.existsSync(path.join(resolved, 'index.html'))) {
      staticDir = resolved;
    } else {
      warnings.push(`--serve-static: no index.html under ${resolved}; run "pnpm build" first. Serving API only.`);
    }
  }

  const port = Number(process.env.PORT || args.get('port') || (devInstance ? DEV_PORT : RELEASE_PORT));
  if (devInstance && port === RELEASE_PORT) {
    warnings.push(
      `--dev-instance was asked to bind ${RELEASE_PORT}, the installed release's port. It will fail to listen if the release is running.`,
    );
  }

  // A dev instance stays on loopback: remote access belongs to the release, and
  // a checkout that opens a port on the LAN every time it is started is not
  // something anyone asked for. `--host` overrides both, for the one case this
  // cannot guess (a machine with several interfaces and a reason to pick one).
  const host = args.get('host') || (devInstance ? LOOPBACK_HOST : ANY_HOST);
  if (devInstance && !isLoopbackHost(host)) {
    warnings.push(
      `--dev-instance was asked to bind ${host}. A dev instance has no remote access and no authentication: anything reaching it is treated as local.`,
    );
  }

  const cacheDir = path.resolve(cacheBase);
  return {
    dataRoot,
    projectsDir: path.join(dataRoot, 'projects'),
    sessionsDir: path.join(dataRoot, 'sessions'),
    plansDir: path.join(dataRoot, 'plans'),
    historyFile: path.join(dataRoot, 'history.jsonl'),
    cacheDir,
    userdataFile: path.resolve(cacheDir, '..', 'userdata.json'),
    logsDir: args.get('logs-dir') ? path.resolve(args.get('logs-dir') as string) : path.resolve(cacheDir, '..', 'logs'),
    host,
    port,
    staticDir,
    exitWithParent: args.has('exit-with-parent'),
    devInstance,
    warnings,
  };
}
