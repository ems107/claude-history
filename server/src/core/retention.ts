import fs from 'node:fs';
import path from 'node:path';
import type { ProjectInfo, RetentionResponse, RetentionSource, SessionSummary } from '@claude-history/shared';
import { CLAUDE_RETENTION_DEFAULT_DAYS, CLAUDE_RETENTION_MIN_DAYS } from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { createLogger } from './logger.ts';

const log = createLogger('retention');

/**
 * How long Claude Code keeps its own history, read out of ITS settings files.
 *
 * This is the one number that decides how much of what this app browses still
 * exists tomorrow, and nothing here writes it: `~/.claude` is read-only for us,
 * and a settings file we corrupted would not merely lose a preference — Claude
 * Code pauses the entire cleanup sweep while any of its settings files fails to
 * parse, which is a silent, open-ended change to the user's retention.
 *
 * Verified against the CLI bundle (2.1.228) and the docs:
 *  - default 30 days, minimum 1; a literal 0 fails validation (it is NOT "never")
 *  - the sweep runs a few seconds after startup, at most once every 24 h, gated
 *    by the mtime of `~/.claude/.last-cleanup`
 *  - it deletes by FILE MTIME, and a transcript takes its `<uuid>/` folder
 *    (subagents, offloaded tool results) with it
 *  - precedence: managed policy > CLI flags > project `.claude/settings.local.json`
 *    > project `.claude/settings.json` > `~/.claude/settings.json`
 */

/**
 * Where a managed policy file lives, per the docs, when nothing overrides it.
 *
 * Exported because it is the FIRST file in every one of Claude Code's settings
 * chains, not only the retention one — `sessionTerminal.ts` reads `tui` through
 * the same order.
 */
