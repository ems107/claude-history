import type { ProjectInfo, ThinkingSettingResponse } from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { readSettingSources } from './claudeSettingFiles.ts';

/**
 * Whether Claude Code keeps a summary of Claude's reasoning in its transcripts
 * — its `showThinkingSummaries` setting, read out of ITS settings files.
 *
 * Off (the default), an interactive CLI asks the API for the reasoning without
 * its text (`thinking.display: "updates"`), and what reaches the transcript is
 * an encrypted signature this app has nothing to draw from. On, it asks for
 * `"summarized"` and the summary is written (AI_TRANSCRIPTS.md, "Why a thinking
 * block is empty"). Only the user can turn it on (`claudeSettingFiles.ts`).
 */
export async function readThinkingSetting(config: AppConfig, projects: ProjectInfo[]): Promise<ThinkingSettingResponse> {
  const { policy, user, projects: found, userSettingsFile } = await readSettingSources(
    config,
    projects,
    'showThinkingSummaries',
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
