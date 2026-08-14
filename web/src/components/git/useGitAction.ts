import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { GitMutationResponse } from '@claude-history/shared';

/**
 * The app's mutation pattern, factored once for the twenty buttons in this tab.
 *
 * Not `useMutation`: it is used nowhere in this codebase, and the reason it has
 * never been needed is that the pattern is four lines — call, catch into local
 * state, invalidate on the way out. Twenty buttons each with their own
 * `useState` triple is what justifies a hook, not a dependency.
 *
 * Errors are kept verbatim, because every refusal on the server was written to
 * be read by a person: "1 file is still conflicted — resolve it, then stage it"
 * is the answer, and replacing it with "409" would throw away the whole point
 * of computing it.
 */
export function useGitAction(repoId: string | null): {
  busy: boolean;
  error: string | null;
  note: string | null;
  clear: () => void;
  run: (work: () => Promise<GitMutationResponse | void>) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = useCallback(
    async (work: () => Promise<GitMutationResponse | void>) => {
      setBusy(true);
      setError(null);
      setNote(null);
      try {
        const result = await work();
        // The response already carries the fresh status; putting it straight
        // into the cache means the page updates before the refetch lands.
        if (result && repoId) {
          queryClient.setQueryData(['git', 'status', repoId], result.status);
          if (result.message) setNote(result.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        // Everything else this could have moved: branches, the graph, the log.
        void queryClient.invalidateQueries({ queryKey: ['git'] });
      }
    },
    [queryClient, repoId],
  );

  return { busy, error, note, clear: () => setError(null), run };
}
