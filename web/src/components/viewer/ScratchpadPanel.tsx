import type { ScratchpadEntry, ScratchpadResponse } from '@claude-history/shared';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { useLocalOnly } from '../../api/useLocal.ts';
import { isImagePath } from '../../lib/fileRefs.ts';
import { formatBytes, formatDateTime } from '../../lib/format.ts';
import { FoldHeader } from '../FoldHeader.tsx';
import { useFileRefs } from './FileRefContext.ts';
import { FileLink } from './FileRefLink.tsx';

/**
 * How far the indent is allowed to travel before it stops.
 *
 * `SubagentsPanel`'s rule and its reason: every level of indent is width taken
 * off the name in a column that can be dragged down to 320 px, and a scratchpad
 * holding an unpacked toolchain nests further than any indent could usefully
 * show. Past the cap the rows sit level — you got there by opening four folders,
 * so where you are is not in doubt.
 */
const MAX_INDENT = 4;

/** One row, and which of the two kinds it is. */
function Row({
  entry,
  open,
  onToggle,
}: {
  entry: ScratchpadEntry;
  /** Directories only. */
  open: boolean;
  onToggle: () => void;
}) {
  const ctx = useFileRefs();
  const indent = { marginLeft: `${String(Math.min(entry.depth, MAX_INDENT) * 0.75)}rem` };

  if (entry.isDirectory) {
    const count =
      entry.childCount === null
        ? null
        : `${String(entry.childCount)} item${entry.childCount === 1 ? '' : 's'}`;
    return (
      <FoldHeader
        open={open}
        onToggle={onToggle}
        title={entry.error ?? entry.path}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded px-2 py-1 text-xs hover:bg-[var(--bg-hover)]"
      >
        <span style={indent} className="shrink-0 text-[var(--text-dim)]">
          {open ? '▾' : '▸'}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
        {/* An unreadable folder says so where its count would be: the row is
            still true — something is there — and the number is the part that
            is not knowable. */}
        {entry.error ? (
          <span className="shrink-0 text-[10px] text-amber-500/90">cannot be read</span>
        ) : (
          count && <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70">{count}</span>
        )}
      </FoldHeader>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded px-2 py-1 text-xs hover:bg-[var(--bg-hover)]">
      <span aria-hidden style={indent} className="shrink-0 opacity-70">
        {isImagePath(entry.path) ? '🖼' : '📄'}
      </span>
      {ctx ? (
        /**
         * The ref is BUILT rather than parsed. `parseFileRef` reads a `:12` or a
         * `#L12` off the end of a string, which is right for a path written in
         * prose and wrong here: this path came from a `readdir`, so every
         * character of it is really in the name, and a file called `notes#L2.md`
         * must open rather than resolve to one that does not exist.
         */
        <FileLink
          ctx={ctx}
          fileRef={{ path: entry.path, kind: 'absolute' }}
          className="min-w-0 flex-1 cursor-pointer truncate font-medium text-[var(--accent)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
          title={`Open ${entry.path}`}
        >
          {entry.name}
        </FileLink>
      ) : (
        <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
      )}
      {entry.error ? (
        <span className="shrink-0 text-[10px] text-amber-500/90" title={entry.error}>
          cannot be read
        </span>
      ) : (
        <>
          {entry.sizeBytes !== null && (
            <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70">{formatBytes(entry.sizeBytes)}</span>
          )}
          {entry.modifiedAt && (
            <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70">{formatDateTime(entry.modifiedAt)}</span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * What the session left in the temp folder it was given to work in.
 *
 * The fourth file question, and the only one the transcript cannot answer: the
 * other three panels read the conversation, this one reads the disk. Most of
 * what is in here was never named in a message.
 *
 * Everything arrives in one request as a flat, depth-first list carrying its own
 * `depth`, so folding is a linear pass rather than a nested structure: a
 * directory's contents are exactly the rows after it that are deeper than it.
 * They start folded — a scratchpad with a Chrome profile in it would otherwise
 * open onto a thousand rows.
 */
export function ScratchpadPanel({ sessionId, data }: { sessionId: string; data: ScratchpadResponse }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');

  // Opening a folder only means something where the shell is. The listing above
  // it is an ordinary read and works from anywhere.
  //
  // Keyed on `openFile` and not on `openFolder`: the key has to name the
  // ENDPOINT this button calls (`/api/files/open`, which `localOnlyRoutes` maps
  // to `openFile`), or the tooltip and the 409 are two sentences about one fact
  // and would disagree the first time either was reworded. `FileViewerPanel`
  // greys its own Show in Explorer out the same way.
  const handOff = useLocalOnly('openFile');

  const openFolder = () => {
    setOpening(true);
    setOpenError('');
    api
      .fileOpen({ session: sessionId, path: data.root, target: 'folder' })
      .catch((e: unknown) => setOpenError(String(e instanceof Error ? e.message : e)))
      .finally(() => setOpening(false));
  };

  /**
   * The rows a fold leaves visible. One pass: once a folded directory is met at
   * depth d, everything deeper than d is inside it and skipped, and the first
   * row back at d or above ends the skip.
   */
  const visible: ScratchpadEntry[] = [];
  let hideBelow: number | null = null;
  for (const entry of data.entries) {
    if (hideBelow !== null && entry.depth > hideBelow) continue;
    hideBelow = null;
    visible.push(entry);
    if (entry.isDirectory && !open.has(entry.path)) hideBelow = entry.depth;
  }

  return (
    <div className="px-4 py-3">
      {/* The folder itself, above everything it contains. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-dim)]/70"
          title={data.root}
        >
          {data.root}
        </span>
        <button
          type="button"
          disabled={handOff.disabled || opening}
          onClick={openFolder}
          title={handOff.reason ?? `Open ${data.root} in Explorer`}
          className={`shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] ${
            handOff.disabled || opening
              ? 'cursor-default opacity-40'
              : 'cursor-pointer hover:border-[var(--text-dim)] hover:text-[var(--text)]'
          }`}
        >
          Open folder
        </button>
      </div>
      {openError && <div className="mb-2 text-[11px] text-amber-500/90">{openError}</div>}
      <div className="mb-2 text-[11px] text-[var(--text-dim)]/80">
        what this session wrote while it worked — a temp folder, so Windows sweeps it
      </div>
      {visible.map((entry) => (
        <Row
          key={entry.path}
          entry={entry}
          open={open.has(entry.path)}
          onToggle={() =>
            setOpen((prev) => {
              const next = new Set(prev);
              if (next.has(entry.path)) next.delete(entry.path);
              else next.add(entry.path);
              return next;
            })
          }
        />
      ))}
      {/* Never a silent cap: the folder holds more than this, and the button
          above is the way to the rest of it. */}
      {data.truncated && (
        <div className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-dim)]/80">
          The listing stopped at {data.entries.length.toLocaleString()} entries — there is more in the folder than
          this. Open it to see the rest.
        </div>
      )}
    </div>
  );
}
