import { isProtectedBranch, type GitRemote, type GitStatus } from '@claude-history/shared';
import { useState } from 'react';
import { btn, dangerBtn, inputClass } from '../../lib/ui.ts';

/**
 * Push, with the choices that change what happens made visible.
 *
 * Force is `--force-with-lease` and nothing else — the label says so, because
 * the difference between it and `--force` is the difference between overwriting
 * your own mistake and overwriting somebody else's work, and a button labelled
 * just "force" hides that. A branch whose name usually means "shared" asks you
 * to type it, which is the same speed bump the delete dialog uses.
 */
export function PushDialog({
  status,
  remotes,
  busy,
  onPush,
  onCancel,
}: {
  status: GitStatus;
  remotes: GitRemote[];
  busy: boolean;
  onPush: (body: { remote: string; setUpstream: boolean; forceWithLease: boolean; tags: boolean; confirm: boolean }) => void;
  onCancel: () => void;
}) {
  const [remote, setRemote] = useState(remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name ?? 'origin');
  const [force, setForce] = useState(false);
  const [tags, setTags] = useState(false);
  const [typed, setTyped] = useState('');

  const branch = status.branch;
  const needsUpstream = !status.upstream;
  const protectedName = !!branch && isProtectedBranch(branch);
  const needsTyping = force && protectedName;
  const ready = !!branch && (!needsTyping || typed === branch);

  const command = [
    'git push',
    needsUpstream ? '--set-upstream' : null,
    force ? '--force-with-lease' : null,
    tags ? '--tags' : null,
    remote,
    branch,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-32" onClick={() => !busy && onCancel()}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-[520px] max-w-[92vw] rounded-lg border bg-[var(--bg-raised)] p-4 shadow-xl ${
          force ? 'border-red-500/40' : 'border-[var(--border)]'
        }`}
      >
        <h2 className="text-sm font-semibold">Push {branch ?? 'HEAD'}</h2>

        {!branch ? (
          <p className="mt-2 text-xs text-amber-400">HEAD is detached — check out a branch before pushing.</p>
        ) : (
          <div className="mt-3 space-y-2 text-xs">
            <label className="flex items-center gap-2">
              <span className="w-16 text-[var(--text-dim)]">Remote</span>
              <select
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
                className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5"
              >
                {remotes.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} — {r.pushUrl || r.fetchUrl}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-[var(--text-dim)]">
              {needsUpstream ? (
                <>
                  This branch is not on {remote} yet, so it will be published and start tracking it.
                </>
              ) : (
                <>
                  {status.ahead} commit{status.ahead === 1 ? '' : 's'} to send
                  {status.behind > 0 && (
                    <span className="text-amber-400">
                      {' '}
                      — and {status.behind} to receive first, so this will be rejected unless you force it
                    </span>
                  )}
                  .
                </>
              )}
            </p>

            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" checked={tags} onChange={(e) => setTags(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>
                Send tags too
                <span className="block text-[10px] text-[var(--text-dim)]">Every tag you have that the remote does not.</span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="mt-0.5 accent-red-400" />
              <span>
                Force, with lease
                <span className="block text-[10px] text-[var(--text-dim)]">
                  Overwrites what is on the remote with what you have. It still refuses if the remote moved since your
                  last fetch, so it cannot silently discard somebody else's work — but it will discard yours.
                </span>
              </span>
            </label>

            {force && protectedName && (
              <label className="block">
                <span className="text-[var(--text-dim)]">
                  <span className="font-mono text-[var(--text)]">{branch}</span> is a branch other people usually share.
                  Type its name to confirm.
                </span>
                <input
                  type="text"
                  value={typed}
                  spellCheck={false}
                  onChange={(e) => setTyped(e.target.value)}
                  className={`${inputClass} mt-1 font-mono text-[11px]`}
                />
              </label>
            )}

            <pre className="overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-[var(--text)]/80">
              {command}
            </pre>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-1.5">
          <button type="button" onClick={onCancel} className={btn} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            className={force ? dangerBtn : btn}
            onClick={() => onPush({ remote, setUpstream: needsUpstream, forceWithLease: force, tags, confirm: force })}
          >
            {busy ? 'Pushing…' : force ? 'Force push' : 'Push'}
          </button>
        </div>
      </div>
    </div>
  );
}
