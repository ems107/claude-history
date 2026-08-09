/**
 * undici reports every connection-level failure as the bare string "fetch
 * failed" and hides the real reason in `cause`. Unwrap it: that is the
 * difference between a sleeping laptop (ECONNRESET), broken DNS (EAI_AGAIN) and
 * a dead route, and without it a failing request is undiagnosable.
 *
 * Shared by everything that talks to the network (usage reads, the updater):
 * each of them learnt the same lesson the same way.
 */
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (!(cause instanceof Error)) return err.message;
  const code = (cause as NodeJS.ErrnoException).code;
  return `${err.message} (${code ?? cause.message})`;
}
