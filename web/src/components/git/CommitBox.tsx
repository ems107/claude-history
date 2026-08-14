import { GIT_MESSAGE_MAX, type GitStatus } from '@claude-history/shared';
import { useEffect, useRef, useState } from 'react';
import { gitApi } from '../../api/git.ts';
import { btn } from '../../lib/ui.ts';
import { toggleClass } from '../viewer/SessionHeader.tsx';
import { useGitAction } from './useGitAction.ts';

const MAX_TEXTAREA_PX = 220;

/**
 * The commit message and the button that uses it.
 *
 * The keyboard contract is deliberately the INVERSE of the composer's: Enter
 * inserts a newline and Ctrl+Enter commits. A commit message is multi-line by
 * nature — a subject, a blank line, a body — and an accidental Enter must never
 * be the thing that writes history.
 */
export function CommitBox({
  repoId,
  status,
  onDone,
}: {
  repoId: string;
  status: GitStatus;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [amend, setAmend] = useState(false);
  const [prefilled, setPrefilled] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const action = useGitAction(repoId);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  // Turning amend on offers HEAD's message once, and says where it came from.
  // Turning it off puts the draft back rather than silently keeping HEAD's.
  const [draft, setDraft] = useState('');
  const toggleAmend = () => {
    if (!amend) {
      setDraft(text);
      if (status.headSubject) {
        setText(status.headSubject);
        setPrefilled(status.headSha?.slice(0, 7) ?? null);
      }
      setAmend(true);
    } else {
      setText(draft);
      setPrefilled(null);
      setAmend(false);
    }
  };

  const blocked = amend ? status.blocked.amend : status.blocked.commit;
  const empty = text.trim().length === 0;
  const canCommit = !blocked && !empty && !action.busy;
  // Amending something already on the remote rewrites published history. The
  // server refuses it without an explicit confirm; saying so beforehand is
  // fairer than letting the button fail.
  const rewritesPublished = amend && !!status.upstream && status.ahead === 0;

  const commit = () => {
    if (!canCommit) return;
    void action
      .run(() => gitApi.commitChanges(repoId, { message: text, amend, confirm: rewritesPublished }))
      .then(() => {
        setText('');
        setDraft('');
        setAmend(false);
        setPrefilled(null);
        onDone();
      });
  };

  return (
    <div className="border-t border-[var(--border)] p-2">
      <textarea
        ref={box}
        value={text}
        maxLength={GIT_MESSAGE_MAX}
        spellCheck={false}
        placeholder="Summary, then a blank line and the details…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            commit();
          }
        }}
        className="w-full resize-none rounded border border-[var(--border)] bg-transparent p-2 font-mono text-[11px] focus:border-[var(--text-dim)] focus:outline-none"
        rows={3}
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <button type="button" onClick={toggleAmend} className={toggleClass(amend)} title="Replace the last commit">
          Amend
        </button>
        <span className="text-[var(--text-dim)]">
          {status.branch ? (
            <>
              on <span className="font-mono text-[var(--accent)]">{status.branch}</span>
              {status.upstream && <span> → {status.upstream}</span>}
            </>
          ) : (
            <span className="text-amber-400">detached HEAD — this commit will not be on any branch</span>
          )}
        </span>
        <button
          type="button"
          onClick={commit}
          disabled={!canCommit}
          title={blocked ?? 'Ctrl+Enter'}
          className={`${btn} ml-auto ${canCommit ? 'border-[var(--accent-dim)] text-[var(--accent)]' : ''}`}
        >
          {action.busy ? 'Committing…' : amend ? 'Amend the last commit' : 'Commit'}
        </button>
      </div>

      {/* The same string as the button's title, and always visible: a disabled
          control that cannot say why is the bug this pattern exists to avoid. */}
      {blocked && <p className="mt-1 text-[11px] text-[var(--text-dim)]">{blocked}</p>}
      {!blocked && empty && <p className="mt-1 text-[11px] text-[var(--text-dim)]">The message is empty.</p>}
      {prefilled && (
        <p className="mt-1 text-[11px] text-[var(--text-dim)]">Message taken from {prefilled}. Edit it as you like.</p>
      )}
      {rewritesPublished && (
        <p className="mt-1 text-[11px] text-amber-400">
          {status.headSha?.slice(0, 7)} is already on {status.upstream} — amending it will need a force push.
        </p>
      )}
      <p className="mt-1 text-[11px] text-[var(--text-dim)] opacity-70">Ctrl+Enter commits; Enter adds a line.</p>
      {action.error && (
        <p className="mt-1 rounded border border-red-500/40 bg-red-500/10 p-1.5 text-[11px] text-red-300">
          {action.error}
        </p>
      )}
      {action.note && <p className="mt-1 text-[11px] text-emerald-400">{action.note}</p>}
    </div>
  );
}
