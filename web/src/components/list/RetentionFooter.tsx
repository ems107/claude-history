import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { formatDateTime, relativeTime, timeUntil } from '../../lib/format.ts';
import { retentionLabel, retentionView } from '../../lib/retention.ts';
import { GearIcon } from '../icons.tsx';

/** Past this, "how old is the oldest one" turns into "it goes in N days". */
const NEAR_THE_EDGE_MS = 30 * 86_400_000;

/**
 * How long Claude Code keeps what this list shows, at the bottom of the filters.
 *
 * The value lives in Claude Code's settings, not ours, and it is the one number
 * that decides whether any of these sessions is still here tomorrow — so it
 * belongs next to them, not only on a settings page nobody opens. Everything
 * here is read-only; the link goes where changing it is explained.
 */
export function RetentionFooter() {
  const { data } = useQuery({
    queryKey: ['retention'],
    queryFn: api.retention,
    // The server reads the files on every call, so this is a real re-read; five
    // minutes is plenty for something that only changes when the user edits it
    // by hand, and the Refresh button in Settings updates this very query.
    staleTime: 5 * 60_000,
  });
  if (!data) return null;

  const view = retentionView(data);

  return (
    <div className="mt-auto border-t border-[var(--border)] px-3 py-3 text-[11px] leading-relaxed">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
          Claude keeps history
        </span>
        <Link
          to="/settings#claude-retention"
          title="What this means, and how to change it"
          className="ml-auto inline-flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          <GearIcon />
          change
        </Link>
      </div>

      {/* With the sweep paused nothing is being deleted at all, so a day count
          would be a forecast of something that is not happening. */}
      {view.blocked ? (
        <p className="text-amber-400" title={view.blocked}>
          nothing is being deleted — its cleanup is paused
        </p>
      ) : (
        <p
          className={view.tone === 'warn' ? 'text-amber-400' : 'text-[var(--text)]'}
          title={
            data.usedDefault
              ? 'No settings file sets cleanupPeriodDays, so Claude Code applies its built-in default.'
              : `cleanupPeriodDays, set in ${data.sources.find((s) => s.days !== null)?.path ?? data.userSettingsFile}`
          }
        >
          for {retentionLabel(view)}
        </p>
      )}

      {view.blocked ? null : view.expired > 0 ? (
        <p className="mt-1 text-amber-400" title={`Older than ${formatDateTime(data.cutoff)}`}>
          {view.expired} of {data.countedSessions} sessions are past the cutoff — Claude Code deletes{' '}
          {view.expired !== 1 ? 'them' : 'it'} the next time it starts.
        </p>
      ) : view.oldestKeptMs !== null ? (
        // The margin, in the form that answers "how close am I?": how old the
        // oldest one is, and — only when it is genuinely near — when it goes.
        <p className="mt-1 text-[var(--text-dim)]">
          oldest kept: {relativeTime(view.oldestKeptMs)}
          {view.nextDropMs !== null && view.nextDropMs - Date.now() < NEAR_THE_EDGE_MS && (
            <span className="text-amber-400" title={formatDateTime(view.nextDropMs)}>
              {' '}
              · goes in {timeUntil(view.nextDropMs, true)}
            </span>
          )}
        </p>
      ) : null}

      {/* A number that is not the whole truth must say so where it is shown, not
          only in Settings: a project can override it, and a settings file Claude
          Code cannot parse stops the cleanup altogether. */}
      {view.problems.map((p) => (
        <p key={p} className="mt-1 text-amber-400">
          {p} — see settings
        </p>
      ))}
    </div>
  );
}
