import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { CopyLine, ProjectOverrideRows, SettingButtons, SettingSourceRows } from './ClaudeSettingSources.tsx';
import { Explain } from './controls.tsx';

const LINE = '"showThinkingSummaries": true';

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
          <CopyLine line={LINE} onNote={setNote} />
        </div>
      )}

      <SettingSourceRows sources={data.sources} />

      <ProjectOverrideRows overrides={data.projectOverrides}>
        These projects set it themselves, and a project’s settings beat yours whenever Claude Code is started inside it.
      </ProjectOverrideRows>

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

      <SettingButtons
        isFetching={isFetching}
        onRefresh={() => {
          setNote(null);
          void refetch();
        }}
        note={note}
      />
    </>
  );
}
