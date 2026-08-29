import type { RetentionSource } from '@claude-history/shared';
import { CLAUDE_SWEEP_INTERVAL_HOURS } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocalOnly } from '../../api/useLocal.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { retentionLabel, retentionView } from '../../lib/retention.ts';
import { actionClass } from '../controlClass.ts';

/** What one settings file has to say, in the one word that matters. */
function sourceValue(s: RetentionSource): { text: string; tone: string } {
  if (s.unreadable) return { text: s.unreadable, tone: 'text-red-400' };
  if (s.invalidValue) return { text: `invalid: ${s.invalidValue}`, tone: 'text-red-400' };
  if (s.days !== null) {
    return { text: `${s.days.toLocaleString()} ${s.days === 1 ? 'day' : 'days'}`, tone: 'text-[var(--text)]' };
  }
  if (!s.exists) return { text: 'not there', tone: '' };
  return { text: 'does not set it', tone: '' };
}

/**
 * Claude Code's own history retention: what it is, what it costs, and how to
 * change it by hand.
 *
 * Deliberately read-only. `~/.claude` belongs to Claude Code and this app never
 * writes there — and this file in particular is one Claude Code rewrites while
 * it runs, where a JSON error does not merely lose a preference: it pauses the
 * cleanup sweep entirely until somebody fixes the file.
 */
