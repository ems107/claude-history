import type {
  RequestBlockSummary,
  RequestCacheMark,
  RequestDetailResponse,
  RequestFacts,
  RequestMessageSummary,
  RequestTables,
  Turn,
} from '@claude-history/shared';
import { requestChanges } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { requestChangeText } from '../../lib/context.ts';
import { formatDateTime, shortModel } from '../../lib/format.ts';
import { Fold } from '../Fold.tsx';

type Tab = 'messages' | 'system' | 'tools' | 'params';

/** How much of a block is drawn before "Show all": a CLAUDE.md alone is 45,000 characters. */
const CLIP = 4000;

const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * One request, beside the conversation: what Claude Code sent to the API for
 * one reply, rebuilt from the transcript (`core/requestBodies.ts`).
 *
 * The parts are drawn in the order the API reads them — tools, then the system
 * prompt, then the messages — because that is the order the cache reads them
 * in, and a breakpoint only means something at its place in that order.
 * Messages come first among the tabs all the same: they are what changes from
 * one request to the next, and what the conversation does not show.
 */
export function RequestColumn({
  sessionId,
  requestId,
  turns,
  tables,
  mobile,
  onOpen,
  onClose,
  onGoToMessage,
  onGoToCall,
}: {
  sessionId: string;
  requestId: string;
  turns: Turn[];
  tables: RequestTables;
  mobile: boolean;
  onOpen: (requestId: string) => void;
  onClose: () => void;
  onGoToMessage: (uuid: string) => void;
  onGoToCall: (toolUseId: string) => void;
}) {
  // Under the session's key: a request is written once and never changes, but
  // the one still being answered gains its reply, and the last one a next.
  const query = useQuery({
    queryKey: ['session', sessionId, 'request', requestId],
    queryFn: () => api.request(sessionId, requestId),
  });
  const [tab, setTab] = useState<Tab>('messages');

  /** The request facts the conversation already holds, for what changed against the one before. */
  const facts = useMemo(() => {
    const map = new Map<string, RequestFacts>();
    for (const turn of turns) for (const item of turn.items) if (item.request) map.set(item.request.id, item.request);
    return map;
  }, [turns]);

  const d = query.data;
  return (
    <>
      <div className="flex shrink-0 flex-col gap-1 border-b border-[var(--border)] bg-[var(--bg-raised)] px-4 py-2 max-md:px-3">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            Request {d ? d.index : '…'}
            {d && <span className="font-normal text-[var(--text-dim)]"> of {d.count}</span>}
          </span>
          <StepButton label="‹" title="The request before" target={d?.prevId ?? null} onOpen={onOpen} />
          <StepButton label="›" title="The request after" target={d?.nextId ?? null} onOpen={onOpen} />
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded px-2 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] max-md:min-h-10 max-md:px-3 max-md:text-lg"
            title="Close (Esc)"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {d && <HeaderFacts d={d} onGoToMessage={onGoToMessage} />}
      </div>

      {query.isPending && <p className="p-4 text-[12px] text-[var(--text-dim)]">Rebuilding the request…</p>}
      {query.isError && (
        <p className="p-4 text-[12px] text-amber-300">The request could not be read: {String(query.error)}</p>
      )}
      {d && (
        <>
          {/* One scroller under the header, with the tabs pinned to its top:
              the summary is read once and then scrolls away, so the list gets
              the column. Held fixed, it took 300 px of it — on a phone, more
              than half the screen. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <WhatItSent d={d} />
            <SinceBefore
              d={d}
              cur={facts.get(d.id) ?? null}
              prev={d.prevId ? (facts.get(d.prevId) ?? null) : null}
              tables={tables}
            />
            <div
              role="tablist"
              className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--bg)] px-3"
            >
              <TabButton tab="messages" current={tab} onSelect={setTab} count={d.messages.length}>
                Messages
              </TabButton>
              <TabButton tab="system" current={tab} onSelect={setTab} count={d.system?.length ?? null}>
                System
              </TabButton>
              <TabButton tab="tools" current={tab} onSelect={setTab} count={d.tools?.length ?? null}>
                Tools
              </TabButton>
              <TabButton tab="params" current={tab} onSelect={setTab} count={null}>
                Parameters
              </TabButton>
            </div>
            {/* Keyed on the request: ‹ › keeps the tab, and starts its contents afresh. */}
            <div key={d.id}>
              {tab === 'messages' && (
                <MessagesTab
                sessionId={sessionId}
                d={d}
                onGoToMessage={onGoToMessage}
                onGoToCall={onGoToCall}
              />
              )}
              {tab === 'system' && <SystemTab d={d} />}
              {tab === 'tools' && <ToolsTab d={d} />}
              {tab === 'params' && <ParamsTab d={d} />}
            </div>
          </div>
          <Footer sessionId={sessionId} d={d} mobile={mobile} />
        </>
      )}
    </>
  );
}

