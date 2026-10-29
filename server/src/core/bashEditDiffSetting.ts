import type { BashEditDiffSettingResponse, ClaudeSettingSource } from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { readSettingSources } from './claudeSettingFiles.ts';
import type { SessionIndex } from './index.ts';
import { isRec, safeParse, str, streamLines } from './jsonl.ts';

const KEY = 'bashEditDiffEnabled';
const ENV = 'CLAUDE_CODE_BASH_EDIT_DIFF';

/** How many of the newest transcripts are read for a sign that it works. */
const EVIDENCE_FILES = 10;

/** The CLI's own three-state reading of a variable: on, off, or not a value at all. */
function triBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return null;
}

/**
 * The newest Bash result that carries a diff, in the newest transcripts.
 *
 * The files only say what was WRITTEN; with nothing written, whether Claude
 * Code records diffs is down to the mode and an experiment nothing on disk
 * names, and a diff in a transcript is the one thing that proves it does.
 * Bounded: the newest few main transcripts, newest first, stopping at the
 * first that has one — the session being worked in usually does.
 */
async function lastSeen(index: SessionIndex): Promise<BashEditDiffSettingResponse['lastSeen']> {
  for (const summary of index.list().slice(0, EVIDENCE_FILES)) {
    const scanned = index.getScanned(summary.id);
    if (!scanned) continue;
    let found: { toolUseId: string | null; at: string | null } | null = null;
    try {
      for await (const line of streamLines(scanned.filePath)) {
        if (!line.includes('"bashEditDiff"')) continue;
        const o = safeParse(line);
        if (!o || !isRec(o.toolUseResult) || !isRec(o.toolUseResult.bashEditDiff)) continue;
        const content = isRec(o.message) && Array.isArray(o.message.content) ? o.message.content : [];
        const result = content.find((c) => isRec(c) && c.type === 'tool_result');
        found = { toolUseId: isRec(result) ? str(result.tool_use_id) : null, at: str(o.timestamp) };
      }
    } catch {
      // A transcript that vanished or cannot be read is simply not evidence.
      continue;
    }
    if (found) return { sessionId: summary.id, title: summary.title, ...found };
  }
  return null;
}

/** One fresh read, every time: the panel's Refresh is this call. */
export async function readBashEditDiffSetting(config: AppConfig, index: SessionIndex): Promise<BashEditDiffSettingResponse> {
  const { policy, user, projects, userSettingsFile } = await readSettingSources(config, index.projects(), KEY, ENV);

  // 1. The variable, wherever it is set: this server's own environment is the
  // nearest thing to the one Claude Code starts in, then the files' `env`.
  const envCandidates: { where: string; value: string }[] = [];
  const own = process.env[ENV];
  if (own !== undefined) envCandidates.push({ where: 'the environment', value: own });
  for (const s of [policy, user]) if (s.env !== null) envCandidates.push({ where: s.path, value: s.env });
  const env = envCandidates.find((c) => triBool(c.value) !== null) ?? null;

  // 2. The first file that sets the key.
  const file = policy.on !== null ? policy : user.on !== null ? user : null;

  let state: BashEditDiffSettingResponse['state'] = 'unset';
  let decidedBy: BashEditDiffSettingResponse['decidedBy'] = null;
  if (env) {
    state = triBool(env.value) ? 'on' : 'off';
    decidedBy = { kind: 'env', ...env };
  } else if (file) {
    state = file.on ? 'on' : 'off';
    decidedBy = { kind: 'file', path: file.path };
  }

  const projectOverrides: ClaudeSettingSource[] = projects.filter(
    (s) => s.on !== null || s.env !== null || s.unreadable !== null,
  );

  return {
    state,
    decidedBy,
    userSettingsFile,
    sources: [policy, user],
    projectOverrides,
    lastSeen: await lastSeen(index),
  };
}
