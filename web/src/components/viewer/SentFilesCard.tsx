import { parseFileRef } from '../../lib/fileRefs.ts';
import { formatBytes } from '../../lib/format.ts';
import type { SentFile, SentFiles } from '../../lib/sentFiles.ts';
import { useFileRefs } from './FileRefContext.ts';
import { FileLink } from './FileRefLink.tsx';

/**
 * The tail of the folder a file was sent from — the last two segments, marked
 * as cut.
 *
 * The whole path is neither useful nor showable here: these are absolute
 * scratchpad paths of ~130 characters whose first ~110 are identical on every
 * row, so a truncated column spent its width on the shared half and ran out
 * before the part that differs. The end is the part that says anything, and the
 * whole path is on the link's title and in its href.
 */
function folderTail(path: string, name: string): string {
  const dir = path.slice(0, path.length - name.length).replace(/[\\/]+$/, '');
  const parts = dir.split(/[\\/]/);
  const tail = parts.slice(-2).join('\\');
  return parts.length > 2 ? `…\\${tail}` : dir;
}

/** A chip that only exists when it has something to say. */
function Chip({ children, tone, title }: { children: string; tone: 'quiet' | 'warn'; title: string }) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold tracking-wide normal-case ${
        tone === 'warn' ? 'bg-amber-500/15 text-amber-300' : 'bg-[var(--bg)] text-[var(--text-dim)]'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * One file: what it is called, what it was, and a way in.
 *
 * The name is a `FileLink` — an `<a>` with a real href — so ctrl+click, copy-link
 * and a drag that ends on it all keep working, and the panel it opens is where
 * the file actually gets shown (a picture included, now that the panel can draw
 * one) along with the buttons that hand it to Explorer or to its own program.
 *
 * The size and the type come from the transcript and are NOT checked against the
 * disk. Saying "48 KB as sent" costs nothing; a `stat` per row would be one
 * request per file for a number nobody asked for, and the panel shows the real
 * `modifiedAt` the moment a row is opened.
 */
function FileRow({ file }: { file: SentFile }) {
  const ctx = useFileRefs();
  const ref = ctx ? parseFileRef(file.path) : null;
  const detail = [file.mediaType, file.sizeBytes === null ? null : formatBytes(file.sizeBytes)]
    .filter((d): d is string => !!d)
    .join(' · ');
  return (
    <div className="flex items-baseline gap-2 rounded px-2 py-1 text-xs">
      <span aria-hidden className="shrink-0 opacity-70">
        {file.isImage ? '🖼' : '📄'}
      </span>
      {ref && ctx ? (
        <FileLink
          ctx={ctx}
          fileRef={ref}
          className="shrink-0 cursor-pointer font-medium text-[var(--accent)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
          title={`Open ${file.path}`}
        >
          {file.name}
        </FileLink>
      ) : (
        <span className="shrink-0 font-medium">{file.name}</span>
      )}
      {detail && <span className="shrink-0 text-[11px] text-[var(--text-dim)]">{detail}</span>}
      <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-[var(--text-dim)]/70" title={file.path}>
        {folderTail(file.path, file.name)}
      </span>
      {file.unvalidated && (
        <Chip tone="warn" title="Claude Code could not confirm the file was at this path when it was sent.">
          unconfirmed path
        </Chip>
      )}
    </div>
  );
}

/**
 * The files the assistant handed to the user, drawn as a part of the
 * conversation rather than as one of the tool calls.
 *
 * It sits BETWEEN tool runs for the same reason the answered question does:
 * handing something over is a turn of the conversation, and burying it among
 * twenty Reads and Greps files it as plumbing. It was worse than that here — a
 * `SendUserFile` inside a collapsed run left an answer saying "you have them in
 * the images above" with nothing above it at all.
 *
 * The card names the files and no more. The bytes are not in the transcript, and
 * a thumbnail per row would be one fetch per file of every delivery on screen,
 * so the picture is one click away, in the panel, where it is asked for.
 *
 * The call itself stays in the run behind this, with its raw input, its result
 * and its cost, so nothing is lost for anyone reading the mechanics or following
 * a `?tool=` link.
 */
export function SentFilesCard({ parsed }: { parsed: SentFiles }) {
  const count = parsed.files.length;
  return (
    <div className="my-2 rounded-lg border border-[var(--accent-dim)]/50 bg-[var(--accent)]/5 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
        <span>
          Assistant sent {count} file{count === 1 ? '' : 's'}
        </span>
        {parsed.proactive && (
          <Chip tone="quiet" title="Sent without being asked for it — `status: proactive`.">
            unprompted
          </Chip>
        )}
        {parsed.display === 'attach' && (
          <Chip tone="quiet" title="Offered as a download rather than shown inline — `display: attach`.">
            as a download
          </Chip>
        )}
        {parsed.pending && (
          <Chip tone="quiet" title="No result recorded yet: the delivery was still in flight.">
            still sending
          </Chip>
        )}
        {parsed.failed && (
          <Chip tone="warn" title="The tool reported an error. The files may never have reached the user.">
            the delivery failed
          </Chip>
        )}
      </div>
      {/* Plain text, not markdown: this is a sentence the tool carried, and it is
          usually the caption of a set of screenshots — the half that says which
          one is which. */}
      {parsed.caption && <div className="mb-1.5 text-xs whitespace-pre-wrap text-[var(--text)]">{parsed.caption}</div>}
      <div className="space-y-0.5">
        {parsed.files.map((f) => (
          <FileRow key={f.path} file={f} />
        ))}
      </div>
    </div>
  );
}

/** One-line summary of a delivery, for an export or a collapsed header. */
export function sentFilesSummary(parsed: SentFiles): string {
  return parsed.files.map((f) => f.name).join(', ');
}
