import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { GitMutationResponse } from '@claude-history/shared';
import { GitRequestError } from '../../api/git.ts';

/**
 * What is happening right now, for the strip that says so.
 *
 * It is state rather than a spinner inside a button on purpose: a button can
 * say "something is going on" and nothing more, and the three questions
 * actually being asked while a fetch runs are *what* is running, *how long* it
 * has been running, and *how do I stop it*. None of those fit in a control the
 * width of the word Fetch.
 */
export interface GitActivity {
  /**
   * Which control this belongs to — `fetch`, `pull`, `push`.
   *
   * Separate from `what` because `what` is prose and prose is not an
   * identifier: *Force push* and *Delete on the remote* both come from the
   * Push button, and matching on the words would have had that button go quiet
   * on exactly the two occasions it matters most.
   */
  verb: string;
  /** The same thing in the words on the button: "Fetch", "Force push". */
  what: string;
  /** The exact command, when there is one worth printing. */
  command: string | null;
  /** When it started, for the counter. */
  startedAt: number;
  /** There is a signal behind it, so it can be stopped. */
  cancellable: boolean;
  /** Stopping it may leave the repository half-way through something. */
  risky: boolean;
}

export interface GitActionOptions {
  verb?: string;
  what?: string;
  command?: string;
  /** Pass the signal to the request and offer a Stop. */
  cancellable?: boolean;
  risky?: boolean;
}

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
 * of computing it. `gitStderr` is kept beside it for the same reason in
 * reverse: the sentence is what to do, and git's own output is the evidence
 * that it happened.
 */
export function useGitAction(repoId: string | null): {
  busy: boolean;
  /** What is running, or null. Null while nothing is. */
  activity: GitActivity | null;
  error: string | null;
  /** What git printed on the failure, when the server sent it. */
  gitStderr: string | null;
  note: string | null;
  clear: () => void;
  /** Stop what is running. Only ever offered for a call that passed a signal. */
  cancel: () => void;
  /**
   * Say why something cannot run, without running it.
   *
   * The refusals this tab draws are mostly the server's, computed before the
   * click; on a desktop they sit in a `title` on the greyed control. A phone
   * has no tooltips at all, so there the control stays live and its tap lands
   * the same sentence here — which is where every other refusal from this
   * repository is already read.
   */
  say: (message: string) => void;
  /** The server's answer, or null if it refused — so a caller can read `undoId` off it. */
  run: (
    work: (signal: AbortSignal) => Promise<GitMutationResponse | void>,
    options?: GitActionOptions,
  ) => Promise<GitMutationResponse | null>;
} {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<GitActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gitStderr, setGitStderr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(
    async (work: (signal: AbortSignal) => Promise<GitMutationResponse | void>, options?: GitActionOptions) => {
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      setActivity({
        verb: options?.verb ?? '',
        what: options?.what ?? 'Working',
        command: options?.command ?? null,
        startedAt: Date.now(),
        cancellable: options?.cancellable === true,
        risky: options?.risky === true,
      });
      setError(null);
      setGitStderr(null);
      setNote(null);
      try {
        const result = await work(controller.signal);
        // The response already carries the fresh status; putting it straight
        // into the cache means the page updates before the refetch lands.
        if (result && repoId) {
          queryClient.setQueryData(['git', 'status', repoId], result.status);
          if (result.message) setNote(result.message);
        }
        return result ?? null;
      } catch (err) {
        // A Stop is not a failure. The command was ended on purpose and the
        // repository is in whatever state that left — which the state banner
        // draws — so a red box claiming something went wrong would be the app
        // reporting the user's own decision as an accident.
        if (controller.signal.aborted) {
          setNote('Stopped. Whatever git had already done is done; the rest did not happen.');
          return null;
        }
        setError(err instanceof Error ? err.message : String(err));
        setGitStderr(err instanceof GitRequestError ? err.gitStderr : null);
        return null;
      } finally {
        abort.current = null;
        setBusy(false);
        setActivity(null);
        /**
         * Everything else this could have moved: branches, the graph, the log.
         *
         * Everything EXCEPT this repository's status, which the response
         * carried and which was written into the cache a few lines up — read
         * inside the lock, right after the command, so it is fresher than
         * anything a refetch could produce. Invalidating the whole `['git']`
         * prefix asked for it again anyway, which is three more git processes
         * per button press and three more rows in the panel saying nothing.
         */
        void queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey;
            if (key[0] !== 'git') return false;
            return !(key[1] === 'status' && key[2] === repoId);
          },
        });
      }
    },
    [queryClient, repoId],
  );

  const clear = useCallback(() => {
    setError(null);
    setGitStderr(null);
    setNote(null);
  }, []);

  return {
    busy,
    activity,
    error,
    gitStderr,
    note,
    clear,
    cancel: () => abort.current?.abort(),
    say: setError,
    run,
  };
}
