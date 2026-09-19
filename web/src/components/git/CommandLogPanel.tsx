import type { GitCommandLogEntry } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { gitApi } from '../../api/git.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { commandFailed, pasteableCommand } from '../../lib/gitCommand.ts';
import { useBackDismiss, useIsMobile } from '../../lib/mobile.ts';
import { actionClass, segmentClass, segmentedClass } from '../controlClass.ts';
import { Sheet } from '../Sheet.tsx';
import { CommandLogRow } from './CommandLogRow.tsx';

/**
 * Every git command this app runs, as it runs it.
 *
 * The contract worth writing down: all of them go through the server's single
 * runner, and the runner records from inside itself rather than from its call
 * sites. So a command missing from this panel means somebody went around the
 * runner — that is what the panel is for, and it is why it shows the argv
 * exactly as it ran rather than a tidied version of it.
 *
 * **It is a view, not a dock.** It spent its life as a resizable strip at the
 * foot of the page, which meant it competed for height with a graph pane that
 * has a fixed one: dragging it up pushed the commit's detail off the bottom of
 * the window. A diagnostic panel is something you go and LOOK at, so it takes
 * the whole of the area under the toolbar and gives it back when you leave —
 * a third view beside Commits and the working tree rather than a fourth thing
 * sharing the same column. The toolbar stays above it on purpose: the reason to
 * open this is usually to watch what the next Fetch actually does.
 */

/** What the list is for, which is not always the same question. */
type Filter = 'actions' | 'all' | 'failures';

const FILTER_KEY = 'git.logFilter';

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  {
    key: 'actions',
    label: 'Actions',
    hint: 'What changed a repository, plus anything running or failed. The default: reads are most of the list and none of them did anything.',
  },
  { key: 'all', label: 'Everything', hint: 'Every invocation, reads included — the complete audit.' },
  { key: 'failures', label: 'Failures', hint: 'Only what went wrong: a non-zero exit, a timeout, a kill, a git that would not start.' },
];

function keep(entry: GitCommandLogEntry, filter: Filter): boolean {
  const failed = commandFailed(entry);
  if (filter === 'failures') return failed;
  if (filter === 'all') return true;
  // Actions: what this app DID, and anything that is either still doing it or
  // did not manage it. A read that failed is a fact about the repository and
  // belongs here; a read that worked is the app breathing.
  return entry.mutation || entry.running || failed;
}

