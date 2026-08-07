import type { UpdateRelease } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { formatBytes, formatDateTime, relativeTime } from '../lib/format.ts';
import { Markdown } from './viewer/Markdown.tsx';

const STATE_LABEL: Record<string, string> = {
  checking: 'Checking…',
  downloading: 'Downloading update…',
  verifying: 'Verifying download…',
  staging: 'Extracting new version…',
  restarting: 'Restarting…',
};

/** Arrow rising out of a line — "upgrade", as opposed to a refresh circle. */
function UpgradeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 11V2.5" />
      <path d="M4.5 6 8 2.5 11.5 6" />
      <path d="M3 13.5h10" />
    </svg>
  );
}

/**
 * Header update button: shows a badge when newer releases exist (the server
 * checks GitHub every 10 minutes; SSE keeps this fresh). The popup lists
 * every version newer than the running one with its notes, so the user sees
 * the whole set of changes and picks which one to install.
 */
export function UpdateButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  const { data: status } = useQuery({ queryKey: ['update'], queryFn: api.updateStatus });

  const available: UpdateRelease[] = status?.available ?? [];
  const selected = available.find((r) => r.version === target) ?? available[0] ?? null;

  // While an update applies, the server goes down and comes back as the new
  // version: poll /api/meta and reload when the target version answers.
  const targetVersion = selected?.version;
  useEffect(() => {
    if (!applying || !targetVersion) return;
    const t0 = Date.now();
    const iv = setInterval(() => {
      void fetch('/api/meta')
        .then(async (r) => {
          if (!r.ok) return;
          const meta = (await r.json()) as { version: string };
          if (meta.version === targetVersion) {
            location.reload();
          } else if (Date.now() - t0 > 150_000) {
            setApplyError(
              'The update did not complete — the previous version is still running. See update.log in the install folder.',
            );
            setApplying(false);
          }
        })
        .catch(() => undefined); // server restarting — keep polling
    }, 1_500);
    return () => clearInterval(iv);
  }, [applying, targetVersion]);

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
    setApplyError(null);
    setApplying(true);
    void api.updateApply(selected.version).catch((e) => {
      setApplyError(String(e instanceof Error ? e.message : e));
      setApplying(false);
    });
  };

  const busyLabel = applying ? (STATE_LABEL[status.state] ?? 'Restarting…') : null;
  const count = available.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative ml-auto cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
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
                            <Markdown text={rel.notes} />
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
                {applyError}
              </div>
            )}

            {busyLabel && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-400">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                {busyLabel} The page will reload automatically when the new version is up.
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