function StepButton({
  label,
  title,
  target,
  onOpen,
}: {
  label: string;
  title: string;
  target: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={!target}
      onClick={() => target && onOpen(target)}
      title={title}
      aria-label={title}
      className={`shrink-0 rounded border border-[var(--border)] px-2 text-xs max-md:min-h-9 max-md:px-3 ${
        target ? 'cursor-pointer text-[var(--text)] hover:bg-[var(--bg-hover)]' : 'opacity-30'
      }`}
    >
      {label}
    </button>
  );
}

function querySourceLabel(q: string | null): string | null {
  if (q === 'repl_main_thread') return 'main thread';
  if (q === 'sdk') return 'SDK';
  return q;
}

function HeaderFacts({ d, onGoToMessage }: { d: RequestDetailResponse; onGoToMessage: (uuid: string) => void }) {
  const p = d.params;
  const thinking = (p.thinking ?? null) as { type?: string; display?: string } | null;
  const effort = ((p.output_config ?? null) as { effort?: string } | null)?.effort ?? null;
  const model = typeof p.model === 'string' ? p.model : null;
  const max = typeof p.max_tokens === 'number' ? p.max_tokens : null;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
        <span>{formatDateTime(d.timestamp)}</span>
        {d.reply ? (
          <button
            type="button"
            data-jump
            onClick={() => onGoToMessage(d.reply!.uuid)}
            className="cursor-pointer text-sky-300 hover:underline"
            title="Go to the reply in the conversation"
          >
            ↓ its answer
          </button>
        ) : (
          <span className="italic" title="Nothing answered it: interrupted, refused, or still in flight">
            no reply
          </span>
        )}
        {querySourceLabel(d.querySource) && <span>{querySourceLabel(d.querySource)}</span>}
        {d.version && <span>CLI {d.version}</span>}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
        {model && (
          <span className="text-[var(--text)]" title={model}>
            {shortModel(model) ?? model}
          </span>
        )}
        {effort && (
          <span>
            effort <b className="font-medium text-[var(--text)]">{effort}</b>
          </span>
        )}
        {thinking?.type && (
          <span>
            thinking <b className="font-medium text-[var(--text)]">{thinking.type}</b>
            {thinking.display ? ` · ${thinking.display}` : ''}
          </span>
        )}
        {max !== null && (
          <span>
            max <b className="font-medium text-[var(--text)]">{max.toLocaleString()}</b>
          </span>
        )}
      </div>
    </>
  );
}

/** Where a breakpoint falls, in characters from the start of the prompt (tools, system, messages). */
function markOffset(mark: RequestCacheMark, d: RequestDetailResponse): number | null {
  const [part, at] = mark.path;
  if (typeof at !== 'number') return null;
  const sum = (xs: Array<{ chars: number }>, upTo: number) => xs.slice(0, upTo + 1).reduce((n, x) => n + x.chars, 0);
  const tools = (d.tools ?? []).reduce((n, t) => n + t.chars, 0);
  const system = (d.system ?? []).reduce((n, b) => n + b.chars, 0);
  if (part === 'tools') return sum(d.tools ?? [], at);
  if (part === 'system') return tools + sum(d.system ?? [], at);
  if (part === 'messages') return tools + system + sum(d.messages, at);
  return null;
}

