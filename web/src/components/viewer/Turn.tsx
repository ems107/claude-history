import type { ContentBlock, MessageItem, PriceTable, Turn as TurnType } from '@claude-history/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { ContextPoint, ContextTurn } from '../../lib/context.ts';
import { type CostEntry, costEntries, costEntry } from '../../lib/cost.ts';
import { formatDateTime, formatDateTimeFull, relativeTime, shortModel } from '../../lib/format.ts';
import { Bubble } from './Bubble.tsx';
import { ContextPill } from './ContextPill.tsx';
import { CompactBoundaryPanel, ContextSnapshotPanel } from './ContextSnapshotPanel.tsx';
import { CostPill } from './CostPill.tsx';
import { ImageBlock } from './ImageBlock.tsx';
import { Markdown } from './Markdown.tsx';
import { MessageActions } from './MessageActions.tsx';
import { ThinkingBlock } from './ThinkingBlock.tsx';
import { ToolBlock } from './ToolBlock.tsx';

type ToolContentBlock = Extract<ContentBlock, { kind: 'tool' }>;

/**
 * A tool call plus the assistant message that made it. `costOwner` is false when
 * that message prints its own header: its cost is shown there, and counting it
 * again on the tool run would double it.
 */
interface PendingTool {
  block: ToolContentBlock;
  item: MessageItem;
  costOwner: boolean;
}

/** What every cost pill in a turn needs to place its number in the session. */
interface CostContext {
  prices: PriceTable;
  cumulative: Map<string, number>;
  sessionTotal: number | null;
  /** Context window per request, keyed by the assistant item's uuid. */
  context: Map<string, ContextPoint>;
}

function Anchors({ item }: { item: MessageItem }) {
  return (
    <>
      {item.aliasUuids.map((u) => (
        <span key={u} id={u} />
      ))}
    </>
  );
}

