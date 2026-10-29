import fs from 'node:fs';
import path from 'node:path';
import type { ProjectInfo, ThinkingSettingResponse, ThinkingSettingSource } from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { managedSettingsPath } from './retention.ts';

/**
 * Whether Claude Code keeps a summary of Claude's reasoning in its transcripts
 * — its `showThinkingSummaries` setting, read out of ITS settings files.
 *
 * Off (the default), an interactive CLI asks the API for the reasoning without
 * its text (`thinking.display: "updates"`), and what reaches the transcript is
 * an encrypted signature this app has nothing to draw from. On, it asks for
 * `"summarized"` and the summary is written (AI_TRANSCRIPTS.md, "Why a thinking
 * block is empty"). Only the user can turn it on: `~/.claude` is read-only for
 * us, so this says what is in force and which line would change it.
 *
 * The chain is the one `retention.ts` follows, in the CLI's order: a managed
 * policy, then the user's file, with the projects' own files reported apart —
 * they win only when Claude Code is started inside that project.
 */

async function readSource(
  scope: ThinkingSettingSource['scope'],
  file: string,
  project: ThinkingSettingSource['project'] = null,
): Promise<ThinkingSettingSource> {
  const source: ThinkingSettingSource = { scope, path: file, exists: false, on: null, unreadable: null, project };
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
  // A boolean or nothing: the CLI's schema takes no other kind of value.
  const value = (parsed as Record<string, unknown>).showThinkingSummaries;
  if (typeof value === 'boolean') source.on = value;
  return source;
}

/** One fresh read, every time: what the Refresh button calls after the file was edited by hand. */
export async function readThinkingSetting(config: AppConfig, projects: ProjectInfo[]): Promise<ThinkingSettingResponse> {
  const userSettingsFile = path.join(config.dataRoot, 'settings.json');
  const [policy, user] = await Promise.all([
    readSource('policy', managedSettingsPath()),
    readSource('user', userSettingsFile),
  ]);
  const found = await Promise.all(
    projects.flatMap((project) =>
      ([
        ['project', 'settings.json'],
        ['local', 'settings.local.json'],
      ] as const).map(([scope, name]) =>
        readSource(scope, path.join(project.path, '.claude', name), { name: project.name, path: project.path }),
      ),
    ),
  );
  const winner = policy.on !== null ? policy : user.on !== null ? user : null;
  return {
    on: winner?.on ?? false,
    usedDefault: winner === null,
    userSettingsFile,
    sources: [policy, user],
    projectOverrides: found.filter((s) => s.on !== null || s.unreadable !== null),
  };
}
