import { CACHE_TTL_MS } from '@claude-history/shared';
import type { LiveResponse, SessionDetailResponse } from '@claude-history/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatContextTokens } from '../../lib/context.ts';

/**
 * What this session has cached, and for how much longer.
 *
 * Read off the LAST assistant request: `cacheRead + cacheCreate` is the prefix
 * that request had in the cache, and the hour runs from when it happened.
 * Returns null for a session that has never been answered — there is nothing to
 * warn about, and inventing a number for it would be worse than saying less.
 */
export function cacheClockOf(detail: SessionDetailResponse | undefined): { tokens: number; minutesLeft: number } | null {
  if (!detail) return null;
  let last: { at: string; tokens: number } | null = null;
  for (const turn of detail.turns) {
    for (const item of turn.items) {
      if (item.role !== 'assistant' || !item.usage) continue;
      const tokens = item.usage.cacheRead + item.usage.cacheCreate;
      const at = item.endTimestamp ?? item.timestamp;
      if (tokens > 0 && at) last = { at, tokens };
    }
  }
  if (!last) return null;
  const age = Date.now() - new Date(last.at).getTime();
  return { tokens: last.tokens, minutesLeft: Math.max(0, Math.round((CACHE_TTL_MS - age) / 60_000)) };
}

/**
 * Is closing worth asking about at all?
 *
 * **A dialog whose own text says the answer does not matter is worse than no
 * dialog**: it teaches people to click through the one that does. The old rule
 * asked whenever a CLI was alive, which meant the commonest case on screen was
 * the one reading "closing it now costs nothing" above two buttons.
 *
 * So it is asked only where something is genuinely at risk, and there are three
 * such places:
 *
 * - **a turn in flight** — that answer is cut off, whatever the cache says;
 * - **a cache with time left on it** — the case the wording was written for;
 * - **a transcript nobody has read yet** — unknown is not the same as free, and
 *   this one is transient anyway (the page that draws the conversation holds
 *   that query).
 *
 * Everything else closes on the click. A session whose hour is up has nothing
 * left to lose — that is measured, not assumed ([AI_COST_AND_CONTEXT.md]) — and
 * one that has never been answered has nothing cached in the first place, which
 * is what an *error* on that query means here: `/api/sessions/:id` 404s for an
 * id whose transcript does not exist yet, and that 404 is an answer.
 *
 * Read off the query the page already holds and never fetched: a dialog is no
 * reason to go and re-read a whole transcript, and the decision has to be
 * instant because it stands between a click and its effect.
 */
export function closingNeedsAsking(client: QueryClient, sessionId: string, busy = false): boolean {
  // A turn in flight, from whichever of the two places can know about one: the
  // composer passes its own, because a `--print` run writes no `status`
  // anywhere, and for a terminal it is `~/.claude/sessions` — read here, so
  // neither caller has to learn the other's mechanism.
  if (busy || busyFromLive(client, sessionId)) return true;
  const state = client.getQueryState<SessionDetailResponse>(['session', sessionId]);
  if (!state || state.status === 'pending') return true;
  if (state.status === 'error') return false;
  const cache = cacheClockOf(state.data);
  return cache !== null && cache.minutesLeft > 0;
}

/**
 * Is an interactive CLI in this session reporting itself busy right now?
 *
 * `~/.claude/sessions/<pid>.json` is the only thing that knows — and only for a
 * real TUI: a `--print` run writes no `status` there, which is why the composer
 * answers for itself instead. Exported because the terminal needs the same
 * answer twice: once to decide whether to ask, and once to say so in the dialog.
 */
export function busyFromLive(client: QueryClient, sessionId: string): boolean {
  const live = client.getQueryData<LiveResponse>(['live']);
  return !!live?.some((l) => l.sessionId === sessionId && l.status === 'busy');
}

/**
 * Asked before a Claude Code session is closed by hand — but only when
 * `closingNeedsAsking` says there is something to lose, which is what keeps
 * this dialog meaningful.
 *
 * **The warning is conditional on purpose, and that is the whole care in it.**
 * Closing does not evict the cache — that lives at Anthropic, keyed on the
 * content, and it outlives the process; measured. What closing does is
 * guarantee that the next prompt comes from a CLI that has just started, and a
 * restarted CLI rebuilds its prompt: when the rebuild differs, the entire
 * prefix is written again. On this machine's history that is 38.7% of requests
 * after a restart against 0.3% of every other request, so it is a real risk and
 * it is not a certainty. Saying "will be lost" would be false, and a dialog
 * that overstates its case teaches people to click through it.
 *
 * Coming back quickly does not help, which is the one part that surprises
 * people: the risk is in the rebuild, not in the clock.
 */
export function CloseSessionDialog({
  cache,
  busy,
  onCancel,
  onConfirm,
}: {
  cache: { tokens: number; minutesLeft: number } | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Escape cancels, and stops there: the page's own handler ends in
  // `navigate(-1)`, so letting it through would leave the session as well.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Close the Claude Code session?</h2>
        <p className="text-xs leading-relaxed text-[var(--text-dim)]">
          {cache && cache.minutesLeft === 0 ? (
            // The hour is up, so there is nothing left to lose and saying otherwise
            // would be the same overstatement the conditional exists to avoid.
            // Reachable only beside a turn in flight now — with nothing running,
            // an expired session closes on the click — so it speaks about the
            // cache alone and leaves the turn to the line below.
            <>
              The prompt cache lasts an hour and this session's has already expired, so there is nothing cached left to
              lose: the next prompt would have re-sent the conversation either way.
            </>
          ) : cache ? (
            <>
              The prompt cache lasts an hour, and this one has{' '}
              <span className="text-[var(--text)]">{cache.minutesLeft} min</span> left. If you close now, the{' '}
              <span className="text-[var(--text)]">{formatContextTokens(cache.tokens)} tokens</span> it has cached{' '}
              <span className="text-[var(--text)]">could be lost</span> and would have to be sent again when you pick
              the session back up — however soon you come back.
            </>
          ) : (
            <>
              If you close now, whatever this session has cached{' '}
              <span className="text-[var(--text)]">could be lost</span> and would have to be sent again when you pick it
              back up — however soon you come back.
            </>
          )}
        </p>
        {busy && (
          <p className="mt-2 text-xs leading-relaxed text-amber-300">
            Claude is answering right now. That turn will be cut off.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2 text-xs">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="cursor-pointer rounded border border-[var(--accent)] bg-[var(--accent)]/15 px-3 py-1.5 text-[var(--accent)]"
          >
            No, keep it open
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded border border-[var(--border)] px-3 py-1.5 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
          >
            Yes, close it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