function UserItem({ item, badge }: { item: MessageItem; badge?: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  return (
    <Bubble
      side="user"
      id={item.uuid}
      bodyRef={body}
      header={
        <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
          <span>user</span>
          {item.timestamp && (
            <span className="font-normal text-[var(--text-dim)] normal-case" title={formatDateTimeFull(item.timestamp)}>
              {formatDateTime(item.timestamp)} · {relativeTime(item.timestamp)}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <MessageActions item={item} blocks={item.blocks} body={body} />
            {badge}
          </span>
        </div>
      }
    >
      <Anchors item={item} />
      {item.blocks.map((b, i) => {
        if (b.kind === 'command') {
          return (
            <div key={i} className="font-mono text-sm text-amber-300">
              ❯ {b.text}
            </div>
          );
        }
        if (b.kind === 'image') {
          return <ImageBlock key={i} block={b} />;
        }
        if (b.kind === 'text') {
          return (
            <div key={i} className="text-sm whitespace-pre-wrap">
              {b.text}
            </div>
          );
        }
        return null;
      })}
    </Bubble>
  );
}

/**
 * A run of consecutive tool calls, collapsed into one line by default: a long
 * session is mostly tool traffic, and hiding it leaves the prompts and the
 * answers readable. Expanding shows the individual (still collapsible) calls.
 */
function ToolGroup({
  tools,
  expandAll,
  onOpenAgent,
  costs,
}: {
  tools: PendingTool[];
  expandAll: boolean;
  onOpenAgent?: (agentId: string) => void;
  costs: CostContext;
}) {
  const [open, setOpen] = useState(expandAll);
  useEffect(() => setOpen(expandAll), [expandAll]);

  const blocks = tools.map((t) => t.block);
  const names = [...new Set(blocks.map((b) => b.toolName))];
  const errors = blocks.filter((b) => b.result?.isError).length;
  const owners = tools.filter((t) => t.costOwner).map((t) => t.item);
  const entries = costEntries(owners, costs.prices);
  const lastUuid = entries.length > 0 ? entries[entries.length - 1].uuid : null;
  const runPill = (
    <CostPill
      entries={entries}
      prices={costs.prices}
      cumulative={lastUuid ? costs.cumulative.get(lastUuid) : undefined}
      sessionTotal={costs.sessionTotal}
    />
  );

  if (open) {
    // Expanded, the pill moves onto the FIRST call of each message: that is the
    // granularity the transcript actually bills at, and a pill per call would
    // repeat one message's cost across several of them.
    let previousOwner: string | null = null;
    return (
      <div className="my-1.5 border-l border-[var(--border)] pl-2">
        <div className="mb-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="cursor-pointer text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            ▾ {blocks.length} tool call{blocks.length !== 1 ? 's' : ''} — collapse
          </button>
          <span className="ml-auto">{runPill}</span>
        </div>
        {tools.map((t, i) => {
          const first = t.costOwner && t.item.uuid !== previousOwner;
          if (t.costOwner) previousOwner = t.item.uuid;
          const entry = first ? costEntry(t.item, costs.prices) : null;
          return (
            <ToolBlock
              key={i}
              block={t.block}
              onOpenAgent={onOpenAgent}
              costBadge={
                entry ? (
                  <CostPill
                    entries={[entry]}
                    prices={costs.prices}
                    cumulative={costs.cumulative.get(entry.uuid)}
                    sessionTotal={costs.sessionTotal}
                  />
                ) : null
              }
            />
          );
        })}
      </div>
    );
  }
  return (
    <div className="my-1.5 flex items-center gap-2 rounded border border-dashed border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        title={names.join(', ')}
      >
        <span>▸</span>
        <span className="shrink-0 font-semibold text-sky-300/80">
          {blocks.length} tool call{blocks.length !== 1 ? 's' : ''}
        </span>
        <span className="min-w-0 truncate font-mono opacity-70">{names.join(', ')}</span>
      </button>
      {errors > 0 && <span className="shrink-0 text-red-400">{errors} failed</span>}
      {runPill}
    </div>
  );
}

function AssistantHeader({ item, costs, actions }: { item: MessageItem; costs: CostContext; actions?: ReactNode }) {
  const entry = costEntry(item, costs.prices);
  return (
    <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
      <span className="text-emerald-400/80">assistant</span>
      {item.model && <span className="font-mono font-normal normal-case">{shortModel(item.model)}</span>}
      {item.timestamp && (
        <span className="font-normal normal-case" title={formatDateTimeFull(item.timestamp)}>
          {formatDateTime(item.timestamp)} · {relativeTime(item.timestamp)}
        </span>
      )}
      {entry && (
        <CostPill
          entries={[entry]}
          prices={costs.prices}
          cumulative={costs.cumulative.get(entry.uuid)}
          sessionTotal={costs.sessionTotal}
        />
      )}
      <ContextPill point={costs.context.get(item.uuid)} />
      {actions && <span className="ml-auto">{actions}</span>}
    </div>
  );
}

/**
 * An assistant message with something to show. Its own component only because
 * it needs a ref for the copy button, and the turn loop cannot hold one.
 *
 * `blocks` is what was actually rendered (thinking filtered, tool calls pulled
 * out into runs) — the copy button must not offer more than the bubble shows.
 */
function AssistantItem({
  item,
  costs,
  blocks,
  children,
}: {
  item: MessageItem;
  costs: CostContext;
  blocks: ContentBlock[];
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  return (
    <Bubble
      id={item.uuid}
      side="assistant"
      bodyRef={body}
      header={
        <AssistantHeader
          item={item}
          costs={costs}
          actions={<MessageActions item={item} blocks={blocks} body={body} />}
        />
      }
    >
      <Anchors item={item} />
      {children}
    </Bubble>
  );
}

function SystemItem({ item }: { item: MessageItem }) {
  // Two system lines are worth more than their text: a /context run and a
  // compaction boundary each get their own panel.
  const first = item.blocks[0];
  if (first?.kind === 'context') {
    return (
      <div id={item.uuid}>
        <Anchors item={item} />
        <ContextSnapshotPanel snapshot={first.snapshot} />
      </div>
    );
  }
  if (first?.kind === 'compact') {
    return (
      <div id={item.uuid}>
        <Anchors item={item} />
        <CompactBoundaryPanel boundary={first.boundary} />
      </div>
    );
  }
  const text = first?.kind === 'text' ? first.text : '';
  return (
    <div id={item.uuid} className="px-2 py-0.5 text-xs text-[var(--text-dim)]/70">
      <Anchors item={item} />
      <span className="mr-2 rounded bg-zinc-500/15 px-1 py-px text-[10px] font-semibold uppercase">
        {item.systemSubtype ?? 'system'}
      </span>
      <span className="whitespace-pre-wrap">{text.length > 400 ? `${text.slice(0, 400)}…` : text}</span>
    </div>
  );
}

export function TurnView({
  turn,
  showThinking,
  expandTools,
  onOpenAgent,
  costs,
  turnCost,
  turnContext,
}: {
  turn: TurnType;
  showThinking: boolean;
  expandTools: boolean;
  onOpenAgent?: (agentId: string) => void;
  costs: CostContext;
  /** Every assistant message of the turn, priced — including the ones that render no header. */
  turnCost: CostEntry[];
  /** The turn's requests, for the context badge. */
  turnContext: ContextTurn | null;
}) {
  // Tool runs are grouped across items, not just within one assistant
  // message: a turn is usually assistant(tool) → assistant(tool) → … and the
  // user only wants to see one collapsed line for the whole run.
  const nodes: ReactNode[] = [];
  let pendingTools: PendingTool[] = [];
  const flushTools = () => {
    if (pendingTools.length === 0) return;
    // Indented: a run between two bubbles is the assistant's own work, not a
    // third speaker.
    nodes.push(
      <div key={`tools-${nodes.length}`} className="ml-6">
        <ToolGroup tools={pendingTools} expandAll={expandTools} onOpenAgent={onOpenAgent} costs={costs} />
      </div>,
    );
    pendingTools = [];
  };

  const lastTurnUuid = turnCost.length > 0 ? turnCost[turnCost.length - 1].uuid : null;
  const turnBadge =
    turnCost.length > 0 || turnContext ? (
      <span className="inline-flex items-center gap-1.5">
        {turnCost.length > 0 && (
          <CostPill
            entries={turnCost}
            prices={costs.prices}
            cumulative={lastTurnUuid ? costs.cumulative.get(lastTurnUuid) : undefined}
            sessionTotal={costs.sessionTotal}
            label="turn"
            variant="badge"
          />
        )}
        {turnContext && <ContextPill turn={turnContext} variant="badge" />}
      </span>
    ) : null;
  // The badge belongs on the prompt that paid for it. A turn with no user
  // message (a session whose transcript opens with assistant lines) gets its
  // own line instead, so no turn is ever left without its total.
  let badgePlaced = false;

  for (const item of turn.items) {
    if (item.role === 'user') {
      flushTools();
      nodes.push(<UserItem key={item.uuid} item={item} badge={badgePlaced ? undefined : turnBadge} />);
      badgePlaced = true;
      continue;
    }
    if (item.role !== 'assistant') {
      flushTools();
      nodes.push(<SystemItem key={item.uuid} item={item} />);
      continue;
    }

    const visible = item.blocks.filter((b) => b.kind !== 'thinking' || showThinking);
    // An assistant message that is only tool calls contributes to the run
    // without printing its own header — so the run carries its cost.
    if (visible.length > 0 && visible.every((b) => b.kind === 'tool')) {
      pendingTools.push(...(visible as ToolContentBlock[]).map((block) => ({ block, item, costOwner: true })));
      continue;
    }

    flushTools();
    const rendered: ReactNode[] = [];
    const prose: ContentBlock[] = [];
    for (const [i, b] of visible.entries()) {
      if (b.kind === 'tool') {
        pendingTools.push({ block: b, item, costOwner: false });
        continue;
      }
      if (pendingTools.length > 0) {
        rendered.push(
          <ToolGroup
            key={`inline-tools-${i}`}
            tools={pendingTools}
            expandAll={expandTools}
            onOpenAgent={onOpenAgent}
            costs={costs}
          />,
        );
        pendingTools = [];
      }
      if (b.kind === 'thinking') {
        rendered.push(<ThinkingBlock key={i} text={b.text} />);
        prose.push(b);
      } else if (b.kind === 'text') {
        rendered.push(<Markdown key={i} text={b.text} />);
        prose.push(b);
      }
    }
    if (rendered.length > 0) {
      // Only a message with something to show gets a bubble: an assistant
      // message that is nothing but tool calls prints no header today (the run
      // carries its cost) and must not grow an envelope either.
      nodes.push(
        <AssistantItem key={item.uuid} item={item} costs={costs} blocks={prose}>
          {rendered}
        </AssistantItem>,
      );
    }
  }
  flushTools();

  return (
    <div className="space-y-1.5">
      {!badgePlaced && turnBadge && <div className="flex justify-end">{turnBadge}</div>}
      {nodes}
    </div>
  );
}
