// The wire shapes of the Revision panel: reviewing what a branch introduced.

import type { GitFileDiff } from './git.ts';

/**
 * A branch the base dropdown offers.
 *
 * `ref` is what git is given and what the record stores — `main` for a local
 * branch, `origin/main` for a remote-tracking one, which are two different
 * things to compare against and must not be folded together. The GIT tab keeps
 * them apart for the same reason.
 */
export interface RevisionBranchOption {
  ref: string;
  kind: 'local' | 'remote';
  /** When its tip last moved, which is how the dropdown orders itself. */
  lastCommitAt: string | null;
}

/**
 * What the panel needs before it can compare anything
 * (`GET /api/sessions/:id/revision/info`).
 *
 * Three refusals live in here as ordinary states rather than errors, because
 * all three are ordinary: the folder is not a repository, the repository has
 * no current branch (a detached HEAD, which is a real place to be and nothing
 * to review FROM), or it has no other branch to compare against.
 */
export interface RevisionRepoInfo {
  isRepo: boolean;
  /** Null when this is not a repository, or when HEAD is detached. */
  currentBranch: string | null;
  detached: boolean;
  branches: RevisionBranchOption[];
  /**
   * What the dropdown opens on, and the order it is decided in says what this
   * panel is for: (1) the comparison this session already has remarks on, so
   * coming back resumes the review you were in the middle of; (2) the guess at
   * which branch this one was cut from; (3) the remote's default branch, or
   * `main`/`master`; (4) nothing, and you pick.
   */
  suggestedBase: string | null;
  /**
   * Whether that suggestion is a review already under way rather than a guess.
   * The panel says which, because "carry on where you left off" and "this is
   * probably what you branched from" are different promises.
   */
  resumed: boolean;
}

/**
 * The diff of a branch against a base (`GET /api/sessions/:id/revision/diff`).
 *
 * What a pull request shows: only what the current branch INTRODUCED since it
 * diverged, never the base's own movements since. That is the merge-base in
 * `mergeBaseSha`, which is reported rather than hidden — it is the one fact
 * that explains why a file somebody changed on the base is not in this list.
 */
export interface RevisionDiffResponse {
  /** False for the states that are not failures — see `error`. */
  ok: boolean;
  currentBranch: string;
  baseBranch: string;
  /** Null exactly when the two branches share no history. */
  mergeBaseSha: string | null;
  files: GitFileDiff[];
  truncated: boolean;
  /** Set only when `ok` is false, and written for a person to read. */
  error: string | null;
}
