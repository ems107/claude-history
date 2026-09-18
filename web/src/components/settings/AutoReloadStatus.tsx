import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { markUsageRead } from '../../api/usageReason.ts';
import { formatDateTime, relativeTime, timeUntil } from '../../lib/format.ts';
import { actionClass } from '../controlClass.ts';
import { Readout, ReadoutRow } from './controls.tsx';

/**
 * What the auto-reload is actually doing. Its main job is the case the settings
 * above cannot express: switched on, yet unable to ever fire. So it always
 * spells out the reason rather than just showing a state.
 */
export function AutoReloadStatus() {
  const queryClient = useQueryClient();
  const { data: st } = useQuery({
    queryKey: ['autoReload'],
    queryFn: api.autoReload,
    // Faster while something is in flight: a send lasts seconds and its
    // read-back about a minute, and both end by changing this very state.
    refetchInterval: (query) => (query.state.data?.sending || query.state.data?.verifying ? 3_000 : 30_000),
    // This is live state that also drives what the button below allows, and the
    // interval does NOT run in a hidden tab. Without a focus refetch (the app
    // turns it off globally) the panel freezes on whatever it last saw — most
    // painfully mid-send, leaving the button stuck disabled after it finished.
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (!st) return <p className="text-[var(--text-dim)]">Loading status…</p>;

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const runTest = () => {
    if (
      !confirm(
        'Send the message now?\n\nThis really sends it: it starts a 5-hour window and leaves a session in your history. ' +
          'It is also the only way to prove the folder, the CLI and the permissions work.',
      )
    ) {
      return;
    }
    setTesting(true);
    setResult(null);
    void api
      .autoReloadRun()
      .then((run) =>
        setResult(
          // The answer comes back as soon as Claude has answered, which is what
          // the button is really testing. Whether a window opened is read back a
          // minute later, in the background, and lands in "last message" above.
          run.ok
            ? `Sent in ${seconds(run.durationMs)} — reading the window back in a minute; the result appears above.`
            : `Failed: ${run.error ?? 'unknown error'}`,
        ),
      )
      .catch((e: unknown) => setResult(`Failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        setTesting(false);
        void queryClient.invalidateQueries({ queryKey: ['autoReload'] });
        // A window may have just started, so this read has a real cause — and
        // one worth naming, since an unlabelled read here is precisely the kind
        // that used to show up in the log as a bare, unexplained 'widget'.
        markUsageRead('widget-auto-reload');
        void queryClient.invalidateQueries({ queryKey: ['usage'] });
      });
  };

  // The server decides this, and it is the same string it would refuse the
  // request with — so the button's disabled state and its explanation cannot
  // disagree. Anything transient in here clears itself in seconds.
  const blocked = st.runBlockedReason;

  let tone = 'text-emerald-400';
  let headline = 'Active.';
  if (st.sending) headline = 'Active — sending a message right now.';
  else if (st.verifying) headline = 'Active — sent; reading the window back.';
  else if (st.running) headline = 'Active — checking right now.';
  if (!st.enabled) {
    tone = 'text-[var(--text-dim)]';
    headline = st.configError
      ? `Off. It will also need this fixed: ${st.configError}`
      : 'Off — nothing is read and nothing is sent.';
  } else if (st.configError) {
    // Switched on but stopped: the scheduler bails out on this before every
    // check, so say "stopped" rather than implying it is merely degraded.
    tone = 'text-amber-400';
    headline = `Switched on, but stopped — ${st.configError}`;
  } else if (st.pausedReason) {
    tone = 'text-amber-400';
    headline = `${st.pausedReason}. Save any setting above to try again.`;
  }

  const run = st.lastRun;
  return (
    <div className="space-y-2 border-t border-[var(--border)] pt-3">
      <p className={tone}>{headline}</p>
      <Readout>
        <ReadoutRow label="5-hour window">
          {/* A known expiry can already be in the past — a read is due but has
              not succeeded yet. Saying "now left" there reads like a live
              window with no time on it, which is the opposite of the truth. */}
          {!st.resetsAt
            ? 'not started'
            : Date.parse(st.resetsAt) > Date.now()
              ? `resets ${formatDateTime(st.resetsAt)} (${timeUntil(st.resetsAt) ?? '—'} left)`
              : `expired ${formatDateTime(st.resetsAt)} — waiting for a successful reading`}
        </ReadoutRow>
        <ReadoutRow label="next check">
          {st.nextCheckAt ? `${formatDateTime(st.nextCheckAt)} (in ${timeUntil(st.nextCheckAt) ?? '—'})` : 'not scheduled'}
        </ReadoutRow>
        <ReadoutRow label="last check">
          {st.lastCheckAt ? `${formatDateTime(st.lastCheckAt)} (${relativeTime(st.lastCheckAt)})` : 'never'}
        </ReadoutRow>
        {/* The figures are read once and shared, so most of the time this says
            the widget did the asking. That is the point: this panel and the
            header can no longer disagree about the token or the window — and
            the error belongs here, to the reading, not to the check above. */}
        <ReadoutRow label="shared reading">
          {st.lastReadAt
            ? `${formatDateTime(st.lastReadAt)} (${relativeTime(st.lastReadAt)})${
                st.lastReadTrigger ? ` · last asked by ${st.lastReadTrigger}` : ''
              }`
            : 'never read'}
          {st.lastError && <span className="ml-2 text-amber-400">{st.lastError}</span>}
        </ReadoutRow>
        <ReadoutRow label="claude cli">{st.cliPath ?? 'not found'}</ReadoutRow>
        {run && (
          <ReadoutRow label="last message">
            {formatDateTime(run.at)} ({relativeTime(run.at)}){run.manual ? ', manual' : ''} —{' '}
            {/* Until the read-back has happened, `windowStarted: false` means
                "not known yet" — saying "no window" there would be a verdict
                on something nobody has looked at. */}
            {run.windowStarted
              ? run.windowAlreadyRunning
                ? // It answered and the token is fresh, but the window it found
                  // predates it: claiming it started one would be a lie, and the
                  // reload that window's expiry is owed is still to come.
                  `answered in ${seconds(run.durationMs)} — a window was already running, so a reload is still due at its expiry`
                : `started a window in ${seconds(run.durationMs)}`
              : !run.verifiedAt
                ? `answered in ${seconds(run.durationMs)} — reading the window back`
                : run.ok
                  ? `answered, no window: ${run.error ?? '—'}`
                  : `failed: ${run.error ?? '—'}`}
            {run.reply && <span className="block opacity-60">“{run.reply}”</span>}
          </ReadoutRow>
        )}
      </Readout>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {/* Two states only: our own request in flight (the label says so), or
            `blocked`, which always carries its reason. Nothing else may disable
            this — no cooldown, no backoff, no scheduled check — because every
            one of those waits guards the automatic side, and this button is the
            user asking. A pause does not block it either: a successful run is
            what clears one. */}
        <button
          type="button"
          className={actionClass}
          disabled={testing || blocked !== null}
          title={blocked ?? 'Sends the message right now, exactly as the schedule would'}
          onClick={runTest}
        >
          {testing ? 'Sending…' : 'Send it now'}
        </button>
        {/* A disabled button must never be a puzzle: say it here, not just on
            hover. Tied to the same value that disables it, so there is no way to
            end up dead and silent. */}
        {blocked && !testing && <span className="text-[11px] text-[var(--text-dim)]">{blocked}</span>}
        {result && <span className="text-[11px] text-[var(--text-dim)]">{result}</span>}
      </div>
    </div>
  );
}
