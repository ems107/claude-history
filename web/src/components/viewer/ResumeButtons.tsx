import type { SessionSummary } from '@claude-history/shared';
import { useState } from 'react';

export function ResumeButtons({ session }: { session: SessionSummary }) {
  const [copied, setCopied] = useState(false);
  const [state, setState] = useState<'idle' | 'launching' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');

  // PowerShell-friendly (the machine's default shell); works in cmd too if
  // pasted as two commands.
  const command = `cd "${session.projectPath}"; claude --resume ${session.id}`;

  const copy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const launch = () => {
    setState('launching');
    fetch(`/api/sessions/${session.id}/resume`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
        setState('ok');
        setTimeout(() => setState('idle'), 2000);
      })
      .catch((e) => {
        setError(String(e.message ?? e));
        setState('error');
        setTimeout(() => setState('idle'), 4000);
      });
  };

  const openTarget = (target: 'explorer' | 'vscode') => {
    void fetch(`/api/sessions/${session.id}/open?target=${target}`, { method: 'POST' });
  };

  const btn =
    'cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-50';

  // Resuming a session something else already holds gives the transcript two
  // writers, which is what leaves the duplicated uuids the parser has to undo.
  // The server refuses it (409) and that is the authority; this only says so
  // before the click, because a button that launches nothing and explains
  // afterwards is the worse version. "Copy resume cmd" stays live throughout:
  // doing it anyway should be possible, just deliberate.
  const holder = session.live;

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => openTarget('explorer')}
        className={btn}
        title={`Open ${session.projectPath} in Explorer`}
      >
        📁 Open folder
      </button>
      <button
        type="button"
        onClick={() => openTarget('vscode')}
        className={btn}
        title={`Open ${session.projectPath} in VS Code`}
      >
        {'{ }'} Open VS Code
      </button>
      <button
        type="button"
        onClick={launch}
        disabled={state === 'launching' || holder !== null}
        className={state === 'error' ? `${btn} border-red-400 text-red-400` : btn}
        title={
          state === 'error'
            ? error
            : holder
              ? `This session is already open (pid ${String(holder.pid)}) — resuming it twice would corrupt its transcript`
              : `Open a terminal in ${session.projectPath} and resume this session`
        }
      >
        {/* Same ❯ used by the "cli" entrypoint chip elsewhere. */}
        {state === 'launching'
          ? 'Launching…'
          : state === 'ok'
            ? 'Launched ✓'
            : state === 'error'
              ? 'Failed ✕'
              : holder
                ? // Why it is dead, without waiting for a hover — the label is
                  // the only part read at a glance.
                  '❯ Already open'
                : '❯ Resume in terminal'}
      </button>
      <button type="button" onClick={copy} className={btn} title={command}>
        {copied ? 'Copied ✓' : '📋 Copy resume cmd'}
      </button>
    </span>
  );
}
