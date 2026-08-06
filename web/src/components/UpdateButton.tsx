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

/**
 * Header update button: shows a dot when a newer release exists (the server
 * checks GitHub every 10 minutes; SSE keeps this fresh). Clicking opens an
 * informative popup — updating always requires explicit confirmation here.
 */
export function UpdateButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const { data: status } = useQuery({ queryKey: ['update'], queryFn: api.updateStatus });

  // While an update applies, the server goes down and comes back as the new
  // version: poll /api/meta and reload when the target version answers.
  const targetVersion = status?.latest?.version;
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
            // The old version answered long past the helper's rollback window.
            setApplyError('The update did not complete — the previous version is still running. See update.log in the install folder.');
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
    setApplyError(null);
    setApplying(true);
    void api.updateApply().catch((e) => {
      setApplyError(String(e instanceof Error ? e.message : e));
      setApplying(false);
    });
  };

  const busyLabel = applying
    ? STATE_LABEL[status.state] ?? 'Restarting…'
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative ml-auto cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-sm text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
        title={status.updateAvailable ? `Update available: ${status.latest?.tag}` : 'Check for updates'}
      >
        ⟳
        {status.updateAvailable && (
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg)] bg-amber-400" />
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24"
          onClick={() => !applying && setOpen(false)}
        >
          <div
            className="w-[560px] max-w-[90vw] rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Updates</h2>
              {status.updateAvailable && (
                <span className="rounded bg-amber-400/15 px-1.5 py-px text-[10px] font-semibold text-amber-400 uppercase">
                  update available
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
                  <span className="ml-2 text-[var(--text-dim)]">(running from source — updates cannot be applied here)</span>
                )}
              </div>
              <div>
                <span className="text-[var(--text-dim)]">Last checked: </span>
                {status.lastCheckAt ? `${formatDateTime(status.lastCheckAt)} (${relativeTime(status.lastCheckAt)})` : 'never'}
                <button
                  type="button"
                  onClick={checkNow}
                  disabled={checking || applying}
                  className="ml-2 cursor-pointer rounded border border-[var(--border)] px-1.5 py-px text-[11px] text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:opacity-40"
                >
                  {checking ? 'Checking…' : 'Check now'}
                </button>
              </div>
              {status.lastError && (
                <div className="text-red-400">Last check failed: {status.lastError}</div>
              )}
            </div>

            {status.updateAvailable && status.latest ? (
              <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="mb-1 text-xs">
                  <span className="font-semibold text-amber-400">{status.latest.tag}</span>
                  <span className="ml-2 text-[var(--text-dim)]">
                    {status.latest.publishedAt ? `published ${formatDateTime(status.latest.publishedAt)}` : ''}
                    {status.latest.sizeBytes ? ` · ${formatBytes(status.latest.sizeBytes)}` : ''}
                  </span>
                </div>
                {status.latest.notes && (
                  <div className="max-h-56 overflow-y-auto text-xs">
                    <Markdown text={status.latest.notes} />
                  </div>
                )}
              </div>
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
              {status.updateAvailable && (
                <button
                  type="button"
                  onClick={apply}
                  disabled={!status.installed || applying}
                  title={status.installed ? undefined : 'This instance runs from source — pull and rebuild instead'}
                  className="cursor-pointer rounded border border-[var(--accent-dim)] px-3 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:cursor-default disabled:opacity-40"
                >
                  {applying ? 'Updating…' : `Update to ${status.latest?.tag}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={applying}
                className="cursor-pointer rounded border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:opacity-40"
              >
                {status.updateAvailable ? 'Cancel' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
