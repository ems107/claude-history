import type { ThinkingSettingSource } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api } from '../../api/client.ts';
import { useHideLocalOnly, useLocalOnly } from '../../api/useLocal.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { actionClass } from '../controlClass.ts';
import { Explain } from './controls.tsx';

const LINE = '"showThinkingSummaries": true';

function sourceValue(s: ThinkingSettingSource): { text: string; tone: string } {
  if (s.unreadable) return { text: s.unreadable, tone: 'text-red-400' };
  if (s.on !== null) return { text: s.on ? 'on' : 'off', tone: s.on ? 'text-emerald-400' : 'text-amber-400' };
  if (!s.exists) return { text: 'not there', tone: '' };
  return { text: 'does not set it', tone: '' };
}

/**
 * Whether Claude Code keeps a summary of Claude's reasoning, and what to add
 * when it does not. Read-only like the retention panel beside it in spirit:
 * the setting is Claude Code's, in a file this app never writes, so the panel
 * says what is in force and hands over the line rather than flipping it.
 *
 * Amber while it is off, because off is the default and costs something
 * nobody notices: every session from then on keeps no reasoning at all, and
 * nothing can bring it back later.
 */
export function ThinkingSummariesPanel() {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['thinking-setting'],
    queryFn: api.thinkingSetting,
    staleTime: 5 * 60_000,
  });
  const [note, setNote] = useState<string | null>(null);
  const claudeFolder = useLocalOnly('openClaudeFolder');
  const hideLocal = useHideLocalOnly();

  if (!data) return <p className="text-[var(--text-dim)]">Reading Claude Code's settings…</p>;
  const setIn = data.sources.find((s) => s.on !== null);

  return (
    <>
      {data.on ? (
        <p id="info-thinking" className="scroll-mt-16">
          Claude Code keeps a <span className="font-semibold text-emerald-400">summary of Claude’s reasoning</span> in
          every new session — set as <span className="font-mono">showThinkingSummaries</span> in{' '}
          <span className="font-mono break-all">{setIn?.path ?? data.userSettingsFile}</span>. It shows in the
          conversation under View ▾ → thinking, and in the column of each request.
        </p>
      ) : (
        <div id="info-thinking" className="scroll-mt-16 space-y-2 rounded border border-amber-500/40 px-3 py-2">
          <p>
            <span className="font-semibold text-amber-400">Claude Code is not keeping Claude’s reasoning.</span>{' '}
            {data.usedDefault ? (
              <>
                Nothing sets <span className="font-mono">showThinkingSummaries</span>, and its default is off
              </>
            ) : (
              <>
                <span className="font-mono">showThinkingSummaries</span> is off in{' '}
                <span className="font-mono break-all">{setIn?.path}</span>
              </>
            )}
            : every request asks for the reasoning without its text, so what reaches the transcript is an encrypted
            signature and there is nothing here to read. Sessions already written cannot get it back.
          </p>
          <p>
            Turn it on — with <span className="font-mono">/config</span> in Claude Code, or by adding this line to{' '}
            <span className="font-mono break-all">{data.userSettingsFile}</span> — and every new session keeps a summary
            of it, in the terminal and here:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[12px] text-[var(--text)]">
              {LINE}
            </code>
            <button
              type="button"
              className={actionClass}
              onClick={() =>
                void copyPlain(LINE).then(
                  () => setNote('Copied — paste it inside the braces, with a comma after the line before it.'),
                  (err: unknown) => setNote(`Could not copy: ${err instanceof Error ? err.message : String(err)}`),
                )
              }
            >
              Copy the line
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-1 border-t border-[var(--border)] pt-3 font-mono text-[11px] text-[var(--text-dim)]">
        {data.sources.map((s) => {
          const value = sourceValue(s);
          return (
            <Fragment key={s.path}>
              <span className="opacity-60">{s.scope === 'policy' ? 'policy' : 'user'}</span>
              <span className="break-all">{s.path}</span>
              <span className={value.tone}>{value.text}</span>
            </Fragment>
          );
        })}
      </div>

      {data.projectOverrides.length > 0 && (
        <div className="space-y-1 border-t border-[var(--border)] pt-3">
          <p className="text-amber-400">
            These projects set it themselves, and a project’s settings beat yours whenever Claude Code is started inside
            it.
          </p>
          <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--text-dim)]">
            {data.projectOverrides.map((o) => {
              const value = sourceValue(o);
              return (
                <Fragment key={o.path}>
                  <span className="opacity-60">{o.project?.name}</span>
                  <span className="break-all">{o.path}</span>
                  <span className={value.tone}>{value.text}</span>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      <Explain label="What it changes, and why this app does not turn it on">
        <p>
          With it on, Claude Code asks the API for a <span className="text-[var(--text)]">summary</span> of the
          reasoning — not the reasoning itself, which the API never returns — and writes it into the transcript. With it
          off it asks for none, and the terminal shows only the commentary Claude prints while it works, which is kept
          either way.
        </p>
        <p>
          This app only ever reads <span className="font-mono">~/.claude</span>: Claude Code rewrites its settings file
          while it runs, and a file it cannot parse breaks more than one setting. Reading it is safe; changing it is
          yours to do. Press Refresh after editing it.
        </p>
      </Explain>

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <button
          type="button"
          className={actionClass}
          onClick={() => {
            setNote(null);
            void refetch();
          }}
          disabled={isFetching}
        >
          {isFetching ? 'Reading…' : 'Refresh'}
        </button>
        {!hideLocal && (
          <button
            type="button"
            className={actionClass}
            onClick={() => void api.openClaudeSettingsFolder()}
            disabled={claudeFolder.disabled}
            title={claudeFolder.reason ?? undefined}
          >
            Open the folder
          </button>
        )}
        {note && <span className="text-[11px] text-[var(--text-dim)]">{note}</span>}
      </div>
    </>
  );
}
