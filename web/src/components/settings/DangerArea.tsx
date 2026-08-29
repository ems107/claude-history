import { useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocalOnly } from '../../api/useLocal.ts';
import { useActiveSessionsGuard } from '../ActiveSessionsDialog.tsx';
import { actionClass } from '../controlClass.ts';
import { useSettingsPage } from './context.ts';
import { Anchored, GroupCard } from './controls.tsx';
import { UninstallDialog } from './UninstallDialog.tsx';

/**
 * The two buttons that do not undo themselves.
 *
 * They used to sit in a `flex-wrap` beside *Open data folder* — the same row,
 * the same size, a red border the only thing between "show me a folder" and
 * "remove the application". An area of their own is the fix: you arrive here on
 * purpose, and there is nothing else on the page to hit by accident.
 *
 * Both are also local-only (`stopServer`, `uninstall`), which is the other
 * reason they belong together: over remote access this whole area is one
 * explanation rather than two greyed buttons in the middle of something else.
 */
export function DangerArea() {
  const { dev, meta } = useSettingsPage();
  const guard = useActiveSessionsGuard();
  const stopServer = useLocalOnly('stopServer');
  const uninstall = useLocalOnly('uninstall');
  const [stopped, setStopped] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /**
   * Stop the server, and be able to do it again.
   *
   * Named rather than written into the button because both refusals it can meet
   * are worth retrying: an update finishing, or the sessions in the dialog being
   * closed from it — and the dialog needs the same closure to run again.
   */
  const stopNow = () => {
    setStopped(true);
    void api.stopServer().catch((e: unknown) => {
      setStopped(false);
      if (guard.refused(e, stopNow)) return;
      setNote(String(e instanceof Error ? e.message : e));
    });
  };

  return (
    <>
      <GroupCard id="danger">
        <Anchored id="act-stop-server" className="space-y-1">
          <button
            type="button"
            className={`${actionClass} border-red-500/40 text-red-300 hover:border-red-400`}
            disabled={stopped || stopServer.disabled}
            title={stopServer.reason ?? undefined}
            onClick={() => {
              // Whichever instance this page belongs to is the one that exits —
              // the request goes to the port it was served from — so the way
              // back differs: the release has a shortcut and a task, the dev
              // instance has dev.ps1 and nothing else.
              const question = dev
                ? 'Stop the dev server? This page will stop working until you start it again with dev.ps1. The installed release on 7433 is not affected.'
                : 'Stop the claude-history server? This page will stop working until you start it again from the Start Menu shortcut or Task Scheduler.';
              if (!confirm(question)) return;
              // The server refuses while an update is being installed — stopping
              // would abort the download and lose it — and while it is running
              // Claude, which answers with a dialog.
              stopNow();
            }}
          >
            {stopped ? 'Stopping…' : 'Stop server'}
          </button>
          <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            Ends this server. It refuses while an update is being installed, and while the app is running Claude — each
            of those would lose something that cannot be got back.
          </p>
        </Anchored>

        <Anchored id="act-uninstall" className="space-y-1 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            className={`${actionClass} border-red-500/40 text-red-300 hover:border-red-400`}
            disabled={!meta.paths.installRoot || stopped || uninstall.disabled}
            title={uninstall.reason ?? meta.paths.installRoot ?? 'Not a managed install — nothing to uninstall'}
            onClick={() => setUninstalling(true)}
          >
            Uninstall
          </button>
          <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            Removes the scheduled task, the Start Menu shortcut and the install folder, and asks whether your own data
            should go with them. Your Claude conversations are never touched — this tool only ever reads them.
          </p>
        </Anchored>

        {stopped && (
          <p className="text-[11px] text-amber-400">
            {dev ? (
              <>
                Dev server stopping. Start it again with <span className="font-mono">.\dev.ps1</span> in the repo. The
                installed release on 7433 goes on running.
              </>
            ) : (
              <>
                Server stopping. Start it again with the claude-history shortcut in the Start Menu, or from Task
                Scheduler (task “claude-history” → Run).
              </>
            )}
          </p>
        )}
        {note && <p className="text-[11px] text-[var(--text-dim)]">{note}</p>}
      </GroupCard>

      {uninstalling && <UninstallDialog onClose={() => setUninstalling(false)} />}
    </>
  );
}
