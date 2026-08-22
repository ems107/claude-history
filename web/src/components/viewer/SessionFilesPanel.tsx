import type { FileStatEntry } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { normalisePath, parseFileRef } from '../../lib/fileRefs.ts';
import { folderTail, formatBytes, formatDateTime } from '../../lib/format.ts';
import { sessionFilePaths, type SessionFileRow, type SessionFiles } from '../../lib/sessionFiles.ts';
import { Chip } from './Chip.tsx';
import { useFileRefs } from './FileRefContext.ts';
import { FileLink } from './FileRefLink.tsx';


/**
 * The jump, disabled but still explaining itself — `SubagentsPanel`'s rule, and
 * for the same reason: a dead button that says nothing is worse than no button.
 */
function JumpButton({ jump }: { jump: { run: (() => void) | null; why: string; label: string } }) {
  return (
    <button
      type="button"
      disabled={!jump.run}
      onClick={jump.run ?? undefined}
      className={`shrink-0 text-[10px] ${
        jump.run
          ? 'cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 hover:border-[var(--text-dim)] hover:text-[var(--text)]'
          : 'cursor-default rounded border border-[var(--border)] px-1.5 py-0.5 opacity-40'
      }`}
      title={jump.why}
    >
      {jump.label}
    </button>
  );
}

/** Later than the row's own clock by more than a rounding error. */
const REWRITE_SLACK_MS = 2000;

/**
 * What the disk says: one column, one meaning, three answers.
 *
 * The date on disk is deliberately NOT one of them. Drawn raw it sat beside the
 * row's own timestamp as a second unlabelled date, and two dates in a row that
 * mean different things read as neither — so the interesting part of it is
 * computed instead ("this changed after the session recorded it") and the number
 * itself lives on the title, next to the size.
 *
 * `changed` is earned two ways because the rows are not all alike: a delivery
 * knows the size it was sent at, and a plan file knows no size at all — but its
 * clock still says whether plan mode has since written over it, which is the one
 * thing worth knowing about a file that holds only the LATEST plan for its slug.
 *
 * `pending` draws a dim ellipsis rather than nothing: the column has to hold its
 * width from the first paint, or every row shifts when the answer lands.
 */
function DiskState({ row, stat, pending }: { row: SessionFileRow; stat: FileStatEntry | undefined; pending: boolean }) {
  if (pending) return <span className="shrink-0 text-[10px] text-[var(--text-dim)]/60">…</span>;
  if (!stat) return null;
  if (!stat.exists) {
    return (
      <Chip
        tone="warn"
        title={stat.error ?? `Nothing is at ${stat.path} now. What a session hands over lives in its temp scratchpad, which Windows sweeps, so this is an ordinary end for one — not a failure.`}
      >
        {stat.error ? 'unreadable' : 'no longer on disk'}
      </Chip>
    );
  }
  const state = `${formatBytes(stat.sizeBytes)} on disk, modified ${formatDateTime(stat.modifiedAt)}`;
  const resized = row.sizeBytes !== null && stat.sizeBytes !== row.sizeBytes;
  const rewritten =
    !!row.timestamp &&
    !!stat.modifiedAt &&
    Date.parse(stat.modifiedAt) - Date.parse(row.timestamp) > REWRITE_SLACK_MS;
  if (resized || rewritten) {
    return (
      <Chip
        tone="warn"
        title={
          resized
            ? `${state} — it was ${row.sizeBytes === null ? 'unknown' : formatBytes(row.sizeBytes)} when this session handed it over.`
            : `${state} — after this session recorded it. What is there now is not what this row is about.`
        }
      >
        changed since
      </Chip>
    );
  }
  return (
    <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70" title={state}>
      on disk
    </span>
  );
}

function FileRow({
  row,
  stat,
  pending,
  onGoToCall,
  onGoToMessage,
}: {
  row: SessionFileRow;
  stat: FileStatEntry | undefined;
  pending: boolean;
  onGoToCall: (toolUseId: string) => void;
  onGoToMessage: (uuid: string) => void;
}) {
  const ctx = useFileRefs();
  const ref = ctx ? parseFileRef(row.path) : null;
  const sent = [row.mediaType, row.sizeBytes === null ? null : formatBytes(row.sizeBytes)]
    .filter((d): d is string => !!d)
    .join(' · ');
  // The call when this transcript holds it, the message otherwise — a plan-mode
  // line is not a tool call and has only its own uuid to be found by.
  // Destructured so the narrowing survives into the closures: they are fields of
  // a mutable object, and TypeScript rightly forgets what it knew about one by
  // the time the click happens.
  const { toolUseId, messageUuid } = row;
  const jump = toolUseId
    ? { run: () => onGoToCall(toolUseId), why: 'Go to the call that handed it over', label: '↑ the call' }
    : messageUuid
      ? // A plan file is not delivered by a call: what names it is a plan-mode
        // line, and saying "the call" of one would be a small lie in a button.
        { run: () => onGoToMessage(messageUuid), why: 'Go to where the conversation recorded it', label: '↑ the line' }
      : { run: null, why: 'Nothing in this transcript points at it', label: '↑ the call' };

  return (
    <div className="flex items-baseline gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--bg-hover)]">
      <span aria-hidden className="shrink-0 opacity-70">
        {row.kind === 'plan' ? '📋' : row.isImage ? '🖼' : '📄'}
      </span>
      {ref && ctx ? (
        <FileLink
          ctx={ctx}
          fileRef={ref}
          className="shrink-0 cursor-pointer font-medium text-[var(--accent)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
          title={`Open ${row.path}`}
        >
          {row.name}
        </FileLink>
      ) : (
        <span className="shrink-0 font-medium">{row.name}</span>
      )}
      {/* Only where a repeat means a second delivery. Plan mode writes the same
          precomputed path on every line it emits — up to 60 of them in one
          session — and `×47` beside a plan would be counting mentions of a file
          as if it had been handed over 47 times. */}
      {row.count > 1 && row.kind !== 'plan' && (
        <span className="shrink-0 text-[10px] text-[var(--text-dim)]" title={`Handed over ${String(row.count)} times`}>
          ×{row.count}
        </span>
      )}
      {sent && (
        <span className="shrink-0 text-[11px] text-[var(--text-dim)]" title="As sent — what the transcript recorded">
          {sent}
        </span>
      )}
      {row.action && row.action !== 'publish' && <Chip tone="quiet" title={`Artifact action: ${row.action}`}>{row.action}</Chip>}
      {row.unvalidated && (
        <Chip tone="warn" title="Claude Code could not confirm the file was at this path when it was sent.">
          unconfirmed path
        </Chip>
      )}
      {row.pending && (
        <Chip tone="quiet" title="No result recorded: it was still in flight when the transcript was written.">
          still sending
        </Chip>
      )}
      {row.failed && (
        <Chip tone="warn" title="The tool reported an error. The file may never have reached the user.">
          it failed
        </Chip>
      )}
      {/* The note takes the slack so the two ends of the row stay put: the
          delivery's caption is the half that says which screenshot is which. */}
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-dim)]/80" title={row.note ?? undefined}>
        {row.note}
      </span>
      <DiskState row={row} stat={stat} pending={pending} />
      {row.timestamp && <span className="shrink-0 text-[10px] text-[var(--text-dim)]/70">{formatDateTime(row.timestamp)}</span>}
      <span className="w-40 shrink-0 truncate text-right font-mono text-[10px] text-[var(--text-dim)]/70" title={row.path}>
        {folderTail(row.path, row.name)}
      </span>
      <JumpButton jump={jump} />
    </div>
  );
}

