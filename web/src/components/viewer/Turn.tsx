import type { ContentBlock, MessageItem, Turn as TurnType } from '@claude-history/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { formatDateTime, formatDateTimeFull, relativeTime, shortModel } from '../../lib/format.ts';
import { ImageBlock } from './ImageBlock.tsx';
import { Markdown } from './Markdown.tsx';
import { ThinkingBlock } from './ThinkingBlock.tsx';
import { ToolBlock } from './ToolBlock.tsx';

type ToolContentBlock = Extract<ContentBlock, { kind: 'tool' }>;

function Anchors({ item }: { item: MessageItem }) {
  return (
    <>
      {item.aliasUuids.map((u) => (
        <span key={u} id={u} />
      ))}
    </>
  );
}

function UserItem({ item }: { item: MessageItem }) {
  return (
    <div id={item.uuid} className="rounded-lg border-l-2 border-[var(--accent)] bg-[var(--bg-raised)] px-3 py-2">
      <Anchors item={item} />
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-wider text-[var(--accent)] uppercase">
        <span>user</span>
        {item.timestamp && (
          <span className="font-normal text-[var(--text-dim)] normal-case" title={formatDateTimeFull(item.timestamp)}>
            {formatDateTime(item.timestamp)} · {relativeTime(item.timestamp)}
          </span>
        )}
      </div>
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
    </div>
  );
}

/**
 * A run of consecutive tool calls, collapsed into one line by default: a long
 * session is mostly tool traffic, and hiding it leaves the prompts and the
 * answers readable. Expanding shows the individual (still collapsible) calls.
 */
function ToolGroup({
  blocks,
  expandAll,
  onOpenAgent,
}: {
  blocks: ToolContentBlock[];
  expandAll: boolean;
  onOpenAgent?: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(expandAll);
  useEffect(() => setOpen(expandAll), [expandAll]);

  const names = [...new Set(blocks.map((b) => b.toolName))];
  const errors = blocks.filter((b) => b.result?.isError).length;

  if (open) {
    return (
      <div className="my-1.5 border-l border-[var(--border)] pl-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mb-1 cursor-pointer text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          ▾ {blocks.length} tool call{blocks.length !== 1 ? 's' : ''} — collapse
        </button>
        {blocks.map((b, i) => (
          <ToolBlock key={i} block={b} onOpenAgent={onOpenAgent} />
        ))}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="my-1.5 flex w-full cursor-pointer items-center gap-2 rounded border border-dashed border-[var(--border)] px-2 py-1 text-left text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
      title={names.join(', ')}
    >
      <span>▸</span>
      <span className="font-semibold text-sky-300/80">
        {blocks.length} tool call{blocks.length !== 1 ? 's' : ''}
      </span>
      <span className="min-w-0 truncate font-mono opacity-70">{names.join(', ')}</span>
      {errors > 0 && <span className="ml-auto shrink-0 text-red-400">{errors} failed</span>}
    </button>
  );
}

function AssistantHeader({ item }: { item: MessageItem }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
      <span className="text-emerald-400/80">assistant</span>
      {item.model && <span className="font-mono font-normal normal-case">{shortModel(item.model)}</span>}
      {item.timestamp && (
        <span className="font-normal normal-case" title={formatDateTimeFull(item.timestamp)}>
          {formatDateTime(item.timestamp)} · {relativeTime(item.timestamp)}
        </span>
      )}
    </div>
  );
}

function SystemItem({ item }: { item: MessageItem }) {
  const text = item.blocks[0]?.kind === 'text' ? item.blocks[0].text : '';
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
}: {
  turn: TurnType;
  showThinking: boolean;
  expandTools: boolean;
  onOpenAgent?: (agentId: string) => void;
}) {
  // Tool runs are grouped across items, not just within one assistant
  // message: a turn is usually assistant(tool) → assistant(tool) → … and the
  // user only wants to see one collapsed line for the whole run.
  const nodes: ReactNode[] = [];
  let pendingTools: ToolContentBlock[] = [];
  const flushTools = () => {
    if (pendingTools.length === 0) return;
    nodes.push(
      <ToolGroup key={`tools-${nodes.length}`} blocks={pendingTools} expandAll={expandTools} onOpenAgent={onOpenAgent} />,
    );
    pendingTools = [];
  };

  for (const item of turn.items) {
    if (item.role === 'user') {
      flushTools();
      nodes.push(<UserItem key={item.uuid} item={item} />);
      continue;
    }
    if (item.role !== 'assistant') {
      flushTools();
      nodes.push(<SystemItem key={item.uuid} item={item} />);
      continue;
    }

    const visible = item.blocks.filter((b) => b.kind !== 'thinking' || showThinking);
    // An assistant message that is only tool calls contributes to the run
    // without printing its own header.
    if (visible.length > 0 && visible.every((b) => b.kind === 'tool')) {
      pendingTools.push(...(visible as ToolContentBlock[]));
      continue;
    }

    flushTools();
    const rendered: ReactNode[] = [];
    for (const [i, b] of visible.entries()) {
      if (b.kind === 'tool') {
        pendingTools.push(b);
        continue;
      }
      if (pendingTools.length > 0) {
        rendered.push(
          <ToolGroup
            key={`inline-tools-${i}`}
            blocks={pendingTools}
            expandAll={expandTools}
            onOpenAgent={onOpenAgent}
          />,
        );
        pendingTools = [];
      }
      if (b.kind === 'thinking') rendered.push(<ThinkingBlock key={i} text={b.text} />);
      else if (b.kind === 'text') rendered.push(<Markdown key={i} text={b.text} />);
    }
    if (rendered.length > 0) {
      nodes.push(
        <div key={item.uuid} id={item.uuid} className="px-1 py-1">
          <Anchors item={item} />
          <AssistantHeader item={item} />
          {rendered}
        </div>,
      );
    }
  }
  flushTools();

  return <div className="space-y-1.5">{nodes}</div>;
}
