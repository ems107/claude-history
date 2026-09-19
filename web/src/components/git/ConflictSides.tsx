import { useQuery } from '@tanstack/react-query';
import { gitApi } from '../../api/git.ts';

/**
 * The three versions git is holding of a conflicted file.
 *
 * Diffing a conflicted file shows the merge markers as content, which is the
 * one thing a person looking at it does not need. These are the actual stages:
 * the common ancestor, what this branch had, and what the other one had. Any of
 * them can be missing — a file added on one side has no ancestor at all, and
 * saying "not in this version" is more use than an empty box.
 *
 * There is no editor here on purpose. Conflicts are resolved outside the app;
 * this is for understanding what you are about to resolve.
 */
function Side({ title, hint, text }: { title: string; hint: string; text: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded border border-[var(--border)]">
      <div className="border-b border-[var(--border)] bg-[var(--bg-raised)]/60 px-2 py-1">
        <p className="text-[11px] font-semibold">{title}</p>
        <p className="text-[10px] text-[var(--text-dim)]">{hint}</p>
      </div>
      {text === null ? (
        <p className="p-2 text-[11px] text-[var(--text-dim)] italic">Not in this version.</p>
      ) : (
        <pre className="max-h-80 overflow-auto p-2 font-mono text-[11px] whitespace-pre">{text}</pre>
      )}
    </div>
  );
}

export function ConflictSides({ repoId, path: filePath }: { repoId: string; path: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['git', 'conflict', repoId, filePath],
    queryFn: () => gitApi.conflictSides(repoId, filePath),
  });

  if (isLoading) return <p className="text-[11px] text-[var(--text-dim)]">Reading the three versions…</p>;
  if (isError) return <p className="text-[11px] text-red-400">Could not read them: {String(error)}</p>;
  if (!data) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-amber-300">
        <span className="font-mono">{filePath}</span> is conflicted. Below are the three versions git is holding.
      </p>
      <div className="flex flex-wrap gap-2">
        <Side title="Ours" hint="What this branch had" text={data.ours} />
        <Side title="Theirs" hint="What the other side had" text={data.theirs} />
        <Side title="Base" hint="What they both started from" text={data.base} />
      </div>
      <p className="text-[11px] text-[var(--text-dim)]">
        Edit the file outside this app — the working copy has the markers in it — then stage it here to mark it
        resolved.
      </p>
    </div>
  );
}
