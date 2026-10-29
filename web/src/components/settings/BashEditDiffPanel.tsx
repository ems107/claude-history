import type { BashEditDiffSettingResponse } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { CopyLine, ProjectOverrideRows, SettingButtons, SettingSourceRows } from './ClaudeSettingSources.tsx';
import { Explain } from './controls.tsx';

const LINE = '"bashEditDiffEnabled": true';
const ENV = 'CLAUDE_CODE_BASH_EDIT_DIFF';

/** The one proof there is that it works: a diff in a transcript, and a way to it. */
function Evidence({ seen }: { seen: BashEditDiffSettingResponse['lastSeen'] }) {
  if (!seen) {
    return (
      <p className="text-[12px] text-[var(--text-dim)]">
        None of your newest sessions holds a Bash diff, so it is most likely not recording.
      </p>
    );
  }
  const to = `/session/${seen.sessionId}${seen.toolUseId ? `?tool=${seen.toolUseId}` : ''}`;
  return (
    <p className="text-[12px] text-[var(--text-dim)]">
      Seen working in your sessions: the last one{' '}
      <span title={formatDateTime(seen.at)}>{relativeTime(seen.at)}</span>, in “{seen.title}” ·{' '}
      <Link to={to} className="text-sky-300 hover:underline">
        open that call
      </Link>
    </p>
  );
}

/** Where the decision came from, said in a few words. */
function decidedIn(d: NonNullable<BashEditDiffSettingResponse['decidedBy']>) {
  return d.kind === 'env' ? (
    <>
      <span className="font-mono">
        {ENV}={d.value}
      </span>{' '}
      in {d.where === 'the environment' ? d.where : <span className="font-mono break-all">{d.where}</span>}, which decides
      above every setting
    </>
  ) : (
    <>
      <span className="font-mono">bashEditDiffEnabled</span> in{' '}
      <span className="font-mono break-all">{d.path}</span>
    </>
  );
}

/**
 * Whether Claude Code records what each Bash command changed — the diffs drawn
 * under a Bash call and in the Changed panel — and what to add when that is
 * left to chance.
 *
 * Three states, and the middle one is the reason this panel exists. Written
 * `true` is green; written `false` is red. NOT written is amber even when it
 * works: Claude Code then records diffs only in auto or bypassPermissions mode
 * and only while the account is in an Anthropic experiment, neither of which
 * this machine can see or keep. So the amber state carries the one proof that
 * can be had — the newest diff in a transcript — without being turned green
 * by it.
 */
export function BashEditDiffPanel() {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['bash-edit-diff-setting'],
    queryFn: api.bashEditDiffSetting,
    staleTime: 5 * 60_000,
  });
  const [note, setNote] = useState<string | null>(null);

  if (!data) return <p className="text-[var(--text-dim)]">Reading Claude Code's settings…</p>;

  return (
    <>
      {data.state === 'on' && data.decidedBy ? (
        <div id="info-bash-diff" className="scroll-mt-16 space-y-1.5">
          <p>
            Claude Code records <span className="font-semibold text-emerald-400">what every Bash command changed</span>,
            in any mode — set by {decidedIn(data.decidedBy)}. It shows under each Bash call and in the Changed panel.
          </p>
          <Evidence seen={data.lastSeen} />
        </div>
      ) : data.state === 'off' && data.decidedBy ? (
        <div id="info-bash-diff" className="scroll-mt-16 space-y-2 rounded border border-red-500/45 px-3 py-2">
          <p>
            <span className="font-semibold text-red-400">No Bash command records what it changed</span>, in any mode —
            turned off by {decidedIn(data.decidedBy)}.
          </p>
          {data.decidedBy.kind === 'file' && (
            <>
              <p>To turn it on, change that line to:</p>
              <CopyLine line={LINE} onNote={setNote} />
            </>
          )}
        </div>
      ) : (
        <div id="info-bash-diff" className="scroll-mt-16 space-y-2 rounded border border-amber-500/40 px-3 py-2">
          <p>
            <span className="font-semibold text-amber-400">
              Nothing turns on <span className="font-mono">bashEditDiffEnabled</span>.
            </span>{' '}
            Claude Code then records what a Bash command changed only in auto or bypassPermissions mode, and only while
            your account is in an Anthropic experiment. Either can change without notice, and every command after that
            keeps no diff.
          </p>
          <Evidence seen={data.lastSeen} />
          <p>
            Turn it on for good by adding this line to{' '}
            <span className="font-mono break-all">{data.userSettingsFile}</span>:
          </p>
          <CopyLine line={LINE} onNote={setNote} />
        </div>
      )}

      <SettingSourceRows sources={data.sources} offTone="text-red-400" envVar={ENV} />

      <ProjectOverrideRows overrides={data.projectOverrides} offTone="text-red-400" envVar={ENV}>
        These projects set it themselves. A <span className="font-mono">false</span> turns it off whenever Claude Code
        is started inside them, even over yours; a <span className="font-mono">true</span> there turns nothing on — only
        your own settings or a policy can.
      </ProjectOverrideRows>

      <Explain label="What it records, and how Claude Code decides">
        <p>
          With it on, Claude Code compares the folder before and after every Bash command and keeps the diff beside the
          result — the model never sees it. It is what changed while the command ran, so a program writing at the same
          moment lands in it too. It keeps a diff for five files a command at most, and none for a binary file, a change
          too large or too slow to compare, or a checkout, merge or pull: those files are listed without one.
        </p>
        <p>
          Claude Code decides it in this order: the <span className="font-mono">{ENV}</span> variable, set in its
          environment or in a settings file’s <span className="font-mono">env</span> block; then the first of the
          managed policy, a <span className="font-mono">--settings</span> file given at launch and your user file
          that sets it; a <span className="font-mono">false</span> in any settings file, a project’s included, turns it
          off. With nothing set, the mode and the experiment decide. A <span className="font-mono">--settings</span>{' '}
          file is chosen per launch, so this page cannot see one.
        </p>
        <p>
          This app only ever reads <span className="font-mono">~/.claude</span>. Press Refresh after editing the file.
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
