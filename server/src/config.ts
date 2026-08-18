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
   * `--host`, and nothing else. Null unless it was given by hand.
   *
   * The bind is NOT a config value any more: it is decided at startup by
   * `core/bind.ts` from the switch, the credentials and what the Windows
   * Firewall already allows. The reason is that listening on anything but
   * loopback with no rule to decide the matter makes Windows raise its "allow
   * this app?" dialog — at `listen()`, and about the `node.exe` path, which is
   * a new path on every update. A dialog nobody asked for is what this avoids.
   *
   * `--host` skips that gate entirely, which makes it the only remaining way to
   * get the dialog. That is on purpose: it is what makes remote access testable
   * (`preview.ps1`, checks 30-36) and it warns about itself below.
   */
  hostOverride: string | null;
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

  // Everything else about the bind is decided in `core/bind.ts`; this only
  // records the one answer a person can give by hand.
  const hostOverride = args.get('host') || null;
  if (hostOverride !== null && !isLoopbackHost(hostOverride)) {
    warnings.push(
      `--host ${hostOverride} was given by hand, so the firewall was not consulted. This is the only way left to open a listening socket that Windows may ask permission for — everything else waits until the rule exists.`,
    );
  }
  if (devInstance && hostOverride !== null && !isLoopbackHost(hostOverride)) {
    warnings.push(
      `--dev-instance was asked to bind ${hostOverride}. A dev instance has no remote access and no authentication: anything reaching it is treated as local.`,
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
    hostOverride,
    port,
    staticDir,
    exitWithParent: args.has('exit-with-parent'),
    devInstance,
    warnings,
  };
}
