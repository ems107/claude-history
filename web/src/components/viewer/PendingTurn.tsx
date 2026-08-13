import type { ReactNode } from 'react';
import { Bubble } from './Bubble.tsx';
import { RAIL } from './Turn.tsx';

/**
 * A prompt that has been sent but is not in the transcript yet.
 *
 * It exists because the round trip is long enough to look broken: the answer
 * path this feature relies on — Claude Code writes, the watcher notices, the
 * viewer re-reads — cannot start until the CLI has actually taken the prompt,
 * and on a cold start that is several seconds behind the click, MCP servers
 * included. Until then the conversation showed nothing at all and the message
 * looked lost.
 *
 * It is deliberately NOT a `Turn`: it has no uuid, no timestamp, no cost and no
 * place in `turn.items`, so nothing that folds, counts or prices a message can
 * see it. It is replaced by the real thing the moment the transcript catches
 * up — same text, drawn by the same `Bubble`, so the swap is invisible.
 */
export function PendingTurn({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      {/* Dimmed, because it is a claim about the future: the server has taken
          the prompt, Claude Code has not necessarily written it down yet. */}
      <div className="opacity-70">
        <Bubble
          side="user"
          header={
            <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--text-dim)]">
              <span className="font-semibold text-[var(--accent)]">USER</span>
              <span>sending…</span>
            </div>
          }
        >
          <div className="text-sm whitespace-pre-wrap text-[var(--text)]">{text}</div>
        </Bubble>
      </div>
      {children && <div className={RAIL}>{children}</div>}
    </div>
  );
}
