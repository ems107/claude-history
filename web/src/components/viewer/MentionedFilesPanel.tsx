import { isImagePath, parseFileRef } from '../../lib/fileRefs.ts';
import { folderTail, formatBytes, formatDateTime } from '../../lib/format.ts';
import type { MentionedFiles, MentionRow } from '../../lib/mentionedFiles.ts';
import { Chip } from './Chip.tsx';
import { useFileRefs } from './FileRefContext.ts';
import { FileLink } from './FileRefLink.tsx';

/**
 * What was dropped, in words, on one line.
 *
 * It is not an apology and it is not optional. The panel lists a fraction of what
 * the conversation named — measured at 1 of 14 in one session here — and a list
 * that quietly shows 1 where the reader can see 14 links in the messages reads as
 * broken. Saying which fraction, and why, is what makes the short list credible.
 */
function Dropped({ data }: { data: MentionedFiles }) {
  const { missing, folder, listed } = data.dropped;
  const parts = [
    missing > 0 ? `${String(missing)} that nothing is at` : null,
    folder > 0 ? `${String(folder)} that name a folder` : null,
    listed > 0 ? `${String(listed)} already in Changed or Sent Files` : null,
    data.unchecked > 0 ? `${String(data.unchecked)} past the batch limit, never checked` : null,
  ].filter((p): p is string => !!p);
  if (parts.length === 0) return null;
  return (
    <div className="mt-1.5 px-2 text-[11px] text-[var(--text-dim)]/80">
      <span className="opacity-70">not listed:</span> {parts.join(' · ')}
      <span className="ml-2 opacity-60">
        — a path in prose is written for a person (`core/git.ts` for the real thing), so most of them open nothing
      </span>
    </div>
  );
}

