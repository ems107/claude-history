import { isImagePath, parseFileRef } from '../../lib/fileRefs.ts';
import { folderTail, formatBytes, formatDateTime } from '../../lib/format.ts';
import { mentionTerms, type MentionedFiles, type MentionRow } from '../../lib/mentionedFiles.ts';
import { Chip } from './Chip.tsx';
import { useFileRefs } from './FileRefContext.ts';
import { FileLink } from './FileRefLink.tsx';

/**
 * The panel summarising itself, in one line.
 *
 * It is not an apology and it is not optional. Most of what an answer names is a
 * partial path or a placeholder, so a reader who can see fourteen links in the
 * messages and eight rows here needs the sentence that reconciles the two — and
 * a row that points at nothing has to be counted out loud rather than left to be
 * noticed one chip at a time.
 */
function Dropped({ data }: { data: MentionedFiles }) {
  const parts = [
    data.missing > 0 ? `${String(data.missing)} of them point at nothing` : null,
    data.dropped.folder > 0 ? `${String(data.dropped.folder)} named a folder and are not listed` : null,
    data.unchecked > 0 ? `${String(data.unchecked)} past the batch limit, never checked` : null,
  ].filter((p): p is string => !!p);
  if (parts.length === 0) return null;
  return (
    <div className="mt-1.5 px-2 text-[11px] text-[var(--text-dim)]/80">
      {parts.join(' · ')}
      <span className="ml-2 opacity-60">
        — a path in prose is written for a person, so a partial one or a placeholder finds nothing
      </span>
    </div>
  );
}

