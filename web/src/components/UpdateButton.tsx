import type { UpdateRelease, UpdateStatusResponse } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.ts';
import { useIsRemote } from '../api/useLocal.ts';
import { formatBytes, formatDateTime, relativeTime } from '../lib/format.ts';
import { useActiveSessionsGuard } from './ActiveSessionsDialog.tsx';
import { UpgradeIcon } from './icons.tsx';
import { Markdown } from './viewer/Markdown.tsx';

const STATE_LABEL: Record<string, string> = {
  checking: 'Checking…',
  downloading: 'Downloading update…',
  verifying: 'Verifying download…',
  staging: 'Extracting new version…',
  restarting: 'Restarting…',
};

/**
 * Once the helper has taken over, everything left is local: swap the junction,
 * start the task, wait up to 45 s for the new version, roll back and wait 30 s
 * more. This covers all of it with room to spare.
 */
const HANDOVER_DEADLINE_MS = 240_000;
/**
 * After the handover the previous build may answer for a moment (it exits half
 * a second later) — but if it is STILL answering this long afterwards, the
 * helper rolled back and no reload is coming.
 */
const ROLLBACK_GRACE_MS = 60_000;
const META_POLL_MS = 1_500;

/** Releases up to 1.2.6 repeated the tag as the first line of the notes. */
function stripLeadingTag(notes: string, tag: string): string {
  return notes.replace(new RegExp(`^\\s*${tag}\\s*\n`), '').trimStart();
}

/** "12.4 MB of 34.5 MB (36%) · 2.1 MB/s · attempt 2" */
function describeProgress(progress: NonNullable<UpdateStatusResponse['progress']>): string {
  const parts = [
    progress.totalBytes
      ? `${formatBytes(progress.receivedBytes)} of ${formatBytes(progress.totalBytes)} (${Math.round(
          (progress.receivedBytes / progress.totalBytes) * 100,
        )}%)`
      : formatBytes(progress.receivedBytes),
  ];
  if (progress.bytesPerSecond) parts.push(`${formatBytes(progress.bytesPerSecond)}/s`);
  if (progress.attempt > 1) parts.push(`attempt ${progress.attempt}`);
  return parts.join(' · ');
}

/**
 * Header update button: shows a badge when newer releases exist (the server
 * checks GitHub every 10 minutes; SSE keeps this fresh). The popup lists
 * every version newer than the running one with its notes, so the user sees
 * the whole set of changes and picks which one to install.
 *
 * Applying is followed through the SERVER's state, never a timer of our own:
 * the apply request answers immediately and the work carries on in the
 * background, so `state`, `progress` and `lastApplyError` are the only things
 * that know what is happening. A fixed client-side deadline used to declare
 * failure while a slow download was still perfectly alive.
 */
