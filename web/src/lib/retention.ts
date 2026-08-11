import type { RetentionResponse } from '@claude-history/shared';

/**
 * What Claude Code's retention means for the sessions this app can see.
 *
 * The footer of the list and the Settings block both read this, so the number
 * shown next to the sessions and the one shown next to the explanation cannot
 * drift apart. The counting itself happens on the server, against the file's
 * **mtime** — exactly what the sweep compares (`stat.mtime < cutoff`), rather
 * than the last timestamp inside the transcript, which can be older than the
 * file by a whole tool run.
 */
export interface RetentionView {
  days: number;
  usedDefault: boolean;
  /**
   * Why Claude Code is deleting NOTHING at the moment. While this is set the
   * day count is hypothetical and the expired count is not a forecast: no file
   * is being removed at all, so neither may be stated as fact.
   */
  blocked: string | null;
  /** Sessions already past the cutoff: the next sweep deletes them. */
  expired: number;
  /** When the oldest session still kept falls past the cutoff. */
  nextDropMs: number | null;
  oldestKeptMs: number | null;
  /**
   * Reasons the plain number is not the whole answer, worst first. The expired
   * count is deliberately NOT one of them: it is the number doing its job, not
   * something wrong with it, and it gets its own sentence wherever it is shown.
   */
  problems: string[];
  tone: 'normal' | 'warn';
}

const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`;

export function retentionView(info: RetentionResponse): RetentionView {
  // A paused sweep is NOT one of these: it replaces the headline itself
  // wherever this is shown, so repeating it here would say it twice.
  const problems: string[] = [];
  const overriding = info.projectOverrides.filter((o) => o.days !== null);
  if (overriding.length > 0) {
    problems.push(`${plural(overriding.length, 'project')} keep${overriding.length === 1 ? 's' : ''} a different number of days`);
  }
  const broken = info.projectOverrides.filter((o) => o.days === null);
  if (broken.length > 0) {
    problems.push(`${plural(broken.length, 'project settings file')} Claude Code cannot use`);
  }

  return {
    days: info.days,
    usedDefault: info.usedDefault,
    blocked: info.sweepBlocked,
    expired: info.expiredCount,
    oldestKeptMs: info.oldestKeptMtimeMs,
    nextDropMs: info.oldestKeptMtimeMs === null ? null : info.oldestKeptMtimeMs + info.days * 86_400_000,
    problems,
    tone: problems.length > 0 || info.expiredCount > 0 || info.sweepBlocked !== null ? 'warn' : 'normal',
  };
}

/**
 * "9,999 days" / "30 days (default)" — the headline both places share.
 * `markDefault` is for where the sentence goes on to explain it anyway; the
 * marker only earns its place where there is no room to say more.
 */
export function retentionLabel(view: Pick<RetentionView, 'days' | 'usedDefault'>, markDefault = true): string {
  return `${view.days.toLocaleString()} ${view.days === 1 ? 'day' : 'days'}${
    markDefault && view.usedDefault ? ' (default)' : ''
  }`;
}