function MentionRowView({
  row,
  onGoToMessage,
  onFindEverywhere,
}: {
  row: MentionRow;
  onGoToMessage: (uuid: string, terms: string[]) => void;
  onFindEverywhere: (terms: string[]) => void;
}) {
  const ctx = useFileRefs();
  // Resolved, and with the line the sentence pointed at: the panel opens where
  // the answer was looking, which a bare path would lose.
  const ref = ctx ? parseFileRef(row.line === null ? row.resolved : `${row.resolved}:${String(row.line)}`) : null;
  // Where the jump goes: the first message that named it. The others are reached
  // through the badge, which hands the whole conversation to the find bar.
  const anchor = row.messages[0] ?? null;
  const places = row.messages.length;
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
        // Still a link when the file is gone — the panel behind it says so and
        // still offers the folder — but drawn in the dim colour, so the list can
        // be read at a glance without checking every chip.
        <FileLink
          ctx={ctx}
          fileRef={ref}
          className={`shrink-0 cursor-pointer font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid ${
            row.exists ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'
          }`}
          title={
            row.exists
              ? `Open ${row.resolved}${row.line === null ? '' : `:${String(row.line)}`}`
              : `Nothing is at ${row.resolved} — the panel will say so, and still offer its folder`
          }
        >
          {row.name}
        </FileLink>
      ) : (
        <span className="shrink-0 font-medium">{row.name}</span>
      )}
      {row.line !== null && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">:{row.line}</span>}
      {/* PLACES, not namings — and it is the way to them rather than a note about
          them. `×4` used to count occurrences while the jump could only take you
          to one of them and mark the ones in that message, so the badge promised
          four stops for a file that might have been named four times in a single
          paragraph. One press now hands the path to the find bar on `All`, which
          already owns stepping, counting and marking across the conversation:
          a second "next occurrence" here would be two implementations of one idea,
          and they would disagree. */}
      {places > 1 && (
        <button
          type="button"
          onClick={() => onFindEverywhere(mentionTerms(row))}
          className="shrink-0 cursor-pointer rounded px-1 text-[10px] text-[var(--text-dim)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)]"
          title={`Named in ${String(places)} messages${
            row.hits > places ? `, ${String(row.hits)} times in all` : ''
          } — find every one of them in the conversation`}
        >
          ×{places}
        </button>
      )}
      {asWritten && (
        <span
          className="max-w-72 shrink truncate font-mono text-[10px] text-[var(--text-dim)]/70"
          title={`As the answer wrote it: ${row.ref}`}
        >
          {asWritten}
        </span>
      )}
      {/* Context, never a reason to hide the row: a file the answers keep pointing
          at is usually one the session also worked on, and dropping those took the
          most obvious mentions of a session with them. */}
      {row.alsoIn && (
        <Chip
          tone="quiet"
          title={
            row.alsoIn === 'changed'
              ? 'This session also edited it — it is in Changed Files too.'
              : 'This session also handed it over — it is in Sent Files too.'
          }
        >
          {row.alsoIn === 'changed' ? 'also changed' : 'also sent'}
        </Chip>
      )}
      {!row.exists && (
        <Chip
          tone="warn"
          title={`Nothing is at ${row.resolved}. Either the path is partial or a placeholder — written for a person to read — or the file has moved or gone since the answer named it.`}
        >
          not found
        </Chip>
      )}
      <span className="min-w-0 flex-1" />
      {/* Measured only where there is something to measure. A row pointing at
          nothing showed "0 B" and a 1970 date for one draft, which is a lie told
          twice about a file that simply is not there. */}
      {row.sizeBytes !== null && (
        <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70" title={`${formatBytes(row.sizeBytes)} on disk`}>
          {formatBytes(row.sizeBytes)}
        </span>
      )}
      {row.modifiedAt && (
        <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70" title="Last modified — the file itself, not the mention">
          {formatDateTime(row.modifiedAt)}
        </span>
      )}
      <span className="w-40 shrink-0 truncate text-right font-mono text-[10px] text-[var(--text-dim)]/70" title={row.resolved}>
        {folderTail(row.resolved, row.name)}
      </span>
      <button
        type="button"
        disabled={!anchor}
        onClick={anchor ? () => onGoToMessage(anchor, mentionTerms(row)) : undefined}
        className={`shrink-0 text-[10px] ${
          anchor
            ? 'cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 hover:border-[var(--text-dim)] hover:text-[var(--text)]'
            : 'cursor-default rounded border border-[var(--border)] px-1.5 py-0.5 opacity-40'
        }`}
        title={
          anchor
            ? `Go to where it was first named${places > 1 ? ` (of ${String(places)})` : ''}, with the path underlined in the message`
            : 'Nothing in this transcript anchors it'
        }
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
  onFindEverywhere,
}: {
  data: MentionedFiles | null;
  pending: boolean;
  error: string | null;
  onGoToMessage: (uuid: string, terms: string[]) => void;
  /** Hands a path to the find bar, on `All`: what "the other three" needs. */
  onFindEverywhere: (terms: string[]) => void;
}) {
  return (
    <div className="max-h-[45vh] overflow-y-auto border-b border-[var(--border)] bg-[var(--bg-raised)]/50 px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        Files this session only mentioned{data ? ` — ${String(data.rows.length)}` : ''}
        <span className="ml-2 font-normal normal-case opacity-70">
          (paths its own answers named as a link or in backticks — a click opens the file, ↑ goes to the sentence with
          the path underlined in it)
        </span>
        {error && <span className="ml-2 font-normal normal-case text-red-400">could not read the disk: {error}</span>}
      </div>
      {pending && <div className="px-2 py-1 text-xs text-[var(--text-dim)]">Asking the disk…</div>}
      {data?.rows.map((row) => (
        <MentionRowView
          key={row.resolved}
          row={row}
          onGoToMessage={onGoToMessage}
          onFindEverywhere={onFindEverywhere}
        />
      ))}
      {data && data.rows.length === 0 && (
        <div className="px-2 py-1 text-xs text-[var(--text-dim)]">
          Nothing to show: this session’s answers named no file path at all.
        </div>
      )}
      {data && <Dropped data={data} />}
    </div>
  );
}