function Section({
  title,
  hint,
  rows,
  stats,
  pending,
  onGoToCall,
  onGoToMessage,
}: {
  title: string;
  hint: string;
  rows: SessionFileRow[];
  stats: Map<string, FileStatEntry>;
  pending: boolean;
  onGoToCall: (toolUseId: string) => void;
  onGoToMessage: (uuid: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-0.5 px-2 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        {title} — {rows.length}
        <span className="ml-2 font-normal normal-case opacity-70">{hint}</span>
      </div>
      {rows.map((row) => (
        <FileRow
          key={row.key}
          row={row}
          stat={stats.get(row.key)}
          pending={pending}
          onGoToCall={onGoToCall}
          onGoToMessage={onGoToMessage}
        />
      ))}
    </div>
  );
}

/**
 * Everything the session handed over, in one place, with the state of each on
 * disk right now.
 *
 * The list itself is read off the transcript by `collectSessionFiles`, which is
 * pure and shares its delivery parser with the card in the conversation and with
 * the markdown export — the three cannot disagree about what was sent. The only
 * thing asked of the server is the `stat`, in ONE request for the whole panel:
 * these paths live in the session's temp scratchpad, so "it is not there any
 * more" is the ordinary state of a delivery rather than a failure, and a list of
 * dead links that does not admit it is worth less than no list.
 *
 * A plan file is the one row that names a file the session did not choose the
 * name of, and it holds only the LATEST plan for that slug — said in the section
 * hint rather than per row, because it is true of every one of them.
 */
export function SessionFilesPanel({
  sessionId,
  files,
  onGoToCall,
  onGoToMessage,
}: {
  sessionId: string;
  files: SessionFiles;
  onGoToCall: (toolUseId: string) => void;
  onGoToMessage: (uuid: string) => void;
}) {
  const paths = sessionFilePaths(files);
  const statsQ = useQuery({
    // Keyed on the paths and not on the session: a live session that delivers
    // another file has a new key and asks again, while re-opening the panel on
    // an unchanged list is free.
    queryKey: ['fileStats', sessionId, paths],
    queryFn: () => api.fileStats(sessionId, paths),
    enabled: paths.length > 0,
    staleTime: 30_000,
  });
  // Joined on the ref the server echoed back, normalised the one way the whole
  // app normalises a path — never on the resolved one, which is the server's
  // answer and not the key any row here was built with.
  const stats = new Map((statsQ.data?.files ?? []).map((f) => [normalisePath(f.ref), f]));

  return (
    <div className="px-4 py-3">
      {/* The name and the count are the inspector's title bar now. */}
      <div className="mb-2 text-[11px] text-[var(--text-dim)]/80">
        sizes are as sent; the state on the right is the disk right now
        {statsQ.isError && <span className="ml-2 text-red-400">could not read the disk: {String(statsQ.error)}</span>}
      </div>
      <Section
        title="Delivered to you"
        hint="SendUserFile — handed over by path; the bytes were never in the transcript"
        rows={files.sent}
        stats={stats}
        pending={statsQ.isPending}
        onGoToCall={onGoToCall}
        onGoToMessage={onGoToMessage}
      />
      <Section
        title="Published as an artifact"
        hint="the local file the page was rendered from"
        rows={files.artifacts}
        stats={stats}
        pending={statsQ.isPending}
        onGoToCall={onGoToCall}
        onGoToMessage={onGoToMessage}
      />
      <Section
        title="Plan files"
        hint="~/.claude/plans — one file per slug, holding only the LATEST plan written to it"
        rows={files.plans}
        stats={stats}
        pending={statsQ.isPending}
        onGoToCall={onGoToCall}
        onGoToMessage={onGoToMessage}
      />
    </div>
  );
}
