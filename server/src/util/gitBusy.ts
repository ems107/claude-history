import type { AppContext } from '../context.ts';

/**
 * The 409 body for an action that may not happen while a repository is being
 * written to, or null when nothing is in flight and it may go ahead.
 *
 * The second guard on the same four endpoints, beside `refuseWhileActive`, and
 * deliberately not folded into it: that one is about a `claude` this app is
 * running and answers with a LIST, so the dialog can offer to go and close
 * them. This one has nothing to offer — a rebase halfway through is not a thing
 * anybody can close, only a thing to wait for — so it is an ordinary sentence,
 * which is also what tells the two refusals apart in the browser.
 *
 * Why it exists at all: every one of these four ends this process. A `git
 * rebase` interrupted by its own server disappearing leaves a repository in a
 * state nothing in this app put it there, with no `--continue` and no `--abort`
 * left running to offer either.
 *
 * `doing` is the subject of the sentence, lower case and in the present
 * participle: "stopping the server", "installing an update".
 */
export function refuseWhileGitBusy(ctx: AppContext, doing: string): { error: string } | null {
  const what = ctx.git.busyDescription;
  if (!what) return null;
  return {
    error: `There is ${what} right now — ${doing} would cut it off, and nothing here could finish it for you. Wait for it to finish.`,
  };
}
