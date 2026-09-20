import type { FileTreeEntry } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { isImagePath } from '../../lib/fileRefs.ts';
import { formatBytes } from '../../lib/format.ts';
import { FoldHeader } from '../FoldHeader.tsx';
import { useFileRefs } from './FileRefContext.ts';
import { FileLink } from './FileRefLink.tsx';

/**
 * The session's project folder, expanded one directory at a time.
 *
 * The scratchpad panel beside it folds a flat walk the server already did;
 * this asks per folder instead, and the route says why the two go opposite
 * ways — that one is a temp directory of ours, this is somebody's project and
 * holds `node_modules`. What it costs here is a request per expansion, which
 * is also what makes the first paint instant in a project of any size.
 *
 * Nothing is hidden. A file explorer showing everything but `.git` is a file
 * explorer somebody has to argue with, and the folders worth skipping are
 * exactly the ones nobody clicks.
 */

/**
 * How far the indent travels before it stops — `ScratchpadPanel`'s rule and its
 * reason: every level is width taken off the name in a column that can be
 * dragged down to 320 px, and a project nests further than any indent could
 * usefully show.
 */
const MAX_INDENT = 4;

function Node({ sessionId, entry, depth }: { sessionId: string; entry: FileTreeEntry; depth: number }) {
  const [open, setOpen] = useState(false);
  const ctx = useFileRefs();
  const children = useQuery({
    queryKey: ['fileTree', sessionId, entry.path],
    queryFn: () => api.fileTree(sessionId, entry.path),
    enabled: entry.isDirectory && open,
    staleTime: 30_000,
  });
  const indent = { marginLeft: `${String(Math.min(depth, MAX_INDENT) * 0.75)}rem` };

  if (!entry.isDirectory) {
    return (
      <div className="flex items-baseline gap-x-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-hover)]">
        <span aria-hidden style={indent} className="shrink-0 opacity-70">
          {isImagePath(entry.path) ? '🖼' : '📄'}
        </span>
        {ctx ? (
          /**
           * The ref is BUILT and ABSOLUTE, never the name on its own — the
           * scratchpad's rule, and here it is load-bearing twice over. A bare
           * `LICENSE` does not survive `parseFileRef` at the other end of the
           * URL, and a file really called `notes:12.md` must open rather than
           * resolve to a line number in a file that does not exist.
           */
          <FileLink
            ctx={ctx}
            fileRef={{ path: entry.path, kind: 'absolute' }}
            className="min-w-0 flex-1 cursor-pointer truncate text-[var(--accent)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
            title={`Open ${entry.path}`}
          >
            {entry.name}
          </FileLink>
        ) : (
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        )}
        {entry.sizeBytes !== null && (
          <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70">{formatBytes(entry.sizeBytes)}</span>
        )}
      </div>
    );
  }

  return (
    <>
      <FoldHeader
        open={open}
        onToggle={() => setOpen(!open)}
        title={entry.path}
        className="flex items-baseline gap-x-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-hover)]"
      >
        <span style={indent} className="shrink-0 text-[var(--text-dim)]">
          {open ? '▾' : '▸'}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
        {open && children.isFetching && <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70">…</span>}
      </FoldHeader>
      {open && <Level sessionId={sessionId} data={children.data} error={children.error} depth={depth + 1} />}
    </>
  );
}

/** One directory's worth of rows, and the three things it can say instead. */
function Level({
  sessionId,
  data,
  error,
  depth,
}: {
  sessionId: string;
  data: Awaited<ReturnType<typeof api.fileTree>> | undefined;
  error: unknown;
  depth: number;
}) {
  const indent = { marginLeft: `${String(Math.min(depth, MAX_INDENT) * 0.75 + 0.75)}rem` };
  if (error) {
    return (
      <div style={indent} className="px-2 py-1 text-[10px] text-red-400">
        {String(error instanceof Error ? error.message : error)}
      </div>
    );
  }
  if (!data) return null;
  if (!data.exists) {
    return (
      <div style={indent} className="px-2 py-1 text-[10px] text-amber-400/80">
        gone since it was listed
      </div>
    );
  }
  if (data.entries.length === 0) {
    return (
      <div style={indent} className="px-2 py-1 text-[10px] text-[var(--text-dim)]/70">
        empty
      </div>
    );
  }
  return (
    <>
      {data.entries.map((e) => (
        <Node key={e.path} sessionId={sessionId} entry={e} depth={depth} />
      ))}
      {/* Never silent about a cut: the folder has more in it than this. */}
      {data.truncated && (
        <div style={indent} className="px-2 py-1 text-[10px] text-amber-400/80">
          too many entries to list them all
        </div>
      )}
    </>
  );
}

export function FileTree({ sessionId }: { sessionId: string }) {
  const root = useQuery({
    queryKey: ['fileTree', sessionId, ''],
    queryFn: () => api.fileTree(sessionId, ''),
    staleTime: 30_000,
  });
  if (root.isPending) return <div className="px-2 py-1 text-xs text-[var(--text-dim)]">Reading the folder…</div>;
  return <Level sessionId={sessionId} data={root.data} error={root.error} depth={0} />;
}