export function managedSettingsPath(): string {
  // Set by an enterprise deployment; it wins over the documented location.
  const fromEnv = process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  if (process.platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  if (process.platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

/**
 * Read one settings file and report what it says about `cleanupPeriodDays` —
 * including the several ways it can say nothing, each of which means something
 * different to Claude Code and so must survive as its own field.
 */
async function readSource(
  scope: RetentionSource['scope'],
  file: string,
  project: RetentionSource['project'] = null,
): Promise<RetentionSource> {
  const source: RetentionSource = {
    scope,
    path: file,
    exists: false,
    days: null,
    unreadable: null,
    invalidValue: null,
    project,
  };
  let text: string;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Not being there is the normal case for almost every project, not a problem.
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
  const value = (parsed as Record<string, unknown>).cleanupPeriodDays;
  if (value === undefined) return source;
  // The CLI validates with `int().positive()`, so a string, a fraction or a 0 is
  // rejected — and a key set explicitly but rejected is what pauses the sweep.
  if (typeof value !== 'number' || !Number.isInteger(value) || value < CLAUDE_RETENTION_MIN_DAYS) {
    source.invalidValue = JSON.stringify(value) ?? String(value);
    return source;
  }
  source.days = value;
  return source;
}

/** Whatever the sentinel holds, its mtime is what Claude Code actually checks. */
async function lastSweep(dataRoot: string): Promise<string | null> {
  try {
    const st = await fs.promises.stat(path.join(dataRoot, '.last-cleanup'));
    return new Date(st.mtimeMs).toISOString();
  } catch {
    return null;
  }
}

/**
 * The last state we said out loud. Every page that shows the retention re-reads
 * it, so logging the findings each time would drown the log in identical
 * warnings; logging only what changed keeps the one line that matters — the day
 * the number, or the sweep, silently becomes something else.
 */
let lastAnnounced: string | null = null;

/**
 * One fresh read of the whole picture. Nothing is cached on purpose: this is
 * what the Refresh button calls after the user has edited the file by hand, and
 * a cache would make that button lie. It costs two small files plus two ENOENTs
 * per known project — a couple of milliseconds.
 */
export async function readRetention(
  config: AppConfig,
  projects: ProjectInfo[],
  sessions: SessionSummary[],
): Promise<RetentionResponse> {
  const [policy, user] = await Promise.all([
    readSource('policy', managedSettingsPath()),
    readSource('user', path.join(config.dataRoot, 'settings.json')),
  ]);

  const found = await Promise.all(
    projects.flatMap((project) =>
      ([
        ['project', 'settings.json'],
        ['local', 'settings.local.json'],
      ] as const).map(([scope, name]) =>
        readSource(scope, path.join(project.path, '.claude', name), {
          name: project.name,
          path: project.path,
        }),
      ),
    ),
  );
  // Only files with something to say: a project with no `.claude` settings is
  // the overwhelming majority and would bury the ones that matter.
  const projectOverrides = found.filter((s) => s.days !== null || s.invalidValue !== null || s.unreadable !== null);

  const winner = policy.days !== null ? policy : user.days !== null ? user : null;
  const days = winner?.days ?? CLAUDE_RETENTION_DEFAULT_DAYS;

  // Claude Code's own rule: a policy value makes the sweep run regardless, and
  // otherwise any unreadable settings file — or a `cleanupPeriodDays` that fails
  // validation — pauses it entirely until the file is fixed.
  let sweepBlocked: string | null = null;
  if (policy.days === null) {
    const broken = [policy, user].find((s) => s.unreadable !== null || s.invalidValue !== null);
    if (broken) {
      sweepBlocked = broken.unreadable
        ? `${broken.path} cannot be read (${broken.unreadable})`
        : `${broken.path} sets cleanupPeriodDays to ${broken.invalidValue}, which is not a whole number of days (minimum ${CLAUDE_RETENTION_MIN_DAYS})`;
    }
  }

  // The sweep compares the FILE's mtime, not the last timestamp inside the
  // transcript — the two differ by a whole tool run in a long session.
  const cutoffMs = Date.now() - days * 86_400_000;
  let expiredCount = 0;
  let oldestKeptMtimeMs: number | null = null;
  for (const s of sessions) {
    if (s.mtimeMs < cutoffMs) expiredCount++;
    else if (oldestKeptMtimeMs === null || s.mtimeMs < oldestKeptMtimeMs) oldestKeptMtimeMs = s.mtimeMs;
  }

  const result: RetentionResponse = {
    days,
    usedDefault: winner === null,
    effectiveScope: winner?.scope ?? 'default',
    defaultDays: CLAUDE_RETENTION_DEFAULT_DAYS,
    minDays: CLAUDE_RETENTION_MIN_DAYS,
    userSettingsFile: user.path,
    settingsDir: config.dataRoot,
    sources: [policy, user],
    projectOverrides,
    sweepBlocked,
    policyPresent: policy.exists,
    lastSweepAt: await lastSweep(config.dataRoot),
    cutoff: new Date(cutoffMs).toISOString(),
    expiredCount,
    countedSessions: sessions.length,
    oldestKeptMtimeMs,
    readAt: new Date().toISOString(),
  };

  const signature = JSON.stringify([days, result.effectiveScope, sweepBlocked, projectOverrides, expiredCount]);
  if (signature === lastAnnounced) {
    log.debug(`Claude keeps history for ${days} days (unchanged)`);
    return result;
  }
  lastAnnounced = signature;
  log.info(
    `Claude keeps history for ${days} days — ${
      result.usedDefault ? 'nothing sets it, this is the built-in default' : `set in ${winner?.path ?? '?'}`
    }`,
    { effectiveScope: result.effectiveScope, cutoff: result.cutoff, lastSweepAt: result.lastSweepAt },
  );
  if (sweepBlocked) log.warn(`Claude Code is not cleaning up at all: ${sweepBlocked}`);
  if (expiredCount > 0) {
    log.warn(
      `${expiredCount} of ${sessions.length} sessions are past the cutoff (${result.cutoff}) and go at Claude Code's next start`,
    );
  }
  for (const o of projectOverrides) {
    log.warn(
      o.days !== null
        ? `sessions started in "${o.project?.name}" are kept ${o.days} days instead (${o.path})`
        : `"${o.project?.name}" has a settings file Claude Code cannot use (${o.path}): ${o.unreadable ?? o.invalidValue}`,
    );
  }
  return result;
}