function markLabel(mark: RequestCacheMark): string {
  const [part, at] = mark.path;
  const where =
    part === 'system' && typeof at === 'number'
      ? `system block ${at + 1}`
      : part === 'messages' && typeof at === 'number'
        ? `message #${at}`
        : mark.path.join('.');
  return `${where} (${[mark.ttl ?? '5m', mark.scope].filter(Boolean).join(', ')})`;
}

function WhatItSent({ d }: { d: RequestDetailResponse }) {
  const tools = (d.tools ?? []).reduce((n, t) => n + t.chars, 0);
  const system = (d.system ?? []).reduce((n, b) => n + b.chars, 0);
  const messages = d.messages.reduce((n, m) => n + m.chars, 0);
  const total = tools + system + messages;
  const injected = d.messages.filter((m) => m.source === 'request');
  const injectedChars = injected.reduce((n, m) => n + m.chars, 0);
  const u = d.reply?.usage ?? null;
  const tokens = u ? u.input + u.cacheRead + u.cacheCreate : null;
  /** The billed total shared out by characters: the API gives one number per request, never one per part. */
  const approx = (chars: number) => (tokens !== null && total > 0 ? ` · ≈ ${k(Math.round((tokens * chars) / total))} tok` : '');
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="flex flex-col gap-1.5 border-b border-[var(--border)] px-4 py-2.5 max-md:px-3">
      <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
        <span>What it sent</span>
        <span className="font-mono tabular-nums">
          {tokens !== null ? <b className="font-medium">{tokens.toLocaleString()}</b> : '—'}
          <span className="text-[var(--text-dim)]">
            {' '}
            {tokens !== null ? 'tokens · ' : ''}
            {total.toLocaleString()} chars
          </span>
        </span>
      </div>
      <div className="relative mt-2 flex h-3.5 rounded" role="img" aria-label={`Tools ${pct(tools).toFixed(0)}%, system ${pct(system).toFixed(0)}%, messages ${pct(messages).toFixed(0)}%`}>
        <span className="h-full rounded-l bg-[#4c6a86]" style={{ width: `${pct(tools)}%` }} />
        <span className="h-full bg-[#8a6bbf]" style={{ width: `${pct(system)}%` }} />
        <span className="h-full rounded-r bg-[#3d7d6b]" style={{ width: `${pct(messages)}%` }} />
        {d.cacheMarks.map((m, i) => {
          const at = markOffset(m, d);
          return at === null ? null : (
            <span
              key={i}
              title={`Cache breakpoint: ${markLabel(m)}`}
              className="absolute -top-1.5 h-[calc(100%+0.75rem)] border-l-2 border-amber-400"
              style={{ left: `calc(${Math.min(100, pct(at))}% - 1px)` }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
        <Legend colour="#4c6a86">
          tools {k(tools)} chars{approx(tools)}
        </Legend>
        <Legend colour="#8a6bbf">
          system {k(system)}
          {approx(system)}
        </Legend>
        <Legend colour="#3d7d6b">
          messages {k(messages)}
          {approx(messages)}
        </Legend>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
        <span>
          of the messages, <span className="text-violet-300">{k(injectedChars)} only in the request</span> (
          {injected.length}) · {k(messages - injectedChars)} from the conversation ({d.messages.length - injected.length})
        </span>
        {u && (
          <span>
            read from cache {u.cacheRead.toLocaleString()} · written {u.cacheCreate.toLocaleString()} · new{' '}
            {u.input.toLocaleString()}
          </span>
        )}
        {!u && <span className="italic">nothing answered it, so nothing was billed</span>}
      </div>
      {d.cacheMarks.length > 0 && (
        <div className="text-[11px] text-amber-300/90">cache marks: {d.cacheMarks.map(markLabel).join(' · ')}</div>
      )}
      {tokens !== null && (
        <div className="-mx-1">
          <Fold label="How the ≈ is worked out">
            <p className="px-1 pb-1 text-[11px] text-[var(--text-dim)]">
              The API bills one number per request: the context it read and wrote, {tokens.toLocaleString()} tokens
              here. The split shares that number out by characters, so it is close but not exact — a tool's schema
              packs more tokens per character than prose does. The characters are exact.
            </p>
          </Fold>
        </div>
      )}
      {d.unresolved > 0 && (
        <div className="text-[11px] text-amber-300">
          {d.unresolved} message{d.unresolved === 1 ? '' : 's'} of this request could not be found in the transcript.
        </div>
      )}
    </div>
  );
}

function Legend({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="inline-block size-2.5 rounded-sm" style={{ background: colour }} />
      <span>{children}</span>
    </span>
  );
}

function SinceBefore({
  d,
  cur,
  prev,
  tables,
}: {
  d: RequestDetailResponse;
  cur: RequestFacts | null;
  prev: RequestFacts | null;
  tables: RequestTables;
}) {
  let text: ReactNode;
  if (d.newChain) {
    text = (
      <>
        <b className="font-medium text-sky-300">A new chain</b>: the whole conversation sent afresh — the first request, a
        resume or a compaction.
      </>
    );
  } else {
    const changes =
      cur && prev
        ? requestChanges(prev, cur, tables)
            .filter((c) => c.kind !== 'new-chain' && c.kind !== 'history-rewritten')
            .map(requestChangeText)
        : null;
    text = (
      <>
        Since #{d.index - 1}:{' '}
        <b className="font-medium text-[var(--text)]">
          {d.kept} message{d.kept === 1 ? '' : 's'} kept, {d.added} added.
        </b>
        {cur?.rewritten && <span className="text-violet-300"> Earlier messages were rewritten.</span>}
        {changes === null
          ? null
          : changes.length > 0
            ? ` Changed: ${changes.join('; ')}.`
            : ' Tools, system prompt and parameters unchanged.'}
      </>
    );
  }
  return (
    <div className="border-b border-[var(--border)] px-4 py-1.5 text-[11.5px] text-[var(--text-dim)] max-md:px-3">
      {text}
    </div>
  );
}

function TabButton({
  tab,
  current,
  onSelect,
  count,
  children,
}: {
  tab: Tab;
  current: Tab;
  onSelect: (t: Tab) => void;
  count: number | null;
  children: string;
}) {
  const on = tab === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={() => onSelect(tab)}
      className={`shrink-0 cursor-pointer border-b-2 px-2.5 pt-2 pb-1.5 text-[12px] max-md:px-3 max-md:py-2.5 ${
        on ? 'border-[var(--accent)] text-[var(--text)]' : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      {children}
      {count !== null && <span className="ml-1 font-mono text-[10.5px] text-[var(--text-dim)]">{count}</span>}
    </button>
  );
}

// ---- Messages ----

type MessageFilter = 'all' | 'request' | 'new';

const ROLE_TONE: Record<string, string> = {
  user: 'text-[var(--accent)]',
  assistant: 'text-emerald-400',
  system: 'text-violet-300',
};

/** One line saying what a message is made of: "thinking · Grep", "result of Bash", the start of its text. */
function messageSummary(m: RequestMessageSummary): string {
  const additions = m.blocks.filter((b) => b.type === 'tool_addition');
  const parts: string[] = [];
  let texts = 0;
  for (const b of m.blocks) {
    if (b.type === 'tool_addition') continue;
    if (b.type === 'text') {
      if (texts++ === 0) parts.push(b.preview.replace(/\s+/g, ' ').trim() || '(empty)');
    } else if (b.type === 'thinking') {
      const said = b.preview.replace(/\s+/g, ' ').trim();
      parts.push(b.narration ? `narration: ${said}` : said ? `thinking: ${said}` : 'thinking');
    }
    else if (b.type === 'tool_use') parts.push(b.name ?? 'a call');
    else if (b.type === 'tool_result') parts.push(`result of ${b.name ?? 'a call'}`);
    else parts.push(b.type);
  }
  if (texts > 1) parts.push(`+${texts - 1} more text block${texts === 2 ? '' : 's'}`);
  if (additions.length > 0) parts.push(`+${additions.length} tool${additions.length === 1 ? '' : 's'} added`);
  return parts.join(' · ') || '(empty)';
}

function MessagesTab({
  sessionId,
  d,
  onGoToMessage,
  onGoToCall,
}: {
  sessionId: string;
  d: RequestDetailResponse;
  onGoToMessage: (uuid: string) => void;
  onGoToCall: (toolUseId: string) => void;
}) {
  const [filter, setFilter] = useState<MessageFilter>('all');
  const [words, setWords] = useState('');
  const injected = d.messages.filter((m) => m.source === 'request').length;
  const added = d.messages.filter((m) => m.isNew).length;
  /** The messages a breakpoint was put on, for the dashed line after them. */
  const marked = new Map<number, RequestCacheMark>();
  for (const m of d.cacheMarks) if (m.path[0] === 'messages' && typeof m.path[1] === 'number') marked.set(m.path[1], m);

  const needle = words.trim().toLowerCase();
  const rows = d.messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => filter === 'all' || (filter === 'request' ? m.source === 'request' : m.isNew))
    .filter(
      ({ m }) =>
        !needle ||
        m.blocks.some((b) => b.preview.toLowerCase().includes(needle) || (b.name ?? '').toLowerCase().includes(needle)),
    );

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)]/60 px-4 py-2 max-md:px-3">
        <FilterChip on={filter === 'all'} onClick={() => setFilter('all')}>{`All ${d.messages.length}`}</FilterChip>
        {injected > 0 && (
          <FilterChip on={filter === 'request'} onClick={() => setFilter('request')}>
            {`Only in the request ${injected}`}
          </FilterChip>
        )}
        {added > 0 && <FilterChip on={filter === 'new'} onClick={() => setFilter('new')}>{`New ${added}`}</FilterChip>}
        <input
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter the messages"
          className="ml-auto w-36 rounded border border-[var(--border)] bg-[var(--bg-raised)] px-2 py-0.5 text-[11px] max-md:w-full max-md:py-1.5"
        />
      </div>
      <p className="px-4 py-1.5 text-[10.5px] text-[var(--text-dim)] max-md:px-3">
        <span className="text-violet-300">only in the request</span>: sent in this form only here — context the CLI
        injected, or a message it rewrote. The conversation does not show it.
      </p>
      {rows.length === 0 && <p className="px-4 py-3 text-[11.5px] text-[var(--text-dim)]">No message matches.</p>}
      {rows.map(({ m, i }) => (
        <div key={i}>
          <MessageRow
            sessionId={sessionId}
            requestId={d.id}
            index={i}
            m={m}
            display={thinkingDisplay(d)}
            onGoToMessage={onGoToMessage}
            onGoToCall={onGoToCall}
          />
          {marked.has(i) && <CacheLine mark={marked.get(i)!} />}
        </div>
      ))}
    </div>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`cursor-pointer rounded-full border px-2 py-px text-[10.5px] max-md:py-1 ${
        on ? 'border-[var(--accent)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  );
}

function CacheLine({ mark }: { mark: RequestCacheMark }) {
  return (
    <div className="flex items-center gap-2 px-4 py-0.5 text-[10.5px] text-amber-300/90 max-md:px-3">
      <span className="shrink-0">cache mark · {[mark.ttl ?? '5m', mark.scope].filter(Boolean).join(' · ')}</span>
      <span className="flex-1 border-t border-dashed border-amber-500/40" />
    </div>
  );
}

function MessageRow({
  sessionId,
  requestId,
  index,
  m,
  display,
  onGoToMessage,
  onGoToCall,
}: {
  sessionId: string;
  requestId: string;
  index: number;
  m: RequestMessageSummary;
  display: string | null;
  onGoToMessage: (uuid: string) => void;
  onGoToCall: (toolUseId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // A tool's id is the better anchor wherever there is one: the line holding a
  // `tool_result` is drawn nowhere, so its uuid would scroll to nothing.
  const call = m.blocks.find((b) => b.toolUseId)?.toolUseId ?? null;
  const goTo = m.source === 'conversation' ? (call ? () => onGoToCall(call) : m.uuid ? () => onGoToMessage(m.uuid!) : null) : null;
  return (
    <div className={`border-b border-[var(--border)]/50 ${open ? 'bg-[var(--bg-raised)]/60' : ''}`}>
      <div className="flex items-baseline gap-2 px-4 py-1.5 text-[11.5px] hover:bg-[var(--bg-hover)] max-md:px-3 max-md:py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 text-left"
        >
          <span className="w-9 shrink-0 font-mono text-[var(--text-dim)] tabular-nums">#{index}</span>
          <span className={`w-16 shrink-0 text-[10.5px] font-semibold max-md:w-auto ${ROLE_TONE[m.role] ?? 'text-[var(--text-dim)]'}`}>
            {m.role}
          </span>
          <span className="min-w-0 flex-1 truncate">{messageSummary(m)}</span>
        </button>
        {m.isNew && (
          <span className="shrink-0 rounded border border-emerald-500/40 px-1 text-[9.5px] text-emerald-300" title="Sent for the first time by this request">
            new
          </span>
        )}
        {m.source === 'request' && (
          <span
            className="shrink-0 rounded border border-violet-400/40 px-1 text-[9.5px] text-violet-300"
            title="Sent in this form only in the request — the conversation does not show it"
          >
            only in the request
          </span>
        )}
        {goTo && (
          <button
            type="button"
            data-jump
            onClick={goTo}
            className="shrink-0 cursor-pointer px-0.5 text-sky-300 hover:underline"
            title="Go to it in the conversation"
            aria-label="Go to it in the conversation"
          >
            ↗
          </button>
        )}
        <span className="w-11 shrink-0 text-right font-mono text-[10.5px] text-[var(--text-dim)] tabular-nums">
          {k(m.chars)}
        </span>
      </div>
      {open && (
        <MessageBody sessionId={sessionId} requestId={requestId} index={index} summary={m.blocks} display={display} />
      )}
    </div>
  );
}

function MessageBody({
  sessionId,
  requestId,
  index,
  summary,
  display,
}: {
  sessionId: string;
  requestId: string;
  index: number;
  summary: RequestBlockSummary[];
  display: string | null;
}) {
  // A message is written once and never changes: no reason to fetch it twice.
  const full = useQuery({
    queryKey: ['request-message', sessionId, requestId, index],
    queryFn: () => api.requestMessage(sessionId, requestId, index),
    staleTime: Infinity,
  });
  if (full.isPending) return <p className="px-4 pb-2 pl-15 text-[11px] text-[var(--text-dim)]">Reading…</p>;
  if (full.isError) return <p className="px-4 pb-2 text-[11px] text-amber-300">{String(full.error)}</p>;
  const blocks = full.data.content;
  return (
    <div className="flex flex-col gap-2 px-4 pt-1 pb-3 md:pl-15 max-md:px-3">
      {blocks.map((b, i) => {
        const text = blockText(b, display);
        const s = summary[i];
        return (
          <BlockView
            key={i}
            text={text}
            label={[s?.type ?? '?', s?.narration ? 'narration' : s?.name, blocks.length > 1 ? `${i + 1} of ${blocks.length}` : null]
              .filter(Boolean)
              .join(' · ')}
            chars={s?.chars ?? text.length}
          />
        );
      })}
    </div>
  );
}

/** `params.thinking.display`: what the request asked the API to send back of its reasoning. */
function thinkingDisplay(d: RequestDetailResponse): string | null {
  const t = d.params.thinking as { display?: unknown } | undefined;
  return typeof t?.display === 'string' ? t.display : null;
}

/**
 * Why a thinking block has no text, which is the common case and not a loss:
 * the request did not ask for it. Claude Code sends `display: "updates"` unless
 * its `showThinkingSummaries` setting is on, and the API then returns the
 * reasoning as an encrypted signature alone — only narration comes back as
 * words. With the setting on (`"summarized"`) a summary of it reaches the
 * transcript, and is drawn here.
 */
function emptyThinking(display: string | null): string {
  if (display === 'summarized') return '(No text came back for this block.)';
  // No display at all is what a session that was ALREADY open sends once the
  // setting is turned on: the CLI drops "updates" live, but "summarized" is
  // decided when a session starts.
  if (display === null) {
    return '(No text: this request named no thinking display, and the API sent only an encrypted signature. A session that was already open when showThinkingSummaries was turned on sends its requests like this — only sessions started after it keep a summary.)';
  }
  return `(No text: this request asked for the reasoning without it — thinking display "${display}" — so only an encrypted signature came back, and the transcript holds nothing more. With showThinkingSummaries on in Claude Code's settings, new sessions keep a summary of it.)`;
}

function blockText(block: unknown, display: string | null): string {
  const b = (block ?? {}) as Record<string, unknown>;
  switch (b.type) {
    case 'text':
      return String(b.text ?? '');
    case 'thinking':
      return typeof b.thinking === 'string' && b.thinking ? b.thinking : emptyThinking(display);
    case 'tool_use':
      return JSON.stringify(b.input ?? {}, null, 2);
    case 'tool_result': {
      const c = b.content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) {
        return c
          .map((x) => {
            const r = (x ?? {}) as Record<string, unknown>;
            return r.type === 'text' ? String(r.text ?? '') : r.type === 'image' ? '[image]' : JSON.stringify(r);
          })
          .join('\n');
      }
      return JSON.stringify(c ?? '');
    }
    case 'image':
      return '[image]';
    default:
      return JSON.stringify(b, null, 2);
  }
}

/** One block of text, clipped at `CLIP` with a way to the rest. `chars` is what it weighed as sent. */
function BlockView({ text, label, chars }: { text: string; label: string; chars: number }) {
  const [all, setAll] = useState(false);
  const clipped = !all && text.length > CLIP;
  return (
    <div className="min-w-0 rounded border border-[var(--border)] bg-[var(--bg-raised)]">
      <div className="flex justify-between gap-2 border-b border-[var(--border)] px-2 py-1 text-[10.5px] text-[var(--text-dim)]">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 font-mono tabular-nums">{chars.toLocaleString()} chars</span>
      </div>
      <pre className="max-h-96 overflow-auto px-2 py-1.5 font-mono text-[10.5px] leading-relaxed break-words whitespace-pre-wrap text-[var(--text)]/85">
        {clipped ? `${text.slice(0, CLIP)}…` : text}
      </pre>
      {text.length > CLIP && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="cursor-pointer px-2 pb-1.5 text-[10.5px] text-sky-300 hover:underline"
        >
          {all ? 'Show less' : `Show all ${text.length.toLocaleString()} characters`}
        </button>
      )}
    </div>
  );
}

// ---- System, tools, parameters ----

function SystemTab({ d }: { d: RequestDetailResponse }) {
  const marked = new Map<number, RequestCacheMark>();
  for (const m of d.cacheMarks) if (m.path[0] === 'system' && typeof m.path[1] === 'number') marked.set(m.path[1], m);
  if (!d.system) return <p className="p-4 text-[11.5px] text-[var(--text-dim)]">The transcript lost this request’s system prompt.</p>;
  return (
    <div className="flex flex-col gap-2 py-2">
      {d.system.map((b, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="px-4 max-md:px-3">
            <BlockView text={b.text} label={`block ${i + 1}`} chars={b.chars} />
          </div>
          {marked.has(i) && <CacheLine mark={marked.get(i)!} />}
        </div>
      ))}
      <p className="px-4 text-[11px] text-[var(--text-dim)] max-md:px-3">
        The project’s CLAUDE.md files are not here: they travel in the first user message, inside a{' '}
        <code>&lt;system-reminder&gt;</code>. One block the CLI sends is never recorded — its billing header — so it is
        missing here and from the JSON.
      </p>
    </div>
  );
}

function ToolsTab({ d }: { d: RequestDetailResponse }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!d.tools) return <p className="p-4 text-[11.5px] text-[var(--text-dim)]">The transcript lost this request’s tools.</p>;
  const sorted = [...d.tools].sort((a, b) => b.chars - a.chars);
  const biggest = sorted[0]?.chars ?? 1;
  const total = d.tools.reduce((n, t) => n + t.chars, 0);
  const additions = d.messages.flatMap((m, i) =>
    m.blocks.filter((b) => b.type === 'tool_addition').map((b) => ({ name: b.name ?? '?', at: i })),
  );
  return (
    <div className="flex flex-col">
      <p className="px-4 py-2 text-[11px] text-[var(--text-dim)] max-md:px-3">
        {d.tools.length} offered with the request, {total.toLocaleString()} characters — sorted by size, which is what
        the always-on context is made of.
        {additions.length > 0 &&
          ` ${additions.length} more added during the conversation: ${additions.map((a) => `${a.name} (message #${a.at})`).join(', ')}.`}
      </p>
      {sorted.map((t) => (
        <div key={t.name} className="border-b border-[var(--border)]/50">
          <button
            type="button"
            onClick={() => setOpen(open === t.name ? null : t.name)}
            aria-expanded={open === t.name}
            className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_7rem_3rem] items-center gap-2 px-4 py-1.5 text-left text-[11.5px] hover:bg-[var(--bg-hover)] max-md:grid-cols-[minmax(0,1fr)_4rem_3rem] max-md:px-3 max-md:py-2.5"
          >
            <span className="truncate font-mono">{t.name}</span>
            <span className="h-1.5 overflow-hidden rounded bg-[var(--border)]">
              <span className="block h-full bg-[#4c6a86]" style={{ width: `${(t.chars / biggest) * 100}%` }} />
            </span>
            <span className="text-right font-mono text-[10.5px] text-[var(--text-dim)] tabular-nums">{k(t.chars)}</span>
          </button>
          {open === t.name && (
            <div className="flex flex-col gap-2 px-4 pb-3 max-md:px-3">
              <BlockView text={t.description || '(no description)'} label="description" chars={t.description.length} />
              <BlockView
                text={JSON.stringify(t.inputSchema, null, 2)}
                label="input schema"
                chars={JSON.stringify(t.inputSchema).length}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ParamsTab({ d }: { d: RequestDetailResponse }) {
  const p = d.params;
  const betas = Array.isArray(p.betas) ? p.betas.map(String) : [];
  const shown = new Set(['model', 'max_tokens', 'thinking', 'output_config', 'context_management', 'betas']);
  const others = Object.entries(p).filter(([key]) => !shown.has(key));
  const json = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v));
  return (
    <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-3 text-[11.5px] max-md:grid-cols-1 max-md:px-3">
      <Param name="model" value={json(p.model)} />
      <Param name="max_tokens" value={json(p.max_tokens)} />
      <Param name="thinking" value={json(p.thinking)} />
      <Param name="output_config" value={json(p.output_config)} />
      <Param name="context_management" value={json(p.context_management)} />
      <Param name="cache marks" value={d.cacheMarks.map(markLabel).join(' · ') || '—'} />
      {others.map(([key, v]) => (
        <Param key={key} name={key} value={json(v)} />
      ))}
      <dt className="text-[var(--text-dim)]">betas ({betas.length})</dt>
      <dd className="flex flex-wrap gap-1">
        {betas.map((b) => (
          <span key={b} className="rounded border border-[var(--border)] px-1 font-mono text-[10px] text-[var(--text-dim)]">
            {b}
          </span>
        ))}
      </dd>
      <Param name="query source" value={d.querySource ?? '—'} />
      <Param name="CLI" value={d.version ?? '—'} />
      <Param name="request id" value={d.id} />
    </dl>
  );
}

function Param({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--text-dim)]">{name}</dt>
      <dd className="font-mono text-[11px] break-words select-text">{value}</dd>
    </>
  );
}

function Footer({ sessionId, d, mobile }: { sessionId: string; d: RequestDetailResponse; mobile: boolean }) {
  const [said, setSaid] = useState<string | null>(null);
  const copy = async () => {
    try {
      const res = await fetch(api.requestRawUrl(sessionId, d.id));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await copyPlain(JSON.stringify(await res.json(), null, 2));
      setSaid('Copied');
    } catch (err) {
      setSaid(`Could not copy: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTimeout(() => setSaid(null), 2500);
  };
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--bg-raised)] px-4 py-2 max-md:px-3">
      <button
        type="button"
        onClick={() => void copy()}
        className="cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)] max-md:py-2"
      >
        Copy as JSON
      </button>
      {!mobile && (
        <a
          href={api.requestRawUrl(sessionId, d.id, true)}
          download={`request-${d.id}.json`}
          className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)]"
        >
          Download .json
        </a>
      )}
      <span className="ml-auto text-[10.5px] text-[var(--text-dim)]">
        {said ?? 'The whole request, rebuilt: parameters, tools, system and messages.'}
      </span>
    </div>
  );
}
