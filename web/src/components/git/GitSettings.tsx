import type { GitRepoRoot } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { gitApi } from '../../api/git.ts';
import { relativeTime } from '../../lib/format.ts';
import { btn, inputClass } from '../../lib/ui.ts';

/**
 * Where the GIT tab looks for repositories.
 *
 * The picker can add one in passing; this is where the lists are actually
 * managed. Kept out of SettingsPage.tsx for the same reason the retention panel
 * is: that file is long enough, and this owns its own data.
 */
export function GitSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['git', 'repos'], queryFn: () => gitApi.overview() });
  const [draft, setDraft] = useState('');
  const [rootDraft, setRootDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['git'] });

  const run = (work: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work
      .then(() => {
        setDraft('');
        setRootDraft('');
        refresh();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const list = (entries: GitRepoRoot[], asRoot: boolean) =>
    entries.map((entry) => (
      <div key={entry.path} className="group flex items-center gap-2 py-0.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={entry.path}>
          {entry.path}
        </span>
        {asRoot && (
          <span
            className={`shrink-0 text-[10px] ${entry.found === 0 ? 'text-amber-400' : 'text-[var(--text-dim)]'}`}
            title="Repositories found under it on the last scan"
          >
            {entry.found} found
          </span>
        )}
        {entry.error && (
          <span className="shrink-0 text-[10px] text-red-400" title={entry.error}>
            {entry.error}
          </span>
        )}
        {entry.addedAt && (
          <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{relativeTime(entry.addedAt)}</span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => run(gitApi.removePath(entry.path, asRoot))}
          className="shrink-0 cursor-pointer px-1 text-[10px] text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:text-red-300"
          title="Remove from the list. Nothing on disk is touched."
        >
          remove
        </button>
      </div>
    ));

  if (isLoading) return <p className="text-[var(--text-dim)]">Reading…</p>;
  if (data && !data.available) return <p className="text-red-400">{data.error}</p>;

  const visible = data?.repos.filter((r) => !r.hidden).length ?? 0;
  const hidden = data?.repos.filter((r) => r.hidden).length ?? 0;

  return (
    <>
      <div>
        <p className="mb-1 text-[10px] tracking-wider text-[var(--text-dim)] uppercase">Folders to scan</p>
        {(data?.scanRoots.length ?? 0) === 0 ? (
          <p className="text-[var(--text-dim)] italic">
            None yet. One root covering where you keep your clones is usually all it takes — every repository up to
            two levels inside it is picked up.
          </p>
        ) : (
          list(data?.scanRoots ?? [], true)
        )}
        <div className="mt-1 flex gap-1.5">
          <input
            type="text"
            spellCheck={false}
            value={rootDraft}
            placeholder="C:\Users\you\Git"
            onChange={(e) => setRootDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rootDraft.trim()) run(gitApi.addPath(rootDraft, true));
            }}
            className={`${inputClass} font-mono text-[11px]`}
          />
          <button
            type="button"
            disabled={busy || !rootDraft.trim()}
            onClick={() => run(gitApi.addPath(rootDraft, true))}
            className={btn}
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] tracking-wider text-[var(--text-dim)] uppercase">Individual repositories</p>
        {(data?.manual.length ?? 0) === 0 ? (
          <p className="text-[var(--text-dim)] italic">None. Add one for a repository that sits outside your roots.</p>
        ) : (
          list(data?.manual ?? [], false)
        )}
        <div className="mt-1 flex gap-1.5">
          <input
            type="text"
            spellCheck={false}
            value={draft}
            placeholder="C:\Users\you\Git\my-project"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) run(gitApi.addPath(draft, false));
            }}
            className={`${inputClass} font-mono text-[11px]`}
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => run(gitApi.addPath(draft, false))}
            className={btn}
          >
            Add
          </button>
        </div>
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => run(gitApi.refreshRepos())} className={btn}>
          {busy ? 'Scanning…' : 'Rescan now'}
        </button>
        <span className="text-[11px] text-[var(--text-dim)]">
          {visible} repositor{visible === 1 ? 'y' : 'ies'}
          {hidden > 0 && `, ${hidden} hidden`}
          {data?.scannedAt && ` · scanned ${relativeTime(data.scannedAt)}`}
        </span>
        <Link to="/git" className="ml-auto text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]">
          Open the Git tab →
        </Link>
      </div>

      <p className="text-[11px] text-[var(--text-dim)]">
        Folders Claude Code has run in are picked up on their own. Adding a path that sits inside a checkout stores
        the checkout itself, and removing an entry here only takes it off this list — nothing on disk is touched.
      </p>
    </>
  );
}
