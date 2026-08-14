import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { gitApi } from '../../api/git.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { commandLine, pasteableCommand } from '../../lib/gitCommand.ts';
import { btn } from '../../lib/ui.ts';
import { FollowBottomButton, useFollowBottom } from '../viewer/FollowBottom.tsx';
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
 * A bottom dock, and only a dock. A right-hand drawer would cover the diff,
 * which is precisely what you want to be looking at when a command misbehaves.
 * Collapsed it is a 26px strip that still shows the LAST command, which is what
 * makes it discoverable and what turns "nothing happened" into "here is what
 * ran".
 */
export function CommandLogDock({
  open,
  onToggle,
  height,
  onResizeStart,
}: {
  open: boolean;
  onToggle: () => void;
  height: number;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const [showReads, setShowReads] = useState(true);
  const follow = useFollowBottom();

  // Closed, only the newest entry is fetched: a dock nobody is looking at
  // should cost a row, not the whole ring.
  const { data } = useQuery({
    queryKey: ['git', 'commands', open ? 'full' : 'tail'],
    queryFn: () => gitApi.commands(0, open ? 500 : 1),
  });

  const all = data?.entries ?? [];
  const entries = showReads ? all : all.filter((e) => e.mutation);
  const hiddenReads = all.length - entries.length;
  const last = all[all.length - 1];

  return (
    <div className="shrink-0 border-t border-[var(--border)]">
      {open && (
        <div
          onMouseDown={onResizeStart}
          className="h-1 w-full cursor-row-resize hover:bg-[var(--accent-dim)]"
          title="Drag to resize"
        />
      )}

      <div className="flex items-center gap-2 px-2 py-1 text-[11px]">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left hover:text-[var(--text)]"
          title={open ? 'Hide the command log' : 'Show every git command this app has run'}
        >
          <span className="shrink-0 text-[var(--text-dim)]">⌘ Command log</span>
          <span className="shrink-0 tabular-nums text-[var(--text-dim)]">{data?.newestSeq ?? 0}</span>
          {!open && last && (
            <>
              <span className="shrink-0 text-[var(--text-dim)]">·</span>
              <span
                className={`min-w-0 flex-1 truncate font-mono ${
                  last.exitCode === 0 ? 'text-[var(--text-dim)]' : 'text-red-400'
                }`}
              >
                {commandLine(last.argv)}
              </span>
              <span className="shrink-0 tabular-nums text-[var(--text-dim)]">
                exit {last.exitCode} · {last.durationMs} ms
              </span>
            </>
          )}
          <span className="ml-auto shrink-0 text-[var(--text-dim)]">{open ? '▾' : '▴'}</span>
        </button>

        {open && (
          <>
            <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[var(--text-dim)]">
              <input
                type="checkbox"
                checked={showReads}
                onChange={(e) => setShowReads(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              reads
              {!showReads && hiddenReads > 0 && <span className="tabular-nums">({hiddenReads} hidden)</span>}
            </label>
            <button
              type="button"
              className={btn}
              title="Copy every command shown, with its folder"
              onClick={() => {
                void copyPlain(entries.map((e) => pasteableCommand(e.argv, e.cwd)).join('\n'));
              }}
            >
              Copy shown
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="relative" style={{ height }}>
          <div ref={follow.scrollRef} className="h-full overflow-y-auto">
            <div ref={follow.contentRef}>
              {data && data.dropped > 0 && (
                <p className="px-2 py-1 text-[11px] text-amber-400">
                  {data.dropped} older command{data.dropped === 1 ? '' : 's'} are no longer kept.
                </p>
              )}
              {entries.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-[var(--text-dim)] italic">
                  {all.length === 0 ? 'Nothing has run yet.' : 'Only reads so far, and they are hidden.'}
                </p>
              ) : (
                entries.map((entry) => <CommandLogRow key={entry.seq} entry={entry} />)
              )}
            </div>
          </div>
          {follow.scrollable && <FollowBottomButton following={follow.following} toggle={follow.toggle} />}
        </div>
      )}
    </div>
  );
}
