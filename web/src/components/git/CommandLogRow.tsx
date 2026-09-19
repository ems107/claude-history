import type { GitCommandLogEntry } from '@claude-history/shared';
import { useState } from 'react';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatDateTime } from '../../lib/format.ts';
import { commandLine, pasteableCommand } from '../../lib/gitCommand.ts';
import { FoldHeader } from '../FoldHeader.tsx';

/** One stream of a finished command, named so an empty one is not a mystery. */
function Block({ label, text, tone }: { label: string; text: string; tone?: string }) {
  return (
    <div>
      <p className="text-[10px] tracking-wider text-[var(--text-dim)] uppercase">{label}</p>
      <pre
        className={`max-h-64 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] leading-[1.45] whitespace-pre-wrap max-md:text-xs ${tone ?? ''}`}
      >
        {text}
      </pre>
    </div>
  );
}

/** Time only — the panel is a running log, not a diary. */
function clockTime(iso: string): string {
  const at = iso.indexOf('T');
  return at < 0 ? iso : iso.slice(at + 1, at + 13);
}

export function CommandLogRow({ entry }: { entry: GitCommandLogEntry }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const failed = entry.exitCode !== 0 && entry.exitCode !== null;
  const running = entry.exitCode === null;

  return (
    <div className={`border-b border-[var(--border)]/40 ${failed ? 'border-l-2 border-l-red-500/50' : ''}`}>
      {/**
       * **One line on a desktop, two on a phone**, and the split is where the
       * row stops being readable: five things — a clock, a repository, the
       * command, an exit code and a duration — share a 360px line at 11px, and
       * what gives way is the command, which is the only one anybody came for.
       * So below 48rem the command takes a line of its own and the other four
       * become a dim line under it. The same two-span rule the rest of the app
       * uses for a glyph and its word.
       */}
      <div className="group flex items-start gap-2 px-2 py-0.5 font-mono text-[11px] hover:bg-[var(--bg-hover)]/40 max-md:gap-2.5 max-md:py-1.5">
        <FoldHeader
          open={open}
          onToggle={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-start gap-2"
          title={formatDateTime(entry.at)}
        >
          <span aria-hidden className="w-2 shrink-0 text-[var(--text-dim)] max-md:w-3 max-md:text-sm">
            {open ? '▾' : '▸'}
          </span>
          <span className="shrink-0 text-[var(--text-dim)] opacity-70 max-md:hidden">{clockTime(entry.at)}</span>
          {entry.repoName && (
            <span className="shrink-0 text-[10px] text-[var(--text-dim)] max-md:hidden">{entry.repoName}</span>
          )}
          <span className="min-w-0 flex-1">
            <span
              className={`block ${open ? 'break-all whitespace-pre-wrap' : 'truncate'} max-md:text-xs ${
                running
                  ? 'text-amber-400'
                  : failed
                    ? 'text-red-400'
                    : entry.mutation
                      ? 'text-[var(--text)]'
                      : 'text-[var(--text)]/75'
              }`}
            >
              {open ? `git ${entry.argv.join(' ')}` : commandLine(entry.argv)}
            </span>
            <span className="mt-0.5 hidden text-[11px] text-[var(--text-dim)] max-md:block">
              {clockTime(entry.at)}
              {entry.repoName ? ` · ${entry.repoName}` : ''} ·{' '}
              <span className={failed ? 'text-red-400' : ''}>
                {running ? 'running' : `exit ${entry.exitCode}`}
              </span>{' '}
              · {entry.durationMs} ms
              {entry.mutation ? '' : ' · read'}
            </span>
          </span>
          <span className="shrink-0 tabular-nums text-[var(--text-dim)] max-md:hidden">
            {running ? 'running' : `exit ${entry.exitCode}`} · {entry.durationMs} ms
          </span>
        </FoldHeader>
        {/* A sibling, never nested: nothing interactive may live inside a FoldHeader. */}
        <button
          type="button"
          title="Copy this command with its folder, ready to paste"
          onClick={() => {
            void copyPlain(pasteableCommand(entry.argv, entry.cwd)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1_200);
            });
          }}
          className="shrink-0 cursor-pointer px-1 text-[10px] text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:text-[var(--text)] max-md:min-h-11 max-md:px-2 max-md:text-xs max-md:opacity-100"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      {open && (
        /**
         * Opened, it is three labelled things — where it ran, what it was fed,
         * what it printed — rather than a wall of 11px monospace with an `in`
         * at the front of it. The labels cost a line each and are the only way
         * to tell an empty stdout from an error nobody printed.
         */
        <div className="space-y-1.5 px-2 pb-2 pl-[6.5rem] text-[11px] select-text max-md:pl-2 max-md:text-xs">
          <p className="text-[var(--text-dim)]">
            <span className="mr-1 opacity-70">in</span>
            {/* Wrapped, not truncated. This is the panel you opened BECAUSE you
                wanted the whole of it, and `truncate-start` cannot help here
                anyway: its `unicode-bidi: plaintext` takes the direction from
                the first strong character, so a path beginning `C:` lays out
                left to right and loses its end rather than its front. */}
            <span className="block font-mono break-all text-[var(--text)]/80">{entry.cwd}</span>
            {entry.timedOut && <span className="text-red-400">timed out and was stopped</span>}
            {entry.aborted && <span className="text-amber-400">cancelled</span>}
          </p>
          {entry.stdinPreview && <Block label="stdin" text={entry.stdinPreview} />}
          {entry.stdout && <Block label="stdout" text={entry.stdout} />}
          {entry.stderr && <Block label="stderr" text={entry.stderr} tone="text-red-300/80" />}
          {!entry.stdout && !entry.stderr && <p className="text-[var(--text-dim)] italic">It printed nothing.</p>}
          {entry.truncated && <p className="text-amber-400">Output longer than what is kept here.</p>}
        </div>
      )}
    </div>
  );
}
