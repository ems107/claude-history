import type { RequestListEntry, RequestTables, Turn } from '@claude-history/shared';
import { requestChanges } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { buildContextIndex, type ContextPoint, formatGap, requestChangeLabel, requestChangeText } from '../../lib/context.ts';
import { formatDateTime, formatTimeOfDay } from '../../lib/format.ts';
import { anchorOfKey } from '../../lib/highlight.ts';
import { useSelectedMessage } from '../../lib/selectedMessage.ts';

type Mark = 'new-chain' | 'rewritten' | 'changed' | 'recached' | 'unanswered';

const MARKS: Record<Mark, { chip: string; hint: string }> = {
  'new-chain': {
    chip: '⟲ new chain',
    hint: 'The CLI sent the whole conversation afresh: the first request, a resume, a compaction',
  },
  rewritten: { chip: '✎ rewritten', hint: 'It kept fewer of the earlier messages than the request before it sent' },
  changed: { chip: 'Δ changed', hint: 'The system prompt, the tools or a parameter differs from the request before' },
  recached: { chip: '↺ re-cached', hint: 'It had to write context the cache already held' },
  unanswered: { chip: 'no reply', hint: 'Nothing answered it: interrupted, refused, or still in flight' },
};

interface Row {
  entry: RequestListEntry;
  point: ContextPoint | null;
  marks: Mark[];
  /** What changed against the answered request before it, word by word and in full. */
  changes: Array<{ label: string; text: string }>;
}

/**
 * Every request the session sent to the API, newest first — which of them
 * started a new chain, rewrote the history, changed what was offered or had to
 * re-cache, without opening any of them. A row opens its request beside the
 * conversation.
 *
 * The list is the server's (`/requests`), because only it holds the requests
 * nothing answered, and numbering only the answered ones would number them
 * differently from the column. The sizes and the re-caches are the context
 * index's, joined on the reply.
 */
