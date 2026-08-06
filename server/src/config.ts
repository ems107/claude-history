import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AppConfig {
  dataRoot: string;
  projectsDir: string;
  sessionsDir: string;
  historyFile: string;
  cacheDir: string;
  host: string;
  port: number;
  /** Absolute path to built web assets, or null in dev (Vite serves the UI). */
  staticDir: string | null;
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

  let staticDir: string | null = null;
  const serveStatic = args.get('serve-static');
  if (serveStatic) {
    const resolved = path.resolve(serveStatic);
    if (fs.existsSync(path.join(resolved, 'index.html'))) {
      staticDir = resolved;
    } else {
      console.warn(`[config] --serve-static: no index.html under ${resolved}; run "pnpm build" first. Serving API only.`);
    }
  }

  return {
    dataRoot,
    projectsDir: path.join(dataRoot, 'projects'),
    sessionsDir: path.join(dataRoot, 'sessions'),
    historyFile: path.join(dataRoot, 'history.jsonl'),
    cacheDir: path.resolve(cacheBase),
    host: '127.0.0.1',
    port: Number(process.env.PORT || args.get('port') || 7433),
    staticDir,
  };
}
