import type { UserdataBackup } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { useActiveSessionsGuard } from '../ActiveSessionsDialog.tsx';
import { actionClass } from '../controlClass.ts';
import { Anchored, Explain, Readout, ReadoutRow } from './controls.tsx';

/** Bytes, in the two digits that mean something at these sizes. */
function size(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Why a copy exists, in the words that answer "can I throw this away".
 *
 * The reason is stored in the file name, so an unknown one is possible — a copy
 * from a future version, or one renamed by hand. It is shown as it stands rather
 * than hidden: this list is also what you read from the file manager when
 * everything else has failed.
 */
function reasonLabel(reason: string): string {
  if (reason === 'initial') return 'first copy on this machine';
  if (reason === 'daily') return 'first change of the day';
  if (reason === 'manual') return 'taken by hand';
  if (reason === 'pre-loss') return 'before a write that emptied something';
  if (reason === 'pre-restore') return 'before a restore';
  if (reason.startsWith('pre-update-')) return `before updating to ${reason.slice('pre-update-'.length)}`;
  if (reason.startsWith('version-')) return `first run of ${reason.slice('version-'.length)}`;
  return reason;
}

/** What restoring it would bring back. */
function contentsLabel(contents: UserdataBackup['contents']): string {
  if (!contents) return 'unreadable — it was taken from a file that was already broken';
  const parts = [
    `${String(contents.titleOverrides)} ${contents.titleOverrides === 1 ? 'rename' : 'renames'}`,
    `${String(contents.pins)} ${contents.pins === 1 ? 'pin' : 'pins'}`,
    `${String(contents.stars)} ${contents.stars === 1 ? 'star' : 'stars'}`,
  ];
  if (contents.hasPrices) parts.push('own prices');
  if (!contents.hasSettings) parts.push('no settings');
  return parts.join(' · ');
}

/**
 * The dated copies of `userdata.json`, and putting one back.
 *
 * This is the only screen in the app that can overwrite every rename, pin, star,
 * price and setting at once, so restoring asks first and says exactly what the
 * chosen copy holds — a list of timestamps alone would make it a guess.
 */
export function BackupsPanel() {
  const queryClient = useQueryClient();
  const guard = useActiveSessionsGuard();
  const { data, isFetching } = useQuery({ queryKey: ['userdataBackups'], queryFn: api.userdataBackups });
  /** Which copy is waiting for a yes, so the confirmation sits on its own row. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['userdataBackups'] });

  const takeOne = () => {
    setBusy(true);
    setError(null);
    api
      .createUserdataBackup()
      .then((name) => setNote(name ? `Kept ${name}.` : 'Nothing has changed since the newest copy, so none was taken.'))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };

  const restore = (name: string) => {
    setBusy(true);
    setError(null);
    setConfirming(null);
    api
      .restoreUserdata(name)
      .then((r) => {
        setNote(
          `Restored from ${r.restoredFrom}.` +
            (r.backedUpTo ? ` What it replaced was kept as ${r.backedUpTo}.` : ''),
        );
        // The server announces a restore over SSE and every window follows,
        // this one included — these are for the case where that stream is down.
        for (const key of ['settings', 'prices', 'sessions', 'projects', 'prompts', 'stars']) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      })
      .catch((err: unknown) => {
        // A restore replaces `chatEnabled` and `chatMode` along with everything
        // else, so it is refused while the app is running Claude — with the
        // dialog that lists them and restores once they are closed.
        if (guard.refused(err, () => restore(name))) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };

  if (!data) return <p className="text-[var(--text-dim)]">Reading the copies…</p>;

  return (
    <>
      {data.recovered && (
        <p className="rounded border border-amber-500/40 px-2 py-1.5 text-amber-300">
          This start-up found <span className="font-mono">userdata.json</span> unreadable and restored{' '}
          <span className="font-mono break-all">{data.recovered.from}</span> ({relativeTime(data.recovered.at)}). The
          broken file was kept beside it as <span className="font-mono">userdata.json.corrupt-…</span>; the log says
          what would not parse.
        </p>
      )}

      <Anchored id="act-backup-now" className="flex items-center gap-2">
        <button type="button" onClick={takeOne} disabled={busy} className={actionClass}>
          Back up now
        </button>
        <button type="button" onClick={refresh} disabled={isFetching} className={actionClass}>
          {isFetching ? 'Reading…' : 'Refresh'}
        </button>
        <span className="text-[11px] text-[var(--text-dim)]">
          {data.backups.length} {data.backups.length === 1 ? 'copy' : 'copies'} kept
        </span>
      </Anchored>

      {/* The folder is a readout, not something crowding the end of a button
          row: at a narrow width that path used to push the buttons together and
          then wrap under them. */}
      <Readout>
        <ReadoutRow label="folder">{data.backupsDir}</ReadoutRow>
      </Readout>

      {note && <p className="text-[var(--text-dim)]">{note}</p>}
      {error && <p className="rounded border border-red-500/40 px-2 py-1.5 text-red-300">{error}</p>}

      {data.backups.length === 0 ? (
        <p className="text-[var(--text-dim)]">
          No copies yet. The first one is taken the next time anything in that file changes.
        </p>
      ) : (
        <ul id="act-restore" className="scroll-mt-16 divide-y divide-[var(--border)]">
          {data.backups.map((b, i) => (
            <li key={b.name} className="py-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono">{formatDateTime(b.at)}</span>
                <span className="text-[var(--text-dim)]">{reasonLabel(b.reason)}</span>
                {i === 0 && <span className="text-[11px] text-[var(--accent)]">newest</span>}
                <span className="ml-auto text-[11px] text-[var(--text-dim)]">{size(b.sizeBytes)}</span>
                {confirming === b.name ? (
                  <>
                    <button type="button" onClick={() => restore(b.name)} disabled={busy} className={`${actionClass} border-amber-500/60 text-amber-300`}>
                      Replace everything
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className={actionClass}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(b.name)}
                    // A copy that does not parse has nothing to put back.
                    disabled={busy || b.contents === null}
                    className={actionClass}
                    title={
                      b.contents === null
                        ? 'This copy is unreadable — there is nothing in it to restore'
                        : `Replace everything with this copy (${b.name})`
                    }
                  >
                    Restore
                  </button>
                )}
              </div>
              <div className={`text-[11px] ${b.contents === null ? 'text-red-300' : 'text-[var(--text-dim)]'}`}>
                {contentsLabel(b.contents)}
              </div>
              {confirming === b.name && (
                <div className="mt-1 text-[11px] text-amber-300">
                  Everything currently in the file is replaced by this copy, in every open window. What it replaces is
                  kept as a new copy first, so you can come back here and undo it.
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* At the foot rather than at the head, where it used to be: what you come
          to this group for is the list of copies and the button that takes one,
          and four lines about which file this is stood in front of both. */}
      <Explain label="What is in this file, and when a copy is taken">
        <p>
          Renames, pins, starred messages, your price table and these settings all live in one file, and it is the only
          thing here that cannot be rebuilt from <span className="font-mono">~/.claude</span>. A dated copy is kept on
          the first change of each day, whenever the version changes, before an update, and before any write that would
          empty one of those lists — never two copies of the same bytes.
        </p>
      </Explain>
    </>
  );
}
