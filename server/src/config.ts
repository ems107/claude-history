import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AppConfig {
  dataRoot: string;
  projectsDir: string;
  sessionsDir: string;
  historyFile: string;
  cacheDir: string;
  /** User data that must survive cache wipes (e.g. local title overrides). */
  userdataFile: string;
  /** Daily JSONL log files. Same place for every way of running the server. */
  logsDir: string;
  /**
   * Copies of files the Git tab is about to overwrite. Discarding is the one
   * thing this app does that destroys work which exists in no commit and no
   * index, so it keeps the bytes for a few days first.
   */
  gitUndoDir: string;
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
   * Problems found while reading the arguments. Collected instead of printed:
   * config is resolved before logging is up, so a warning printed here would
   * never reach the log files.
   */
  warnings: string[];
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

  const cacheBase =
    process.env.CLAUDE_HISTORY_CACHE ||
    (process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'claude-history', 'cache')
      : path.join(os.homedir(), '.claude-history', 'cache'));

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

  const cacheDir = path.resolve(cacheBase);
  return {
    dataRoot,
    projectsDir: path.join(dataRoot, 'projects'),
    sessionsDir: path.join(dataRoot, 'sessions'),
    historyFile: path.join(dataRoot, 'history.jsonl'),
    cacheDir,
    userdataFile: path.resolve(cacheDir, '..', 'userdata.json'),
    logsDir: args.get('logs-dir') ? path.resolve(args.get('logs-dir') as string) : path.resolve(cacheDir, '..', 'logs'),
    // Beside userdata.json rather than inside the cache: it holds work that
    // exists nowhere else for a few days, and "Clear cache" must not be a way
    // to lose it.
    gitUndoDir: path.resolve(cacheDir, '..', 'git-undo'),
    host: '127.0.0.1',
    port: Number(process.env.PORT || args.get('port') || 7433),
    staticDir,
    exitWithParent: args.has('exit-with-parent'),
    warnings,
  };
}
