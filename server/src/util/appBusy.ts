import type { AppContext } from '../context.ts';

/**
 * Is Claude in the middle of an answer this process is responsible for?
 *
 * Four endpoints end with this server being killed — stop, restart, uninstall,
 * update — and all four have to refuse while a turn is in flight, because
 * nothing downstream can put a half-written answer back. There are two ways to
 * be in that state now, and this is the one place that knows both.
 *
 * The answer is the WORDS, not a boolean, so the refusal can name what is
 * working. "Wait for the prompt you sent from the app" is no help at all to
 * somebody looking at a terminal they opened themselves.
 */
export function busyWith(ctx: AppContext): string | null {
  if (ctx.chat.busy) return 'answering a prompt sent from the app';
  if (ctx.terminals.busy) return 'working in a terminal open in the app';
  return null;
}
