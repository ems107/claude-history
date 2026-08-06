import type { MessageItem, Turn as TurnType } from '@claude-history/shared';
import { formatDateTimeFull, relativeTime, shortModel } from '../../lib/format.ts';
import { Markdown } from './Markdown.tsx';
import { ThinkingBlock } from './ThinkingBlock.tsx';
import { ToolBlock } from './ToolBlock.tsx';

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
            {relativeTime(item.timestamp)}
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
          return (
            <div key={i} className="my-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)]">
              🖼 image attachment (not stored in transcript)
            </div>
          );
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

function AssistantItem({
  item,
  showThinking,
  onOpenAgent,
}: {
  item: MessageItem;
  showThinking: boolean;
  onOpenAgent?: (agentId: string) => void;
}) {
  return (
    <div id={item.uuid} className="px-1 py-1">
      <Anchors item={item} />
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        <span className="text-emerald-400/80">assistant</span>
        {item.model && <span className="font-mono font-normal normal-case">{shortModel(item.model)}</span>}
        {item.timestamp && (
          <span className="font-normal normal-case" title={formatDateTimeFull(item.timestamp)}>
            {relativeTime(item.timestamp)}
          </span>
        )}
      </div>
      {item.blocks.map((b, i) => {
        switch (b.kind) {
          case 'thinking':
            return showThinking ? <ThinkingBlock key={i} text={b.text} /> : null;
          case 'text':
            return <Markdown key={i} text={b.text} />;
          case 'tool':
            return <ToolBlock key={i} block={b} onOpenAgent={onOpenAgent} />;
          default:
            return null;
        }
      })}
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
  onOpenAgent,
}: {
  turn: TurnType;
  showThinking: boolean;
  onOpenAgent?: (agentId: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {turn.items.map((item) =>
        item.role === 'user' ? (
          <UserItem key={item.uuid} item={item} />
        ) : item.role === 'assistant' ? (
          <AssistantItem key={item.uuid} item={item} showThinking={showThinking} onOpenAgent={onOpenAgent} />
        ) : (
          <SystemItem key={item.uuid} item={item} />
        ),
      )}
    </div>
  );
}