export function CommandLogPanel({ open, onClose, repoId }: { open: boolean; onClose: () => void; repoId: string | null }) {
  const [filter, setFilter] = useState<Filter>(() => {
    const stored = localStorage.getItem(FILTER_KEY);
    return FILTERS.some((f) => f.key === stored) ? (stored as Filter) : 'actions';
  });
  const [mineOnly, setMineOnly] = useState(false);

  const mobile = useIsMobile();
  // It is a sheet below 48rem, and every sheet owes Android's Back an answer —
  // this one did not have it, and a log opened once then covered the page with
  // nothing to take it away again.
  useBackDismiss(mobile && open, onClose);
  // Closed, nothing is asked for at all: the panel no longer draws a strip when
  // it is shut, so there is no last command to keep warm. It is a view now, and
  // a view nobody is looking at costs nothing.
  const { data } = useQuery({
    queryKey: ['git', 'commands'],
    queryFn: () => gitApi.commands(0, 500),
    enabled: open,
  });

  const all = data?.entries ?? [];
  const entries = all.filter((e) => keep(e, filter) && (!mineOnly || !repoId || e.repoId === repoId));
  const hidden = all.length - entries.length;
  const running = all.filter((e) => e.running).length;

  const choose = (next: Filter) => {
    setFilter(next);
    localStorage.setItem(FILTER_KEY, next);
  };

  const controls = (
    <>
      <span className={`${segmentedClass} shrink-0`}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => choose(f.key)}
            aria-pressed={filter === f.key}
            title={f.hint}
            className={`${segmentClass(filter === f.key)} px-2.5`}
          >
            {f.label}
          </button>
        ))}
      </span>
      {/* The ring is GLOBAL on purpose — the failures worth coming back to are
          the ones where you no longer remember which repository it was — so
          narrowing it to one is offered and never assumed. */}
      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[var(--text-dim)] max-md:min-h-10">
        <input
          type="checkbox"
          checked={mineOnly}
          onChange={(e) => setMineOnly(e.target.checked)}
          disabled={!repoId}
          className="size-4 accent-[var(--accent)]"
        />
        this repository only
      </label>
    </>
  );

  /**
   * **Newest first**, which is what `/logs` has always done and what this panel
   * did not.
   *
   * It was bottom-anchored with a "to the end" pill, inherited from a dock 200px
   * tall where the end was the only part you could see. As a full view that is
   * backwards: what you came to read is the command you just ran, and it was at
   * the far side of everything that had happened before it. Prepending also
   * means the row for a command still RUNNING is the first one on screen, which
   * is the whole reason to have the panel open while it works.
   *
   * No "follow" tick like the log viewer's, on purpose: that one exists because
   * the daily log writes on its own, continuously. This one only ever moves
   * when the app runs git — usually because you pressed something — and the
   * browser's own scroll anchoring keeps a prepended row from shifting what you
   * are reading.
   */
  const shown = [...entries].reverse();

  const body = (
    <div className="h-full overflow-y-auto">
      {shown.length === 0 ? (
        <p className="px-2 py-2 text-[11px] text-[var(--text-dim)] italic">
          {all.length === 0
            ? 'Nothing has run yet.'
            : filter === 'failures'
              ? 'Nothing has failed. Everything the app ran, git accepted.'
              : 'Nothing has changed a repository yet — the rest is under Everything.'}
        </p>
      ) : (
        shown.map((entry) => <CommandLogRow key={entry.seq} entry={entry} />)
      )}
      {/* Both of these belong at the FOOT now: they are about what is older
          than the last row, and older is downwards. */}
      {shown.length > 0 && hidden > 0 && (
        <p className="px-2 py-1.5 text-[11px] text-[var(--text-dim)] italic">
          {hidden} more not shown by this filter.
        </p>
      )}
      {data && data.dropped > 0 && (
        <p className="px-2 py-1 text-[11px] text-amber-400">
          {data.dropped} older command{data.dropped === 1 ? '' : 's'} are no longer kept.
        </p>
      )}
    </div>
  );

  const copyShown = (
    <button
      type="button"
      className={`${actionClass} shrink-0`}
      // Chronological, not the order on screen. What this is for is pasting
      // into a terminal, and a list of commands to re-run is only meaningful
      // in the order they ran.
      title="Copy every command shown, with its folder, in the order they ran"
      onClick={() => {
        void copyPlain(entries.map((e) => pasteableCommand(e.argv, e.cwd)).join('\n'));
      }}
    >
      Copy shown
    </button>
  );

  /**
   * On a phone it is a sheet, or it is nothing at all.
   *
   * As a dock it spent a permanent row of a 775px screen on a strip reading
   * `Command log 380 git worktree list --porcelain` — the least useful line
   * available, since the last command is almost always a read the app made by
   * itself. It is diagnostics: it belongs behind the `⋮`, where it now is, and
   * the whole window is the right size for it when it is open.
   */
  if (!open) return null;
  if (mobile) {
    return (
      <Sheet title="Command log" onClose={onClose} extra={copyShown}>
        <div className="flex h-full flex-col">
          {/* A paragraph rather than the sheet's subtitle: that one is a single
              truncated line, and an explanation cut off at `…record` explains
              nothing. */}
          <p className="pb-1.5 text-[11px] text-[var(--text-dim)]">{caption(running)}</p>
          <div className="flex flex-wrap items-center gap-2 pb-2 text-[11px]">{controls}</div>
          <div className="-mx-3 min-h-0 flex-1">{body}</div>
        </div>
      </Sheet>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 text-[11px]">
        <span className="shrink-0 text-[var(--text)]">Command log</span>
        <span className="shrink-0 tabular-nums text-[var(--text-dim)]">{data?.newestSeq ?? 0}</span>
        {controls}
        <span className="ml-auto flex items-center gap-2">
          {copyShown}
          <button
            type="button"
            onClick={onClose}
            className={`${actionClass} shrink-0`}
            title="Back to what you were looking at"
          >
            ✕
          </button>
        </span>
        {/* What this list IS, said once and in the panel itself. It is the
            question the panel raised and never answered: a wall of monospace
            that mixes `git status` with `git push` explains neither. */}
        <p className="w-full text-[var(--text-dim)]">{caption(running)}</p>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

function caption(running: number): string {
  const what =
    'Every git command this app runs, recorded from inside the single runner it uses — so a command missing from here means the runner was bypassed.';
  return running > 0 ? `${running} running right now. ${what}` : what;
}
