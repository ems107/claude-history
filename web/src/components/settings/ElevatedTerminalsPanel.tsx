import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { useHideLocalOnly } from '../../api/useLocal.ts';
import { actionClass } from '../controlClass.ts';
import { Anchored, Explain } from './controls.tsx';

/**
 * Administrator terminals: the scheduled task that lets an embedded terminal
 * start `claude.exe` elevated with no prompt at the moment of use.
 *
 * A panel and not a field of `AppSettings`, like the firewall rule: the truth is
 * whether the task exists in Windows, and a boolean in userdata.json could only
 * ever be a second opinion about it. Turning it on or off raises a UAC prompt on
 * this machine, so from another machine the panel says where it is and draws no
 * button ([useHideLocalOnly]) — while the terminals themselves, once it is on,
 * start from anywhere.
 */
export function ElevatedTerminalsPanel({
  disabled,
}: {
  /** Turning it ON makes no sense while there is no terminal mode to use it in. */
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const hideLocal = useHideLocalOnly();
  const status = useQuery({ queryKey: ['elevated-terminals'], queryFn: api.elevatedTerminals });
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (on: boolean) => api.setElevatedTerminals(on),
    onMutate: () => setError(null),
    onSuccess: (data) => {
      queryClient.setQueryData(['elevated-terminals'], data);
      // Every start bar's shield button reads its reason off the terminal status.
      void queryClient.invalidateQueries({ queryKey: ['terminal'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const s = status.data;

  return (
    <Anchored id="act-elevated-terminals" className="space-y-2 border border-[var(--border)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[var(--text-dim)]">
          Administrator terminals:{' '}
          {toggle.isPending ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--text)]">
              <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Waiting for Windows…
            </span>
          ) : !s ? (
            'reading…'
          ) : s.state === 'on' ? (
            <span className="text-amber-400">
              on — 🛡 starts the CLI with administrator rights, from this machine or any signed-in one
            </span>
          ) : s.state === 'off' ? (
            'off'
          ) : s.state === 'stale' ? (
            <span className="text-amber-400">set up for another copy of claude-history — {s.detail}</span>
          ) : (
            <span className="text-amber-400">unavailable — {s.detail}</span>
          )}
          {s && s.terminals > 0 && <span className="text-[var(--text)]"> · {s.terminals} running</span>}
        </span>
        {!hideLocal && s && s.state !== 'unavailable' && (
          <button
            type="button"
            className={actionClass}
            // Off is always allowed: a feature you can switch on and then not
            // off again because another setting changed is a trap.
            disabled={(disabled && s.state !== 'on') || toggle.isPending}
            title="Windows will ask for administrator approval"
            onClick={() => toggle.mutate(s.state !== 'on')}
          >
            {s.state === 'on' ? 'Turn off' : s.state === 'stale' ? 'Set up again' : 'Turn on'}
          </button>
        )}
      </div>
      {hideLocal && <p className="text-[var(--text-dim)]">Turned on and off on the machine claude-history runs on.</p>}
      {error && <p className="text-red-400">{error}</p>}
      <Explain label="What turning this on means">
        <p>
          It registers a scheduled task, <span className="text-[var(--text)]">{s?.taskName ?? 'claude-history-elevated'}</span>,
          that runs with the highest privileges. Registering it is the only time Windows asks; after that, the{' '}
          <span className="text-[var(--text)]">🛡 as administrator</span> button beside{' '}
          <em>Start an embedded terminal here</em> starts the task, and the task runs Claude Code elevated — with no
          prompt, which is what lets it work from your phone.
        </p>
        <p>
          <span className="text-[var(--text)]">That is the same as switching UAC off for whatever goes through this
          app.</span>{' '}
          Anybody who can sign in to claude-history can then run Claude with administrator rights on this machine, and
          so can any program already running as you. Leave it off unless you need it, and turn it off again when you
          are done.
        </p>
        <p>
          Only the Claude Code CLI is run that way, on a session — never a shell. The elevated CLIs belong to this server:
          stopping or restarting it closes them all, and nothing elevated is left behind.
        </p>
      </Explain>
    </Anchored>
  );
}
