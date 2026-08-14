import type { GitOverview, GitRepo } from '@claude-history/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { gitApi } from '../../api/git.ts';
import { btn, inputClass } from '../../lib/ui.ts';

/**
 * Which repository the tab is looking at, and the quickest way to add one.
 *
 * The dropdown recipe is the app's existing one (ViewButton / ExportButton):
 * a relatively-positioned wrapper, an absolutely-positioned panel, and an
 * outside-click listener on `document` that only exists while it is open.
 */
export function RepoPicker({
  overview,
  repoId,
  onPick,
  onChanged,
  busy,
}: {
  overview: GitOverview | undefined;
  repoId: string | null;
  onPick: (id: string) => void;
  onChanged: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [asRoot, setAsRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const repos = (overview?.repos ?? []).filter((r) => !r.hidden);
  const current = repos.find((r) => r.id === repoId) ?? null;

  const add = () => {
    const path = draft.trim();
    if (!path) return;
    setWorking(true);
    setError(null);
    gitApi
      .addPath(path, asRoot)
      .then(() => {
        setDraft('');
        setAdding(false);
        onChanged();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setWorking(false));
  };

  const hide = (repo: GitRepo) => {
    setWorking(true);
    gitApi
      .setHidden(repo.id, true)
      .then(onChanged)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setWorking(false));
  };

  return (
    <div ref={wrap} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={busy}
        title={current?.path ?? 'Choose a repository'}
        className={`${btn} flex max-w-[26rem] items-center gap-1.5 text-[var(--text)]`}
      >
        <span className="text-[var(--text-dim)]">▾</span>
        <span className="truncate font-medium">{current?.name ?? 'Choose a repository…'}</span>
        {current && <span className="truncate font-mono text-[10px] text-[var(--text-dim)]">{current.path}</span>}
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-[70vh] w-[34rem] overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-raised)] p-2 text-xs shadow-xl">
          {repos.length === 0 && (
            <p className="px-1 py-2 text-[var(--text-dim)]">
              No repositories yet. Add a folder to scan — one root covering where you keep your clones is usually
              all it takes.
            </p>
          )}

          {repos.map((repo) => (
            <div
              key={repo.id}
              className={`group flex items-center gap-2 rounded px-1.5 py-1 ${
                repo.id === repoId ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]/60'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onPick(repo.id);
                  setOpen(false);
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 text-left"
              >
                <span className="shrink-0 font-medium text-[var(--text)]">{repo.name}</span>
                {repo.currentBranch && (
                  <span className="shrink-0 font-mono text-[10px] text-[var(--accent)]">⎇ {repo.currentBranch}</span>
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-dim)]" title={repo.path}>
                  {repo.path}
                </span>
              </button>
              {repo.siblings.length > 0 && (
                <span
                  className="shrink-0 rounded bg-sky-500/10 px-1 text-[10px] text-sky-300"
                  title={`${repo.siblings.length} other clone${repo.siblings.length === 1 ? '' : 's'} of the same remote`}
                >
                  +{repo.siblings.length}
                </span>
              )}
              <span
                className="shrink-0 text-[10px] text-[var(--text-dim)]"
                title={
                  repo.origins.includes('scan')
                    ? 'Found under a scan root'
                    : repo.origins.includes('manual')
                      ? 'Added by hand'
                      : 'A folder Claude Code has run in'
                }
              >
                {repo.origins.includes('manual') ? 'added' : repo.origins.includes('scan') ? 'scanned' : 'project'}
              </span>
              <button
                type="button"
                onClick={() => hide(repo)}
                title="Hide this repository from the list (nothing is deleted)"
                className="shrink-0 cursor-pointer px-1 text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:text-[var(--text)]"
              >
                ✕
              </button>
            </div>
          ))}

          <div className="mt-2 border-t border-[var(--border)] pt-2">
            {adding ? (
              <div className="space-y-1.5">
                <input
                  autoFocus
                  type="text"
                  spellCheck={false}
                  value={draft}
                  placeholder={asRoot ? 'C:\\Users\\you\\Git' : 'C:\\Users\\you\\Git\\my-project'}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') add();
                    if (e.key === 'Escape') {
                      setAdding(false);
                      setError(null);
                    }
                  }}
                  className={`${inputClass} font-mono text-[11px]`}
                />
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={asRoot}
                    onChange={(e) => setAsRoot(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  <span>
                    This is a folder to scan, not a repository
                    <span className="block text-[10px] text-[var(--text-dim)]">
                      Every repository up to two levels inside it is picked up.
                    </span>
                  </span>
                </label>
                {error && <p className="text-[11px] text-red-400">{error}</p>}
                <div className="flex gap-1.5">
                  <button type="button" onClick={add} disabled={working || !draft.trim()} className={btn}>
                    {working ? 'Adding…' : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setError(null);
                    }}
                    className={btn}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setAdding(true)} className={btn}>
                  + Add a folder…
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => {
                    setWorking(true);
                    gitApi
                      .refreshRepos()
                      .then(onChanged)
                      .catch(() => undefined)
                      .finally(() => setWorking(false));
                  }}
                  className={btn}
                  title="Walk the scan roots again"
                >
                  {working ? 'Scanning…' : 'Rescan'}
                </button>
                <Link
                  to="/settings#git"
                  onClick={() => setOpen(false)}
                  className="ml-auto text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
                >
                  Manage in Settings →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
