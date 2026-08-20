import type { ActiveAppSession } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { ActiveSessionsError, api } from '../api/client.ts';
import { relativeTime } from '../lib/format.ts';

/**
 * What the app is running, in the way of what you just pressed.
 *
 * Six actions kill a live `claude` of ours — stopping the server, restarting it,
 * updating, clearing the cache, restoring userdata, and switching how prompts
 * are sent — and the server refuses all six while any of them is alive. This is
 * the other half of that refusal: the sentence alone would leave somebody
 * hunting through the session list for a process they cannot see, so the 409
 * carries the list and this draws it, one clickable row per session.
 *
 * It also offers to close them, which is what keeps the guard from being a wall.
 * The alternative was several trips to several sessions to press a button the
 * user had already decided to press — and a guard nobody can get past is a
 * guard that gets switched off.
 */

interface Refused {
  error: ActiveSessionsError;
  /** The thing that was refused, run again once the way is clear. */
  retry?: () => void | Promise<unknown>;
}

interface GuardApi {
  /**
   * Was this failure the active-sessions refusal? Opens the dialog and answers
   * true if so, false for anything else — so a `catch` reads
   * `if (guard.refused(e, again)) return;` and keeps its own error path for
   * every other way the same call can fail.
   */
  refused: (err: unknown, retry?: () => void | Promise<unknown>) => boolean;
}

const GuardContext = createContext<GuardApi>({ refused: () => false });

/** One dialog for the whole app, mounted once above the routes. */
export function ActiveSessionsGuardProvider({ children }: { children: React.ReactNode }) {
  const [refused, setRefused] = useState<Refused | null>(null);
  const guard = useMemo<GuardApi>(
    () => ({
      refused: (err, retry) => {
        if (!(err instanceof ActiveSessionsError)) return false;
        setRefused({ error: err, retry });
        return true;
      },
    }),
    [],
  );
  return (
    <GuardContext.Provider value={guard}>
      {children}
      {refused && (
        <ActiveSessionsDialog
          message={refused.error.message}
          sessions={refused.error.sessions}
          onClose={() => setRefused(null)}
          onContinue={refused.retry}
        />
      )}
    </GuardContext.Provider>
  );
}

export function useActiveSessionsGuard(): GuardApi {
  return useContext(GuardContext);
}

/** "claude-history — Folding a replayed turn", or the folder when there is no transcript yet. */
function nameOf(s: ActiveAppSession): string {
  if (s.projectName && s.title) return `${s.projectName} — ${s.title}`;
  if (s.projectName) return s.projectName;
  return s.cwd ?? s.sessionId.slice(0, 8);
}

function ActiveSessionsDialog({
  message,
  sessions,
  onClose,
  onContinue,
}: {
  message: string;
  sessions: ActiveAppSession[];
  onClose: () => void;
  onContinue?: () => void | Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  // The list the server sent, kept in state because closing them is allowed to
  // fail: what is LEFT afterwards is the answer, and it goes back on screen.
  const [live, setLive] = useState(sessions);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const closeThemAll = useCallback(() => {
    setClosing(true);
    setError(null);
    void api
      .closeActiveSessions()
      .then(async (left) => {
        void queryClient.invalidateQueries({ queryKey: ['activeSessions'] });
        setLive(left.sessions);
        if (left.sessions.length > 0) {
          setError('Some of them are still running. Try again, or close them from the session itself.');
          return;
        }
        // Only now is the way clear, so only now is the refused action tried
        // again — and the dialog goes first, because what it was guarding may
        // well be this page's own server exiting.
        onClose();
        await onContinue?.();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setClosing(false));
  }, [onClose, onContinue, queryClient]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">
          {live.length === 1 ? 'A Claude Code session is running' : `${live.length} Claude Code sessions are running`}
        </h2>
        <p className="text-xs leading-relaxed text-[var(--text-dim)]">{message}</p>
        <ul className="mt-3 space-y-1">
          {live.map((s) => (
            <li key={s.sessionId}>
              <Link
                to={`/session/${s.sessionId}`}
                onClick={onClose}
                className="flex items-baseline gap-2 rounded border border-[var(--border)] px-2 py-1.5 text-xs hover:border-[var(--text-dim)]"
                title={s.cwd ?? undefined}
              >
                <span className="rounded bg-[var(--bg-hover)] px-1 text-[10px] uppercase tracking-wide text-[var(--text-dim)]">
                  {s.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--text)]">{nameOf(s)}</span>
                {s.busy && <span className="text-[11px] text-amber-300">answering</span>}
                <span className="text-[11px] text-[var(--text-dim)]">{relativeTime(s.startedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
        {/* The one thing about closing that is not obvious, and it is the same
            warning `CloseSessionDialog` carries: the cache is the cost. */}
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-dim)]">
          Closing a session does not lose the conversation — it stays on disk and picks up where it left off. What it
          can cost is the prompt cache: a CLI that starts again rebuilds its prompt, and when the rebuild differs the
          whole conversation is sent to Claude once more.
          {live.some((s) => s.busy) && (
            <span className="text-amber-300"> One of them is answering right now, and that turn would be cut off.</span>
          )}
        </p>
        {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-2 text-xs">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="cursor-pointer rounded border border-[var(--accent)] bg-[var(--accent)]/15 px-3 py-1.5 text-[var(--accent)]"
          >
            Leave them open
          </button>
          <button
            type="button"
            disabled={closing || live.length === 0}
            onClick={closeThemAll}
            className="cursor-pointer rounded border border-red-500/40 px-3 py-1.5 text-red-300 hover:border-red-400 disabled:cursor-default disabled:opacity-40"
          >
            {closing ? 'Closing…' : onContinue ? 'Close them all and continue' : 'Close them all'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
