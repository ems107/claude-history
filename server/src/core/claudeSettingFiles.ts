import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeSettingSource, ProjectInfo } from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { managedSettingsPath } from './retention.ts';

/**
 * One boolean of Claude Code's own settings, read out of ITS settings files —
 * never written: `~/.claude` is read-only for this app, so a panel built on
 * this says what is in force and which line would change it.
 *
 * The files are the chain `retention.ts` follows, in the CLI's order: a managed
 * policy, then the user's file, with every project's own two files read apart —
 * they count only when Claude Code is started inside that project. A key can
 * also have an environment variable that decides above all of them, which a
 * settings file may set in its `env` block.
 */

async function readSource(
  scope: ClaudeSettingSource['scope'],
  file: string,
  key: string,
  envVar: string | null,
  project: ClaudeSettingSource['project'] = null,
): Promise<ClaudeSettingSource> {
  const source: ClaudeSettingSource = { scope, path: file, exists: false, on: null, env: null, unreadable: null, project };
  let text: string;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return source;
    source.exists = true;
    source.unreadable = `${code ?? 'error'}: ${err instanceof Error ? err.message : String(err)}`;
    return source;
  }
  source.exists = true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    source.unreadable = `invalid JSON — ${err instanceof Error ? err.message : String(err)}`;
    return source;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    source.unreadable = 'not a JSON object';
    return source;
  }
  const settings = parsed as Record<string, unknown>;
  // A boolean or nothing: the CLI's schema takes no other kind of value.
  const value = settings[key];
  if (typeof value === 'boolean') source.on = value;
  const env = settings.env;
  if (envVar && typeof env === 'object' && env !== null && !Array.isArray(env)) {
    const raw = (env as Record<string, unknown>)[envVar];
    if (raw !== undefined && raw !== null) source.env = String(raw);
  }
  return source;
}

export interface SettingSources {
  policy: ClaudeSettingSource;
  user: ClaudeSettingSource;
  /** Every project's `.claude/settings.json` and `.claude/settings.local.json` that exists. */
  projects: ClaudeSettingSource[];
  userSettingsFile: string;
}

/** One fresh read, every time: what a Refresh button calls after a file was edited by hand. */
export async function readSettingSources(
  config: AppConfig,
  projects: ProjectInfo[],
  key: string,
  envVar: string | null = null,
): Promise<SettingSources> {
  const userSettingsFile = path.join(config.dataRoot, 'settings.json');
  const [policy, user] = await Promise.all([
    readSource('policy', managedSettingsPath(), key, envVar),
    readSource('user', userSettingsFile, key, envVar),
  ]);
  const found = await Promise.all(
    projects.flatMap((project) =>
      ([
        ['project', 'settings.json'],
        ['local', 'settings.local.json'],
      ] as const).map(([scope, name]) =>
        readSource(scope, path.join(project.path, '.claude', name), key, envVar, { name: project.name, path: project.path }),
      ),
    ),
  );
  return { policy, user, projects: found.filter((s) => s.exists), userSettingsFile };
}