export function RequestsPanel({
  sessionId,
  turns,
  tables,
  openRequestId,
  onOpen,
}: {
  sessionId: string;
  turns: Turn[];
  tables: RequestTables;
  openRequestId: string | null;
  onOpen: (requestId: string) => void;
}) {
  // Under the session's own key, so every change to the transcript refreshes it.
  const list = useQuery({ queryKey: ['session', sessionId, 'requests'], queryFn: () => api.requests(sessionId) });
  const context = useMemo(() => buildContextIndex(turns, tables), [turns, tables]);

  /** A selected tool call is selected through the message that made it. */
  const messageOfTool = useMemo(() => {
    const map = new Map<string, string>();
    for (const turn of turns) {
      for (const item of turn.items) {
        for (const b of item.blocks) if (b.kind === 'tool') map.set(b.toolUseId, item.uuid);
      }
    }
    return map;
  }, [turns]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let previous: ContextPoint | null = null;
    for (const entry of list.data?.requests ?? []) {
      const point = entry.replyUuid ? (context.byUuid.get(entry.replyUuid) ?? null) : null;
      const marks: Mark[] = [];
      if (entry.newChain) marks.push('new-chain');
      if (entry.rewritten) marks.push('rewritten');
      let changes: Row['changes'] = [];
      if (point?.request && previous?.request) {
        changes = requestChanges(previous.request, point.request, tables).flatMap((c) => {
          const label = requestChangeLabel(c);
          return label ? [{ label, text: requestChangeText(c) }] : [];
        });
      }
      if (changes.length > 0) marks.push('changed');
      if (point && point.recached > 0) marks.push('recached');
      if (!entry.replyUuid) marks.push('unanswered');
      out.push({ entry, point, marks, changes });
      if (point?.request) previous = point;
    }
    return out.reverse();
  }, [list.data, context, tables]);

  const counts = useMemo(() => {
    const c = new Map<Mark, number>();
    for (const r of rows) for (const m of r.marks) c.set(m, (c.get(m) ?? 0) + 1);
    return c;
  }, [rows]);

  const [filter, setFilter] = useState<Mark | null>(null);
  const shown = filter ? rows.filter((r) => r.marks.includes(filter)) : rows;

  const selectedKey = useSelectedMessage();
  const selectedReply = useMemo(() => {
    const { uuid, toolUseId } = anchorOfKey(selectedKey);
    return toolUseId ? (messageOfTool.get(toolUseId) ?? null) : uuid;
  }, [selectedKey, messageOfTool]);

  // The selected message's row comes into view as the panel opens and as the
  // selection moves — the panel is how a phone reaches a request at all.
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const row = rows.find((r) => r.entry.replyUuid === selectedReply);
    if (row) rowRefs.current.get(row.entry.id)?.scrollIntoView({ block: 'nearest' });
  }, [selectedReply, rows]);

  if (list.isPending) return <div className="p-3 text-[12px] text-[var(--text-dim)]">Reading the requests…</div>;
  if (list.isError) {
    return <div className="p-3 text-[12px] text-amber-300">The requests could not be read: {String(list.error)}</div>;
  }

  return (
    <div className="flex flex-col">
      <p className="px-3 pt-2.5 pb-2 text-[11.5px] text-[var(--text-dim)]">
        What this session sent to the API, newest first. Open one to see everything Claude received.
      </p>
      {counts.size > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-3 pb-2">
          <FilterChip on={filter === null} onClick={() => setFilter(null)} hint="Every request">
            {`All ${rows.length}`}
          </FilterChip>
          {(Object.keys(MARKS) as Mark[])
            .filter((m) => counts.has(m))
            .map((m) => (
              <FilterChip key={m} on={filter === m} onClick={() => setFilter(filter === m ? null : m)} hint={MARKS[m].hint}>
                {`${MARKS[m].chip} ${counts.get(m)}`}
              </FilterChip>
            ))}
        </div>
      )}
      <div className="flex flex-col">
        {shown.map((r) => (
          <RequestRow
            key={r.entry.id}
            row={r}
            max={context.max}
            open={r.entry.id === openRequestId}
            selected={!!selectedReply && r.entry.replyUuid === selectedReply}
            onOpen={() => onOpen(r.entry.id)}
            refCallback={(el) => {
              if (el) rowRefs.current.set(r.entry.id, el);
              else rowRefs.current.delete(r.entry.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  hint,
  children,
}: {
  on: boolean;
  onClick: () => void;
  hint: string;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={on}
      className={`rounded-full border px-2 py-px text-[10.5px] max-md:py-1 ${
        on
          ? 'border-[var(--accent)] text-[var(--text)]'
          : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  );
}

const MARK_TONE: Record<Mark, string> = {
  'new-chain': 'border-sky-500/40 text-sky-300',
  rewritten: 'border-violet-400/40 text-violet-300',
  changed: 'border-violet-400/40 text-violet-300',
  recached: 'border-amber-500/40 text-amber-300',
  unanswered: 'border-[var(--border)] text-[var(--text-dim)] italic',
};

function RequestRow({
  row,
  max,
  open,
  selected,
  onOpen,
  refCallback,
}: {
  row: Row;
  max: number;
  open: boolean;
  selected: boolean;
  onOpen: () => void;
  refCallback: (el: HTMLButtonElement | null) => void;
}) {
  const { entry, point, marks, changes } = row;
  const total = point?.total ?? null;
  return (
    <button
      ref={refCallback}
      type="button"
      onClick={onOpen}
      aria-current={open ? 'true' : undefined}
      className={`grid grid-cols-[3.25rem_4rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-b border-[var(--border)]/60 px-3 py-1.5 text-left text-[11.5px] hover:bg-[var(--bg-hover)] max-md:py-2.5 ${
        open ? 'bg-[var(--bg-hover)] shadow-[inset_2px_0_0_var(--accent)]' : ''
      } ${selected ? 'outline-1 -outline-offset-1 outline-[var(--accent)]/70' : ''}`}
    >
      <span className="font-mono text-[var(--text-dim)] tabular-nums">#{entry.index}</span>
      <span className="font-mono text-[var(--text-dim)] tabular-nums" title={formatDateTime(entry.at)}>
        {formatTimeOfDay(entry.at)}
      </span>
      <span
        className="relative h-1.5 overflow-hidden rounded bg-[var(--border)]"
        title={total === null ? 'No reply, so no size was billed' : `${total.toLocaleString()} tokens of context sent`}
      >
        {total !== null && max > 0 && (
          <span className="absolute inset-y-0 left-0 bg-sky-700" style={{ width: `${(total / max) * 100}%` }} />
        )}
      </span>
      <span className="col-span-3 flex flex-wrap gap-1 empty:hidden">
        {total !== null && (
          <span className="font-mono text-[10px] text-[var(--text-dim)] tabular-nums">
            {(total / 1000).toFixed(1)}k ctx
          </span>
        )}
        {!entry.newChain && entry.added > 0 && (
          <span
            className="rounded border border-[var(--border)] px-1 text-[10px] text-[var(--text-dim)]"
            title={`${entry.added} message${entry.added === 1 ? '' : 's'} sent for the first time; ${entry.kept} kept from the request before`}
          >
            +{entry.added}
          </span>
        )}
        {marks
          .filter((m) => m !== 'changed')
          .map((m) => (
            <span key={m} className={`rounded border px-1 text-[10px] ${MARK_TONE[m]}`} title={MARKS[m].hint}>
              {m === 'recached' && point?.gapMs != null ? `${MARKS[m].chip} · ${formatGap(point.gapMs)}` : MARKS[m].chip}
            </span>
          ))}
        {changes.map((c) => (
          <span key={c.label} className={`rounded border px-1 text-[10px] ${MARK_TONE.changed}`} title={c.text}>
            Δ {c.label}
          </span>
        ))}
      </span>
    </button>
  );
}