function MentionRowView({
  row,
  showOrigin,
  onGoToMessage,
}: {
  row: MentionRow;
  showOrigin: boolean;
  onGoToMessage: (uuid: string) => void;
}) {
  const ctx = useFileRefs();
  // Resolved, and with the line the sentence pointed at: the panel opens where
  // the answer was looking, which a bare path would lose.
  const ref = ctx ? parseFileRef(row.line === null ? row.resolved : `${row.resolved}:${String(row.line)}`) : null;
  const { messageUuid } = row;
  /**
   * The ref earns a column only when it is the READABLE half of the row.
   *
   * A relative one is the interesting case — `server/src/util/launcher.ts` is what
   * the answer pointed at, in the words it used. An absolute one is 130 characters
   * of the same thing the folder-tail column already ends with, and printed here
   * it pushed every row past the window: an absolute ref is what the tail and the
   * title are for.
   */
  const asWritten = parseFileRef(row.ref)?.kind === 'relative' && row.ref !== row.name ? row.ref : null;
  return (
    <div className="flex items-baseline gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-hover)]">
      <span aria-hidden className="shrink-0 opacity-70">
        {isImagePath(row.path) ? '🖼' : '📄'}
      </span>
      {ref && ctx ? (
        <FileLink
          ctx={ctx}
          fileRef={ref}
          className="shrink-0 cursor-pointer font-medium text-[var(--accent)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
          title={`Open ${row.resolved}${row.line === null ? '' : `:${String(row.line)}`}`}
        >
          {row.name}
        </FileLink>
      ) : (
        <span className="shrink-0 font-medium">{row.name}</span>
      )}
      {row.line !== null && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">:{row.line}</span>}
      {row.hits > 1 && (
        <span className="shrink-0 text-[10px] text-[var(--text-dim)]" title={`Named ${String(row.hits)} times`}>
          ×{row.hits}
        </span>
      )}
      {asWritten && (
        <span
          className="max-w-72 shrink truncate font-mono text-[10px] text-[var(--text-dim)]/70"
          title={`As the answer wrote it: ${row.ref}`}
        >
          {asWritten}
        </span>
      )}
      {/* Only where the list is MIXED. In this corpus a session's mentions are
          usually all from reports — 23 of 23 in one — and a chip on every row is
          a chip that says nothing; the panel states it once instead. */}
      {showOrigin && row.fromReport && (
        <Chip tone="quiet" title="Named in a subagent's report rather than in the conversation's own words.">
          in a report
        </Chip>
      )}
      <span className="min-w-0 flex-1" />
      <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70" title={`${formatBytes(row.sizeBytes)} on disk`}>
        {formatBytes(row.sizeBytes)}
      </span>
      <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70" title="Last modified — the file itself, not the mention">
        {formatDateTime(row.modifiedAt)}
      </span>
      <span className="w-40 shrink-0 truncate text-right font-mono text-[10px] text-[var(--text-dim)]/70" title={row.resolved}>
        {folderTail(row.resolved, row.name)}
      </span>
      <button
        type="button"
        disabled={!messageUuid}
        onClick={messageUuid ? () => onGoToMessage(messageUuid) : undefined}
        className={`shrink-0 text-[10px] ${
          messageUuid
            ? 'cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 hover:border-[var(--text-dim)] hover:text-[var(--text)]'
            : 'cursor-default rounded border border-[var(--border)] px-1.5 py-0.5 opacity-40'
        }`}
        title={messageUuid ? 'Go to where it was first named' : 'Nothing in this transcript anchors it'}
      >
        ↑ the mention
      </button>
    </div>
  );
}

/**
 * The files the conversation only TALKED about.
 *
 * The third question in the header, and the weakest of the three by nature: a
 * delivery and an edit are things that HAPPENED to a file, while a mention is a
 * sentence — so this panel is the one that has to earn its rows. It lists a
 * mention only where the path resolves to a file that is really there, is not a
 * folder, and is in neither of the other two panels; everything else is counted
 * and explained rather than shown. On this corpus that is a handful of rows per
 * session, and they are the ones nothing else in the app would tell you about.
 *
 * Which is also why there is no disk column here: existing is the entry price,
 * not a finding. The size and the date are the file's own, and they are the
 * answer to the only question left once a row is on screen — is this still the
 * thing the answer was talking about.
 *
 * Presentational on purpose. `collectMentionedFiles` and `filterMentions` are
 * pure and live in `lib/mentionedFiles.ts`; the page owns the request, because
 * the header's count is the FILTERED count and only the server can produce it.
 */
export function MentionedFilesPanel({
  data,
  pending,
  error,
  onGoToMessage,
}: {
  data: MentionedFiles | null;
  pending: boolean;
  error: string | null;
  onGoToMessage: (uuid: string) => void;
}) {
  const rows = data?.rows ?? [];
  // Whether WHERE a mention came from tells one row from another. When every row
  // has the same answer it belongs in the heading, said once.
  const mixedOrigins = rows.some((r) => r.fromReport) && rows.some((r) => !r.fromReport);
  const allFromReports = rows.length > 0 && rows.every((r) => r.fromReport);
  return (
    <div className="max-h-[45vh] overflow-y-auto border-b border-[var(--border)] bg-[var(--bg-raised)]/50 px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        Files this session only mentioned{data ? ` — ${String(data.rows.length)}` : ''}
        <span className="ml-2 font-normal normal-case opacity-70">
          (paths its answers named as a link or in backticks, that are on disk and in neither other panel
          {allFromReports ? ' — every one of them named in a subagent’s report' : ''})
        </span>
        {error && <span className="ml-2 font-normal normal-case text-red-400">could not read the disk: {error}</span>}
      </div>
      {pending && <div className="px-2 py-1 text-xs text-[var(--text-dim)]">Asking the disk…</div>}
      {data?.rows.map((row) => (
        <MentionRowView key={row.resolved} row={row} showOrigin={mixedOrigins} onGoToMessage={onGoToMessage} />
      ))}
      {data && data.rows.length === 0 && (
        <div className="px-2 py-1 text-xs text-[var(--text-dim)]">
          Nothing left to show: every path this session named is either not on disk or already in one of the other two
          panels.
        </div>
      )}
      {data && <Dropped data={data} />}
    </div>
  );
}