export function UpdateButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const remote = useIsRemote();
  const guard = useActiveSessionsGuard();
  const [target, setTarget] = useState<string | null>(null);
  /** The version being installed, frozen for the duration of the attempt. */
  const [applyingTo, setApplyingTo] = useState<string | null>(null);
  const startedAtRef = useRef(0);
  const handoverAtRef = useRef(0);
  const oldVersionSinceRef = useRef(0);

  const { data: status } = useQuery({
    queryKey: ['update'],
    queryFn: api.updateStatus,
    // SSE carries the progress, but it dies with the server during the
    // handover — polling keeps the popup honest across the restart.
    refetchInterval: (query) => (query.state.data?.applyingVersion || applyingTo ? 1_000 : false),
  });

  const available: UpdateRelease[] = status?.available ?? [];
  const selected = available.find((r) => r.version === target) ?? available[0] ?? null;
  const applying = applyingTo !== null;

  // Adopt an apply that is already running: a reload mid-download must show
  // the update in progress, not an idle button next to a busy server.
  const serverApplying = status?.applyingVersion ?? null;
  useEffect(() => {
    if (serverApplying && !applyingTo) {
      setApplyingTo(serverApplying);
      setApplyError(null);
      startedAtRef.current = Date.now();
      handoverAtRef.current = 0;
      oldVersionSinceRef.current = 0;
      setOpen(true);
    }
  }, [serverApplying, applyingTo]);

  // The server reports its own failures, with the step that failed in the
  // message. Only take the ones from THIS attempt.
  const failedAt = status?.lastApplyErrorAt ?? null;
  const failure = status?.lastApplyError ?? null;
  useEffect(() => {
    if (!applying || !failure || !failedAt) return;
    if (Date.parse(failedAt) < startedAtRef.current - 1_000) return;
    setApplyError(failure);
    setApplyingTo(null);
  }, [applying, failure, failedAt]);

  // Remember when the helper took over: the deadline below only applies from
  // that point, because before it the server is downloading and nothing is
  // wrong however long it takes.
  const state = status?.state;
  useEffect(() => {
    if (state === 'restarting' && !handoverAtRef.current) handoverAtRef.current = Date.now();
  }, [state]);

  // While applying, watch /api/meta: the new version answering is the only
  // proof the update landed, and the old one still answering long after the
  // handover is the proof it was rolled back.
  useEffect(() => {
    if (!applying || !applyingTo) return;
    const timer = setInterval(() => {
      void fetch('/api/meta')
        .then(async (r) => {
          if (!r.ok) return;
          const meta = (await r.json()) as { version: string };
          if (meta.version === applyingTo) {
            location.reload();
            return;
          }
          const handover = handoverAtRef.current;
          if (!handover) return;
          if (!oldVersionSinceRef.current) oldVersionSinceRef.current = Date.now();
          if (Date.now() - oldVersionSinceRef.current > ROLLBACK_GRACE_MS) {
            setApplyError(
              `Version ${applyingTo} did not come up and ${meta.version} is serving again — the update helper rolled it back.`,
            );
            setApplyingTo(null);
          } else if (Date.now() - handover > HANDOVER_DEADLINE_MS) {
            setApplyError(`The update helper never finished installing ${applyingTo}.`);
            setApplyingTo(null);
          }
        })
        .catch(() => {
          // The server is restarting: expected, and it resets the rollback
          // clock — the old build is not "still serving" if nothing answers.
          oldVersionSinceRef.current = 0;
        });
    }, META_POLL_MS);
    return () => clearInterval(timer);
  }, [applying, applyingTo]);

  if (!status) return null;

  const checkNow = () => {
    setChecking(true);
    void api
      .updateCheck()
      .then((s) => queryClient.setQueryData(['update'], s))
      .finally(() => setChecking(false));
  };

  const apply = () => {
    if (!selected) return;
    // Allowed from another machine — it is the one restart that puts itself
    // back — but not silently: the page goes dead for a few seconds while the
    // server it is talking to is replaced, and that reads like a crash unless
    // it was expected.
    if (
      remote &&
      !confirm(
        'Installing an update restarts the server. This page will stop responding for a few seconds and then come back. Continue?',
      )
    ) {
      return;
    }
    applyNow(selected.version);
  };

  /**
   * The apply itself. Split from the question above so the active-sessions
   * dialog can run it again once they are closed, without asking a remote
   * browser the same thing twice.
   */
  const applyNow = (version: string) => {
    setApplyError(null);
    startedAtRef.current = Date.now();
    handoverAtRef.current = 0;
    oldVersionSinceRef.current = 0;
    setApplyingTo(version);
    void api.updateApply(version).catch((e: unknown) => {
      setApplyingTo(null);
      // An update replaces this server, so it is refused while the app is
      // running Claude — the dialog names the sessions and installs once they
      // are closed.
      if (guard.refused(e, () => applyNow(version))) return;
      setApplyError(String(e instanceof Error ? e.message : e));
    });
  };

  const busyLabel = applying ? (STATE_LABEL[status.state] ?? 'Working…') : null;
  const progress = applying ? status.progress : null;
  const percent =
    progress?.totalBytes ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100)) : null;
  const count = available.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
        title={count > 0 ? `${count} new version${count !== 1 ? 's' : ''} available` : 'Check for updates'}
        aria-label="Updates"
      >
        <UpgradeIcon />
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full border-2 border-[var(--bg)] bg-amber-400 px-1 text-[9px] leading-3 font-bold text-black">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20"
          onClick={() => !applying && setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-[620px] max-w-[92vw] flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Updates</h2>
              {count > 0 && (
                <span className="rounded bg-amber-400/15 px-1.5 py-px text-[10px] font-semibold text-amber-400 uppercase">
                  {count} new version{count !== 1 ? 's' : ''}
                </span>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={applying}
                className="ml-auto cursor-pointer rounded px-1.5 text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-40"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1 text-xs">
              <div>
                <span className="text-[var(--text-dim)]">Installed version: </span>
                <span className="font-mono">{status.currentVersion}</span>
                {!status.installed && (
                  <span className="ml-2 text-[var(--text-dim)]">
                    (not a managed install — updates cannot be applied here)
                  </span>
                )}
              </div>
              <div>
                <span className="text-[var(--text-dim)]">Last checked: </span>
                {status.lastCheckAt
                  ? `${formatDateTime(status.lastCheckAt)} (${relativeTime(status.lastCheckAt)})`
                  : 'never'}
                <button
                  type="button"
                  onClick={checkNow}
                  disabled={checking || applying}
                  className="ml-2 cursor-pointer rounded border border-[var(--border)] px-1.5 py-px text-[11px] text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:opacity-40"
                >
                  {checking ? 'Checking…' : 'Check now'}
                </button>
              </div>
              {status.lastError && <div className="text-red-400">Last check failed: {status.lastError}</div>}
            </div>

            {count > 0 ? (
              <>
                <p className="mt-3 mb-1 text-[11px] text-[var(--text-dim)]">
                  Everything you would get, newest first. Pick a version to install — the newest is selected by default.
                </p>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2">
                  {available.map((rel) => {
                    const isSelected = selected?.version === rel.version;
                    return (
                      <label
                        key={rel.version}
                        className={`block cursor-pointer rounded border p-2 ${
                          isSelected ? 'border-[var(--accent-dim)] bg-[var(--accent)]/5' : 'border-transparent'
                        } ${rel.installable ? '' : 'opacity-60'}`}
                      >
                        <div className="flex items-center gap-2 text-xs">
                          <input
                            type="radio"
                            name="update-target"
                            checked={isSelected}
                            disabled={!rel.installable || applying}
                            onChange={() => setTarget(rel.version)}
                            className="accent-[var(--accent)]"
                          />
                          <span className="font-semibold text-amber-400">{rel.tag}</span>
                          <span className="text-[var(--text-dim)]">
                            {rel.publishedAt ? formatDateTime(rel.publishedAt) : ''}
                            {rel.sizeBytes ? ` · ${formatBytes(rel.sizeBytes)}` : ''}
                            {rel.installable ? '' : ' · no installable package'}
                          </span>
                        </div>
                        {rel.notes && (
                          <div className="mt-1 pl-6 text-xs">
                            <Markdown text={stripLeadingTag(rel.notes, rel.tag)} />
                          </div>
                        )}
                      </label>
                    );
                  })}
                </div>
              </>
            ) : (
              !status.lastError &&
              status.lastCheckAt && (
                <div className="mt-3 text-xs text-emerald-400">✓ You are on the latest version.</div>
              )
            )}

            {applyError && (
              <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                <div>{applyError}</div>
                <div className="mt-1 text-[11px] text-red-300/80">
                  Every step of an update is recorded —{' '}
                  <Link to="/logs?src=updates,update-helper" className="underline hover:text-red-200">
                    open the log
                  </Link>{' '}
                  to see exactly where it stopped. Nothing was changed: the version you are running is untouched.
                </div>
              </div>
            )}

            {busyLabel && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                  {busyLabel} The page will reload automatically when the new version is up.
                </div>
                {progress && (
                  <>
                    <div className="h-1 w-full overflow-hidden rounded bg-[var(--border)]">
                      <div
                        className="h-full bg-amber-400 transition-[width] duration-500"
                        style={{ width: percent === null ? '100%' : `${percent}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-[var(--text-dim)]">{describeProgress(progress)}</div>
                  </>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-1.5">
              {count > 0 && (
                <button
                  type="button"
                  onClick={apply}
                  disabled={!status.installed || applying || !selected?.installable}
                  title={status.installed ? undefined : 'This instance is not a managed install'}
                  className="cursor-pointer rounded border border-[var(--accent-dim)] px-3 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:cursor-default disabled:opacity-40"
                >
                  {applying ? 'Updating…' : `Update to ${selected?.tag ?? ''}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={applying}
                className="cursor-pointer rounded border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:opacity-40"
              >
                {count > 0 ? 'Cancel' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
