/**
 * The class strings shared by every plain control in the app.
 *
 * These existed in three identical copies (Settings, Logs, the retention
 * panel) before the git tab wanted a fourth. Three was already one too many:
 * a hover colour changed in one of them would have quietly split the look of
 * the app in two.
 */

/** The ordinary bordered button. Always carries its own `cursor-pointer`. */
export const btn =
  'cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-40';

/** The same button for something that cannot be undone. */
export const dangerBtn = `${btn} border-red-500/40 text-red-300 hover:border-red-400`;

/** A single-line text input. */
export const inputClass =
  'w-full rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 disabled:opacity-40 focus:border-[var(--text-dim)] focus:outline-none';