export function RetentionPanel() {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['retention'],
    queryFn: api.retention,
    staleTime: 5 * 60_000,
  });
  const [note, setNote] = useState<string | null>(null);
  const claudeFolder = useLocalOnly('openClaudeFolder');

  if (!data) return <p className="text-[var(--text-dim)]">Reading Claude Code's settings…</p>;
  const view = retentionView(data);
  const snippet = `{\n  "cleanupPeriodDays": ${data.usedDefault ? 3650 : data.days}\n}`;
  const nextSweepAt = data.lastSweepAt ? Date.parse(data.lastSweepAt) + CLAUDE_SWEEP_INTERVAL_HOURS * 3600_000 : null;

  return (
    <>
      <p id="info-retention" className="scroll-mt-16">
        Claude Code keeps your conversations for{' '}
        <span className={`font-semibold ${view.tone === 'warn' ? 'text-amber-400' : 'text-[var(--text)]'}`}>
          {retentionLabel(view, false)}
        </span>{' '}
        {data.usedDefault ? (
          <>— nothing sets it, so its built-in default applies.</>
        ) : (
          <>
            , set as <span className="font-mono">cleanupPeriodDays</span> in{' '}
            <span className="font-mono break-all">
              {data.sources.find((s) => s.days !== null)?.path ?? data.userSettingsFile}
            </span>
            .
          </>
        )}{' '}
        {view.blocked ? (
          <>Files last modified before <span className="font-mono">{formatDateTime(data.cutoff)}</span> would be the
          ones to go — but see below: right now nothing is.</>
        ) : (
          <>
            Anything last modified before <span className="font-mono">{formatDateTime(data.cutoff)}</span> is deleted
            the next time Claude Code starts.
          </>
        )}
      </p>

      {view.blocked && (
        <p className="rounded border border-red-500/40 px-2 py-1.5 text-red-300">
          Claude Code is not cleaning up <span className="font-semibold">at all</span> right now: {view.blocked}. It
          stays paused — nothing is deleted, and the figure above is what <em>would</em> apply, not what does — until
          that file is valid JSON again.
        </p>
      )}

      <p className={!view.blocked && view.expired > 0 ? 'text-amber-400' : 'text-[var(--text-dim)]'}>
        {view.expired > 0 ? (
          <>
            {view.expired} of the {data.countedSessions} sessions listed here are already past that cutoff
            {view.blocked ? ' and would go as soon as the cleanup runs again.' : " and will go at Claude Code's next start."}
          </>
        ) : view.oldestKeptMs !== null ? (
          <>
            None of the {data.countedSessions} sessions listed here is past it — the oldest was last touched{' '}
            {relativeTime(view.oldestKeptMs)}
            {view.nextDropMs !== null && <> and drops out {relativeTime(view.nextDropMs)}</>}.
          </>
        ) : (
          <>No sessions to measure against it yet.</>
        )}
      </p>

      {/* Every file looked at, including the ones that are not there: "we checked
          and it does not exist" is an answer, and hiding it turns the winner
          above into something the user has to take on trust. */}
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 border-t border-[var(--border)] pt-3 font-mono text-[11px] text-[var(--text-dim)]">
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
        <span className="opacity-60">last swept</span>
        <span>
          {data.lastSweepAt ? `${formatDateTime(data.lastSweepAt)} (${relativeTime(data.lastSweepAt)})` : 'never'}
        </span>
        <span className="whitespace-nowrap">
          {nextSweepAt !== null && nextSweepAt > Date.now()
            ? `not again before ${formatDateTime(nextSweepAt)}`
            : 'due at the next start'}
        </span>
      </div>

      {data.projectOverrides.length > 0 && (
        <div className="space-y-1 border-t border-[var(--border)] pt-3">
          <p className="text-amber-400">
            These projects have their own settings, and a project's settings beat yours whenever Claude Code is started
            inside it — the sweep is global, so the value in force is the one of wherever it happened to be launched.
          </p>
          <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--text-dim)]">
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

      <div className="space-y-2 border-t border-[var(--border)] pt-3 text-[11px] leading-relaxed text-[var(--text-dim)]">
        <p className="text-[var(--text)]">To change it, edit that file by hand:</p>
        <ol className="ml-4 list-decimal space-y-1 marker:text-[var(--text-dim)]/50">
          <li>
            Open <span className="font-mono break-all">{data.userSettingsFile}</span> in any text editor — the button
            below opens the folder.
          </li>
          <li>
            Add or change the <span className="font-mono">cleanupPeriodDays</span> key, keeping the file valid JSON:
            <pre className="mt-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)]">
              {snippet}
            </pre>
            A whole number of days, minimum {data.minDays}. There is no “never”: <span className="font-mono">0</span>{' '}
            is rejected outright, so a long retention is spelt as a big number — <span className="font-mono">3650</span>{' '}
            is ten years.
          </li>
          <li>
            Save, then press Refresh below to read it back. It takes effect the next time Claude Code starts, and it
            sweeps at most once every {CLAUDE_SWEEP_INTERVAL_HOURS} hours.
          </li>
        </ol>

        <p>
          <span className="text-[var(--text)]">Why not from here:</span> this app only ever reads{' '}
          <span className="font-mono">~/.claude</span>. Claude Code rewrites that file while it runs, so writing to it
          from outside can race with it — and a file it cannot parse does not just lose a setting, it{' '}
          <span className="text-[var(--text)]">pauses the cleanup entirely</span>, silently, until it is fixed. Reading
          it is safe; writing it is yours to do.
        </p>

        <p>
          <span className="text-[var(--text)]">What the sweep actually deletes:</span> it goes by each file's
          last-modified date, not by what the conversation says inside. When a transcript goes, its subagent
          conversations and its offloaded tool outputs go with it, along with plans, file-history snapshots, pasted
          images and the rest of Claude Code's own working data. Your typed prompts survive — they live in{' '}
          <span className="font-mono">history.jsonl</span>, which is never swept, so the Prompts page outlives the
          sessions it points at.
        </p>

        <p>
          Whatever Claude Code deletes disappears from here too: this app browses those files, it does not copy them.
          Nothing here ever deletes anything of yours.
          {!data.policyPresent && (
            <>
              {' '}
              A managed policy could also impose a value and would win over everything above; none was found. One set
              through the Windows registry rather than a file is not visible from here.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <button
          type="button"
          className={actionClass}
          onClick={() => void api.openClaudeSettingsFolder()}
          disabled={claudeFolder.disabled}
          title={claudeFolder.reason ?? undefined}
        >
          Open the folder
        </button>
        <button
          type="button"
          className={actionClass}
          onClick={() => {
            void copyPlain(data.userSettingsFile).then(
              () => setNote('Path copied.'),
              () => setNote('Could not copy the path.'),
            );
          }}
        >
          Copy the path
        </button>
        <button
          type="button"
          className={actionClass}
          disabled={isFetching}
          title="Read the settings files again, after editing them"
          onClick={() => {
            setNote(null);
            void refetch().then(() => setNote(`Read again at ${formatDateTime(Date.now())}.`));
          }}
        >
          {isFetching ? 'Reading…' : 'Refresh'}
        </button>
        {note && <span className="text-[11px] text-[var(--text-dim)]">{note}</span>}
      </div>
    </>
  );
}
