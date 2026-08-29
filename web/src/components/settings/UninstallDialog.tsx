import { useState } from 'react';
import { api } from '../../api/client.ts';
import { actionClass } from '../controlClass.ts';
import { useSettingsPage } from './context.ts';

/**
 * Removing the app, and saying exactly what that takes with it.
 *
 * A dialog rather than a button with a `confirm()` because there is a CHOICE
 * inside it — whether your own data goes too — and a browser's confirm box
 * cannot hold one. It lists what it removes before asking, and states the thing
 * that is true whatever you tick: nothing in `~/.claude` is ever touched.
 */
export function UninstallDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useSettingsPage();
  const [wipeData, setWipeData] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-32">
      <div className="w-[520px] max-w-[92vw] rounded-lg border border-red-500/40 bg-[var(--bg-raised)] p-4 shadow-xl">
        <h2 className="mb-2 text-sm font-semibold text-red-300">Uninstall claude-history</h2>
        {done ? (
          <p className="text-xs">
            Uninstalling. The server is stopping and the app is being removed — this page will stop responding in a few
            seconds. Nothing in <span className="font-mono">~/.claude</span> is ever touched.
          </p>
        ) : (
          <>
            <p className="text-xs">This removes:</p>
            <ul className="mt-1 list-inside list-disc text-xs text-[var(--text-dim)]">
              <li>the scheduled task that starts it at logon, and the Start Menu shortcut</li>
              <li>
                the install folder <span className="font-mono">{meta.paths.installRoot}</span>
              </li>
            </ul>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={wipeData}
                onChange={(e) => setWipeData(e.target.checked)}
                className="mt-0.5 accent-red-400"
              />
              <span>
                Also delete my data — renames, pins, starred messages, prices, settings and cache
                <span className="block font-mono text-[11px] text-[var(--text-dim)]">{meta.paths.userdataFile}</span>
              </span>
            </label>
            <p className="mt-2 text-[11px] text-[var(--text-dim)]">
              Your Claude conversations are never touched — this tool only ever reads them.
            </p>
          </>
        )}
        {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-1.5">
          {!done && (
            <button
              type="button"
              className={`${actionClass} border-red-500/50 text-red-300 hover:border-red-400`}
              onClick={() => {
                setDone(true);
                void api.uninstall(wipeData).catch((e: unknown) => setError(`Uninstall failed: ${String(e)}`));
              }}
            >
              {wipeData ? 'Uninstall and delete data' : 'Uninstall'}
            </button>
          )}
          <button type="button" className={actionClass} onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
