import type { ContentBlock, MessageItem, PriceTable, Turn as TurnType } from '@claude-history/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { ContextPoint, ContextTurn } from '../../lib/context.ts';
import { type CostEntry, costEntries, costEntry, summariseRecache } from '../../lib/cost.ts';
import { systemChars } from '../../lib/findInSession.ts';
import { formatDateTime, formatDateTimeFull, formatDuration, relativeTime, shortModel } from '../../lib/format.ts';
import { foldedCounts } from '../../lib/folding.ts';
import { parsePlan } from '../../lib/plans.ts';
import { isPromptItem } from '../../lib/segments.ts';
import { parseSentFiles } from '../../lib/sentFiles.ts';
import { systemLabel, systemTitle } from '../../lib/systemLines.ts';
import { type TurnSpan, turnSpan } from '../../lib/turnActivity.ts';
import { AnsweredQuestionCard, parseAskUserQuestion } from './AnsweredQuestion.tsx';
import { Bubble } from './Bubble.tsx';
import { ContextPill } from './ContextPill.tsx';
import { CompactBoundaryPanel, CompactSummaryPanel, ContextSnapshotPanel } from './ContextSnapshotPanel.tsx';
import { CostPill } from './CostPill.tsx';
import { FoldHeader } from './FoldHeader.tsx';
import { ImageBlock } from './ImageBlock.tsx';
import { InjectedNotice } from './InjectedNotice.tsx';
import { InterruptMarker } from './InterruptMarker.tsx';
import { Markdown } from './Markdown.tsx';
import { MessageActions } from './MessageActions.tsx';
import { PlanCard, PlanModeMarker } from './PlanCard.tsx';
import { useRevealTarget } from './RevealContext.ts';
import { SentFilesCard } from './SentFilesCard.tsx';
import { ThinkingBlock } from './ThinkingBlock.tsx';
import { ToolBlock } from './ToolBlock.tsx';

type ToolContentBlock = Extract<ContentBlock, { kind: 'tool' }>;

/**
 * The rail a prompt's answers hang from. Named because a turn can need one it
 * did not grow on its own: a turn still being answered has produced nothing to
 * fold yet, and the working indicator has to line up with the replies all the
 * same — at the root level it read as a sibling of the prompt rather than as
 * the answer arriving.
 */
export const RAIL = 'ml-3 space-y-1.5 border-l-2 border-emerald-500/25 pt-1 pl-3';

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

/**
 * The requests these messages made, deduped the way `costEntries` dedupes them:
 * a message counted twice would have its re-cache billed twice, and the whole
 * point of the three pill levels is that each message appears in exactly one.
 */
function pointsOf(items: MessageItem[], costs: CostContext): ContextPoint[] {
  const seen = new Set<string>();
  const points: ContextPoint[] = [];
  for (const item of items) {
    if (seen.has(item.uuid)) continue;
    seen.add(item.uuid);
    const point = costs.context.get(item.uuid);
    if (point) points.push(point);
  }
  return points;
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

function UserItem({
  item,
  models,
  badge,
}: {
  item: MessageItem;
  /** A prompt records no model of its own — these are the ones that answered it. */
  models: TurnModel[];
  badge?: ReactNode;
}) {
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
          {/* Typed while Claude was working, so it sat in the queue until the
              turn ended — which is why its clock reads EARLIER than the answer
              above it. Without the chip that looks like a parsing error. */}
          {item.queued && (
            <span
              className="rounded border border-[var(--border)] px-1 py-px font-normal text-[var(--text-dim)] normal-case"
              title="Typed while Claude was working, so it waited in the queue and was sent when the turn ended. The time shown is when it was typed."
            >
              queued
            </span>
          )}
          {/* Only `plan` is marked. Every other mode is the ordinary state of
              affairs, and a chip for it would sit on every prompt ever sent. */}
          {item.permissionMode === 'plan' && (
            <span
              className="rounded bg-violet-500/15 px-1 py-px font-semibold text-violet-300 normal-case"
              title="Sent in plan mode: Claude could explore and design, but not edit files or run anything that changes the machine."
            >
              plan
            </span>
          )}
          {/* An explicit spacer rather than `ml-auto` on the run: the actions
              sit between the two, and only the spacer gives way to them. */}
          <span className="flex-1" />
          <MessageActions item={item} blocks={item.blocks} body={body} />
          {/* Same trailing run as the assistant's: model, cost, context. */}
          <span className="flex items-center gap-2">
            {models.length > 0 && (
              <span
                className="font-mono font-normal text-[var(--text-dim)] normal-case"
                title={
                  models.length > 1
                    ? `Models that answered this prompt: ${models.map((m) => `${m.model}${m.effort ? ` (effort ${m.effort})` : ''}`).join(', ')}`
                    : `Model that answered this prompt: ${models[0].model}${models[0].effort ? ` (effort ${models[0].effort})` : ''}`
                }
              >
                {models.map(modelLabel).join(', ')}
              </span>
            )}
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
  targetTool,
  mixedModels = false,
}: {
  tools: PendingTool[];
  expandAll: boolean;
  onOpenAgent?: (agentId: string) => void;
  costs: CostContext;
  /** A deep link's tool call: the run holding it has to be open to show it. */
  targetTool?: string | null;
  /**
   * The turn answered under more than one `model · effort` pair. Only then does
   * a first call name its own — the turn's header already says the pair when
   * there is one, and a tool call cannot differ from its message (the
   * `tool_use` line carries the message's model and effort verbatim), so
   * repeating it on every run was saying nothing.
   */
  mixedModels?: boolean;
}) {
  const holdsTarget = !!targetTool && tools.some((t) => t.block.toolUseId === targetTool);
  // The find bar's destination, read from the context rather than threaded: a
  // run has no identity of its own, so it has to recognise the call inside it.
  // A block cannot open a run it is not mounted in, which is why this exists at
  // all — without it a hit in a folded run scrolled to the message and stopped.
  const reveal = useRevealTarget();
  const holdsReveal = tools.some((t) => !!t.block.toolUseId && `tool:${t.block.toolUseId}` === reveal.key);
  const [open, setOpen] = useState(expandAll || holdsTarget || holdsReveal);
  useEffect(() => setOpen(expandAll), [expandAll]);
  // AFTER the one above, and that order is the whole of it: effects run in
  // declaration order, and a mount runs both — so these have the last word and
  // a run holding the target opens whatever the Tools toggle says.
  useEffect(() => {
    if (holdsTarget) setOpen(true);
  }, [holdsTarget]);
  useEffect(() => {
    if (holdsReveal) setOpen(true);
  }, [holdsReveal, reveal.nonce]);

  const blocks = tools.map((t) => t.block);
  const names = [...new Set(blocks.map((b) => b.toolName))];
  const errors = blocks.filter((b) => b.result?.isError).length;
  // A fan-out of agents is the one thing in a run worth seeing without opening
  // it: three of them come out of a single message in `980751cb`, and the tool
  // name alone ("Agent, Agent, Agent" collapsed to one word) said nothing.
  const agents = blocks.filter((b) => b.agentId).length;
  const owners = tools.filter((t) => t.costOwner).map((t) => t.item);
  const entries = costEntries(owners, costs.prices);
  const lastUuid = entries.length > 0 ? entries[entries.length - 1].uuid : null;
  // Six of the 55 re-caches in this corpus land on a tool-only message, which
  // prints no header of its own — without this they would only ever show up in
  // the turn total, with nothing saying which part of the run paid for them.
  const runPill = (
    <CostPill
      entries={entries}
      prices={costs.prices}
      cumulative={lastUuid ? costs.cumulative.get(lastUuid) : undefined}
      sessionTotal={costs.sessionTotal}
      recache={summariseRecache(pointsOf(owners, costs), costs.prices)}
    />
  );

  if (open) {
    // Expanded, the pill moves onto the FIRST call of each message: that is the
    // granularity the transcript actually bills at, and a pill per call would
    // repeat one message's cost across several of them.
    let previousOwner: string | null = null;
    return (
      <div className="my-1.5 border-l border-[var(--border)] pl-2">
        {/* `data-chrome` on the header row, never on the container: a run inside
            an assistant bubble sits in its `[data-bubble-body]`, and these words
            are ours — but the tool boxes below must stay markable. */}
        <div data-chrome className="mb-1 flex items-center gap-2">
          <FoldHeader open onToggle={() => setOpen(false)} className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]">
            ▾ {blocks.length} tool call{blocks.length !== 1 ? 's' : ''} — collapse
          </FoldHeader>
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
              targeted={!!targetTool && t.block.toolUseId === targetTool}
              costBadge={
                entry ? (
                  <>
                    {/* Named only when the turn is mixed — see `mixedModels`.
                        ToolBlock wraps the whole badge in `data-chrome`: not
                        the message's words. */}
                    {mixedModels && t.item.model && (
                      <span className="shrink-0 font-mono text-[10px] text-[var(--text-dim)]">
                        {shortModel(t.item.model)}
                        {t.item.effort && ` · ${t.item.effort}`}
                      </span>
                    )}
                    <CostPill
                      entries={[entry]}
                      prices={costs.prices}
                      cumulative={costs.cumulative.get(entry.uuid)}
                      sessionTotal={costs.sessionTotal}
                    />
                    <ContextPill point={costs.context.get(t.item.uuid)} />
                  </>
                ) : null
              }
            />
          );
        })}
      </div>
    );
  }
  return (
    // Collapsed, the whole line is chrome: a summary of ours, not the messages'
    // own words — those are counted folded and marked when the run opens.
    <div
      data-chrome
      className="my-1.5 flex items-center gap-2 rounded border border-dashed border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
    >
      <FoldHeader
        open={false}
        onToggle={() => setOpen(true)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={names.join(', ')}
      >
        <span>▸</span>
        <span className="shrink-0 font-semibold text-sky-300/80">
          {blocks.length} tool call{blocks.length !== 1 ? 's' : ''}
        </span>
        <span className="min-w-0 truncate font-mono opacity-70">{names.join(', ')}</span>
      </FoldHeader>
      {agents > 0 && (
        <span className="shrink-0 font-semibold text-sky-400" title="Subagents sent out from this run">
          ⑂ {agents} subagent{agents !== 1 ? 's' : ''}
        </span>
      )}
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
      {item.timestamp && (
        <span className="font-normal normal-case" title={formatDateTimeFull(item.timestamp)}>
          {formatDateTime(item.timestamp)} · {relativeTime(item.timestamp)}
        </span>
      )}
      <span className="flex-1" />
      {actions}
      {/* Same trailing run as the prompt's: model, cost, context. */}
      <span className="flex items-center gap-2">
        {item.model && (
          <span className="font-mono font-normal normal-case">
            {shortModel(item.model)}
            {/* The effort the line was answered at, which the model name alone
                does not tell you — the same answer costs and reads differently
                at `low` and at `xhigh`. Only assistant lines carry it. */}
            {item.effort && <span className="text-[var(--text-dim)]"> · {item.effort}</span>}
          </span>
        )}
        {entry && (
          <CostPill
            entries={[entry]}
            prices={costs.prices}
            cumulative={costs.cumulative.get(entry.uuid)}
            sessionTotal={costs.sessionTotal}
            recache={summariseRecache(pointsOf([item], costs), costs.prices)}
          />
        )}
        <ContextPill point={costs.context.get(item.uuid)} />
      </span>
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
  if (first?.kind === 'interrupt') {
    return (
      <div id={item.uuid}>
        <Anchors item={item} />
        <InterruptMarker block={first} />
      </div>
    );
  }
  if (first?.kind === 'plan-mode') {
    return (
      <div id={item.uuid}>
        <Anchors item={item} />
        <PlanModeMarker block={first} />
      </div>
    );
  }
  // Normally rendered by TurnView, which has the turn badge to hand it; this is
  // the path for anywhere else a notice can turn up.
  if (first?.kind === 'notice') {
    return <InjectedNotice item={item} notice={first} />;
  }
  const text = first?.kind === 'text' ? first.text : '';
  const cap = systemChars(item.systemSubtype);
  return (
    <div id={item.uuid} className="px-2 py-0.5 text-xs text-[var(--text-dim)]/70">
      <Anchors item={item} />
      {/* The chip is a name, not an identifier — `systemLines.ts` holds the
          three that have one, and anything else keeps its raw subtype. */}
      <span
        className="mr-2 rounded bg-zinc-500/15 px-1 py-px text-[10px] font-semibold uppercase"
        title={systemTitle(item.systemSubtype)}
      >
        {systemLabel(item.systemSubtype)}
      </span>
      {/* The searchable half — the subtype chip beside it is not. The cut is
          hard: there is no fold to open, so the find bar and the index stop
          counting exactly here too, or they would offer matches nothing can
          show. A recap is exempt (`systemChars`) and drawn whole: the cap is
          there to keep 2 KB of `<command-name>` markup out of the thread, and
          it was cutting the one line here written to be read. */}
      <span data-bubble-body className="whitespace-pre-wrap">
        {text.length > cap ? `${text.slice(0, cap)}…` : text}
      </span>
    </div>
  );
}

/**
 * The fold line of a turn. It is rendered in BOTH states and at the same place
 * — where the folded content starts — so unfolding moves nothing around and
 * there is always something to click to fold it back.
 *
 * The two states are drawn to look nothing alike, because at a glance they
 * used to read the same: folded it is a closed drawer (dashed, raised, "show"),
 * open it is the head of the rail that holds everything the prompt produced.
 */
function FoldStrip({
  open,
  responses,
  tools,
  span,
  at,
  onToggle,
}: {
  open: boolean;
  responses: number;
  tools: number;
  /**
   * How long the turn ran, prompt to last thing landed (`turnSpan`). Null for
   * the turn in flight — its live clock is the working row's `total`, counted
   * from the same boundary, and two figures with different ends would disagree
   * on screen — and for a turn with nothing to measure.
   */
  span: TurnSpan | null;
  /** Only for a turn no prompt opened, which would otherwise be anonymous. */
  at: string | null;
  onToggle?: () => void;
}) {
  const counts = (
    <>
      {at && <span className="shrink-0">{formatDateTime(at)}</span>}
      {responses > 0 && (
        <span className="shrink-0 font-semibold text-emerald-300/80">
          {responses} response{responses === 1 ? '' : 's'}
        </span>
      )}
      {responses > 0 && tools > 0 && <span className="opacity-50">·</span>}
      {tools > 0 && (
        <span className="shrink-0 font-semibold text-sky-300/80">
          {tools} tool call{tools === 1 ? '' : 's'}
        </span>
      )}
      {/* The counts wear their own colours; the duration is a figure and wears
          the figures' white, like the working row's clocks. A duration, never a
          datetime: a DATE reappearing on the strip is AI_TESTING's failure
          signal for notice-opened turns, and this must not look like one. */}
      {(responses > 0 || tools > 0) && span && <span className="opacity-50">·</span>}
      {span && (
        <span
          className="shrink-0 font-medium text-[var(--text)]/90 tabular-nums"
          title={`From ${formatDateTime(span.start)} to ${formatDateTime(span.end)}`}
        >
          {formatDuration(span.end - span.start)}
        </span>
      )}
    </>
  );

  const toggle = onToggle ?? (() => {});

  if (open) {
    return (
      <FoldHeader
        open
        onToggle={toggle}
        // `w-fit`, which a <button> gave for free: a block-level flex div would
        // stretch the click target across the whole column.
        className="group/fold -mt-0.5 flex w-fit items-center gap-2 text-xs text-[var(--text-dim)]"
      >
        <span className="text-emerald-400/70">▾</span>
        {counts}
        <span className="opacity-60 group-hover/fold:opacity-100">— hide</span>
      </FoldHeader>
    );
  }
  return (
    <FoldHeader
      open={false}
      onToggle={toggle}
      className="group/fold my-1.5 ml-6 flex w-fit items-center gap-2 rounded-full border border-dashed border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
    >
      <span>▸</span>
      {counts}
      {/* Visible, not `opacity-0`: hidden text still takes its width, and
          inside a shrink-wrapped pill that reads as a gaping right margin. */}
      <span className="opacity-60 group-hover/fold:opacity-100">— show</span>
    </FoldHeader>
  );
}

/**
 * The models that answered a prompt. A `user` line records none of its own, and
 * there should only ever be one per turn — if a session changed model mid-turn,
 * saying so is better than picking one.
 */
function turnModels(turn: TurnType): TurnModel[] {
  // Keyed on the pair: the same model at two efforts is two different ways of
  // answering, and collapsing them would hide the one that cost the most.
  const seen = new Map<string, TurnModel>();
  for (const item of turn.items) {
    if (item.role !== 'assistant' || !item.model) continue;
    const key = `${item.model}|${item.effort ?? ''}`;
    if (!seen.has(key)) seen.set(key, { model: item.model, effort: item.effort });
  }
  return [...seen.values()];
}

/** A model as it answered: which one, and at what effort. */
interface TurnModel {
  model: string;
  effort: string | null;
}

/** `sonnet-5 · xhigh`, or just the model when the line recorded no effort. */
function modelLabel(m: TurnModel): string {
  return m.effort ? `${shortModel(m.model)} · ${m.effort}` : shortModel(m.model) ?? m.model;
}

/** What Claude Code injected, when this item is one of those (see `InjectedNotice`). */
function noticeOf(item: MessageItem): Extract<ContentBlock, { kind: 'notice' }> | null {
  const first = item.blocks[0];
  return first?.kind === 'notice' ? first : null;
}

function noticeNode(
  item: MessageItem,
  notice: Extract<ContentBlock, { kind: 'notice' }>,
  badge: ReactNode | undefined,
): ReactNode {
  return <InjectedNotice key={item.uuid} item={item} notice={notice} badge={badge} />;
}

/**
 * A user item is not always a prompt: the compaction summary wears the same
 * role, and gets its own panel instead of a bubble nobody wrote.
 *
 * Neither of them takes a click: a prompt is text to read and copy, and the
 * only thing that folds a turn is its fold strip.
 */
function userNode(item: MessageItem, models: TurnModel[], badge: ReactNode | undefined): ReactNode {
  if (item.isCompactSummary) {
    const text = item.blocks.find((b) => b.kind === 'text');
    return <CompactSummaryPanel key={item.uuid} id={item.uuid} text={text?.kind === 'text' ? text.text : ''} />;
  }
  return <UserItem key={item.uuid} item={item} models={models} badge={badge} />;
}

/**
 * The card a call is lifted out of the run and drawn as, or null for the calls
 * that are ordinary tool traffic.
 *
 * Three tools earn one, and each is a turn of the conversation in miniature
 * rather than plumbing: a question put to the user, a plan submitted for
 * approval, and files handed over. Every parser is guarded by its own tool name,
 * so the order here is presentation and never correctness — and one place to add
 * the fourth beats a ternary chain in the two loops below.
 */
function toolCard(block: ToolContentBlock, key: string): ReactNode | null {
  const asked = parseAskUserQuestion(block);
  if (asked) return <AnsweredQuestionCard key={`asked-${key}`} parsed={asked} />;
  const plan = parsePlan(block);
  if (plan) return <PlanCard key={`plan-${key}`} parsed={plan} />;
  const sent = parseSentFiles(block);
  if (sent) return <SentFilesCard key={`sent-${key}`} parsed={sent} />;
  return null;
}

export function TurnView({
  turn,
  showThinking,
  expandTools,
  onOpenAgent,
  costs,
  turnCost,
  turnContext,
  expanded = true,
  onToggleExpanded,
  targetTool,
  footer,
  inFlight = false,
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
  /** Folded, the turn shows its prompt and one line for what it produced. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** A search result's tool call: its run and the call itself open on arrival. */
  targetTool?: string | null;
  /**
   * Presentation hung at the end of the turn, on its rail — today only the
   * working indicator, which belongs to the answer being written and not to the
   * conversation. It is NOT an item: it never reaches `turn.items`, so nothing
   * that folds, counts or prices a message can see it.
   */
  footer?: ReactNode;
  /**
   * This turn is the one being answered (or waited on) right now, so its fold
   * strip holds back the duration: the working row below is already counting
   * the same span live, and a second figure that stops at the last write would
   * quietly disagree with it. NOT inferred from `footer`, which is also passed
   * when the turn is over and only its subagents are still out.
   */
  inFlight?: boolean;
}) {
  // Tool runs are grouped across items, not just within one assistant
  // message: a turn is usually assistant(tool) → assistant(tool) → … and the
  // user only wants to see one collapsed line for the whole run.
  const nodes: ReactNode[] = [];
  let pendingTools: PendingTool[] = [];
  // Where the fold line goes: at the FIRST thing prompts-only would hide, not
  // at the end of the turn — otherwise unfolding drops the answers above a
  // system panel the line sat below, and the turn reorders itself under you.
  let foldAt: number | null = null;
  const markFold = () => {
    foldAt ??= nodes.length;
  };
  const flushTools = () => {
    if (pendingTools.length === 0) return;
    // Indented: a run between two bubbles is the assistant's own work, not a
    // third speaker.
    markFold();
    nodes.push(
      // No indent of its own: a run only ever renders inside the fold rail,
      // which already carries one.
      <div key={`tools-${nodes.length}`}>
        <ToolGroup
          tools={pendingTools}
          expandAll={expandTools}
          onOpenAgent={onOpenAgent}
          costs={costs}
          targetTool={targetTool}
          mixedModels={models.length > 1}
        />
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
            // The badge sits on the prompt that paid for it, and 53 of the 59
            // re-caches here land on a turn's first request — so this is the one
            // place the marker had to be.
            recache={summariseRecache(turnContext?.recaches ?? [], costs.prices)}
          />
        )}
        {turnContext && <ContextPill turn={turnContext} variant="badge" />}
      </span>
    ) : null;
  // The badge belongs on the prompt that paid for it. A turn with no user
  // message (a session whose transcript opens with assistant lines) gets its
  // own line instead, so no turn is ever left without its total.
  let badgePlaced = false;

  const folded = foldedCounts(turn, showThinking);
  const anyFolded = folded.responses > 0 || folded.tools > 0;
  const models = turnModels(turn);
  let promptShown = false;
  // A rewind that cut in the MIDDLE of a turn: part of it is still the
  // conversation and part of it is not. A turn cut away whole is folded one
  // level up (`DiscardedBranch`), and splitting this one is not an option —
  // two halves would each claim the turn's cost badge — so the turn says it
  // outright instead of quietly reading as if all of it still stood.
  const discardedItems = turn.items.filter((i) => i.discardedBranch !== null).length;
  const partlyDiscarded = discardedItems > 0 && discardedItems < turn.items.length;
  const discardedNotice = partlyDiscarded ? (
    <div
      key="rewound"
      className="flex items-center gap-1.5 text-[10px] text-rose-300/70"
      title="A /rewind branched away from the middle of this turn: Claude Code shows the conversation only up to that point, and what follows here it no longer shows. It was still billed."
    >
      <span className="rounded bg-rose-500/10 px-1.5 py-px font-semibold tracking-wider uppercase">rewound away</span>
      <span>
        {discardedItems} of {turn.items.length} messages in this turn were cut away by a rewind
      </span>
    </div>
  ) : null;
  const span = inFlight ? null : turnSpan(turn);
  const foldStrip = (open: boolean) => (
    <FoldStrip
      key="fold"
      open={open}
      responses={folded.responses}
      tools={folded.tools}
      span={span}
      // A turn nobody prompted would otherwise be an anonymous line.
      at={promptShown ? null : (turn.items[0]?.timestamp ?? null)}
      onToggle={onToggleExpanded}
    />
  );

  // Folded: the prompt, whatever is structural (a compaction, a /context run)
  // and one line saying what is hidden. Never a silent omission.
  if (!expanded) {
    for (const item of turn.items) {
      if (item.role === 'user' && (isPromptItem(item) || item.isCompactSummary)) {
        // The summary panel takes no badge, so it must not consume one either.
        const node = userNode(item, models, badgePlaced ? undefined : turnBadge);
        // Folded, the turn still shows what the user wrote — hiding a queued
        // prompt here would repeat in miniature the bug that hid it outright.
        // On the rail, though: it did not open this turn, and at the prompt's
        // own margin it would read as a second one.
        nodes.push(
          item.queued ? (
            <div key={item.uuid} className={RAIL}>
              {node}
            </div>
          ) : (
            node
          ),
        );
        badgePlaced ||= !item.isCompactSummary;
        promptShown ||= !item.isCompactSummary;
        continue;
      }
      const notice = noticeOf(item);
      if (notice) {
        nodes.push(noticeNode(item, notice, badgePlaced ? undefined : turnBadge));
        badgePlaced = true;
        promptShown = true;
        continue;
      }
      if (item.role === 'system') {
        nodes.push(<SystemItem key={item.uuid} item={item} />);
        continue;
      }
      markFold();
    }
    if (anyFolded) nodes.splice(foldAt ?? nodes.length, 0, foldStrip(false));
    return (
      <div className="space-y-1.5">
        {!badgePlaced && turnBadge && <div className="flex justify-end">{turnBadge}</div>}
        {discardedNotice}
        {nodes}
        {/* Shown even folded: "Claude is working" is live news, and hiding it
            because the user collapsed the turn would answer the wrong question. */}
        {footer && <div className={RAIL}>{footer}</div>}
      </div>
    );
  }

  for (const item of turn.items) {
    if (item.role === 'user') {
      flushTools();
      // A prompt typed while Claude was working did not open this turn — it
      // arrived in the middle of one. `markFold` puts it on the rail with the
      // answers, so the thread it interrupted still reads as one thread, and it
      // cuts the tool run it landed in exactly as a question to the user does.
      if (item.queued) markFold();
      nodes.push(userNode(item, models, badgePlaced ? undefined : turnBadge));
      badgePlaced ||= !item.isCompactSummary;
      promptShown ||= !item.isCompactSummary;
      continue;
    }
    if (item.role !== 'assistant') {
      flushTools();
      const notice = noticeOf(item);
      if (notice) {
        nodes.push(noticeNode(item, notice, badgePlaced ? undefined : turnBadge));
        badgePlaced = true;
        promptShown = true;
        continue;
      }
      nodes.push(<SystemItem key={item.uuid} item={item} />);
      continue;
    }

    const visible = item.blocks.filter((b) => b.kind !== 'thinking' || showThinking);
    // An assistant message that is only tool calls contributes to the run
    // without printing its own header — so the run carries its cost.
    if (visible.length > 0 && visible.every((b) => b.kind === 'tool')) {
      // A call that earns a card CLOSES the run it belongs to and is drawn after
      // it, at conversation level. `costOwner` drops to false once that has
      // happened: the message pays in the first run, and a second run holding
      // more of its calls must not bill it again.
      let owns = true;
      for (const block of visible as ToolContentBlock[]) {
        pendingTools.push({ block, item, costOwner: owns });
        const card = toolCard(block, block.toolUseId || item.uuid);
        if (!card) continue;
        flushTools();
        owns = false;
        nodes.push(card);
      }
      continue;
    }

    flushTools();
    const rendered: ReactNode[] = [];
    const prose: ContentBlock[] = [];
    for (const [i, b] of visible.entries()) {
      if (b.kind === 'tool') {
        pendingTools.push({ block: b, item, costOwner: false });
        // Same rule as above, inside a message that also has prose: the run ends
        // at the call that earns a card, and the card follows it.
        const card = toolCard(b, String(i));
        if (card) {
          rendered.push(
            <ToolGroup
              key={`tools-before-ask-${i}`}
              tools={pendingTools}
              expandAll={expandTools}
              onOpenAgent={onOpenAgent}
              costs={costs}
              targetTool={targetTool}
              mixedModels={models.length > 1}
            />,
          );
          pendingTools = [];
          rendered.push(card);
        }
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
            // The third of the three runs, and the only one that was missing
            // this. It is the calls a message makes BETWEEN two pieces of prose,
            // which no message in this corpus does today (0 of 6,295 calls over
            // the 20 largest sessions — Claude writes, then calls, and the
            // trailing calls leave through flushTools). So the omission opened
            // no link that anyone has clicked; it was a third case written to
            // differ from its two siblings, waiting for the first transcript
            // that goes text → tool → text.
            targetTool={targetTool}
            mixedModels={models.length > 1}
          />,
        );
        pendingTools = [];
      }
      if (b.kind === 'thinking') {
        rendered.push(<ThinkingBlock key={i} text={b.text} owner={item.uuid} />);
        prose.push(b);
      } else if (b.kind === 'text') {
        // The one place the code-block bar is turned on. It reaches the
        // subagent drawer too, which draws this same list over its transcript.
        rendered.push(<Markdown key={i} text={b.text} codeBar />);
        prose.push(b);
      }
    }
    if (rendered.length > 0) {
      // Only a message with something to show gets a bubble: an assistant
      // message that is nothing but tool calls prints no header today (the run
      // carries its cost) and must not grow an envelope either.
      markFold();
      nodes.push(
        <AssistantItem key={item.uuid} item={item} costs={costs} blocks={prose}>
          {rendered}
        </AssistantItem>,
      );
    }
  }
  flushTools();
  // Unfolded, everything the prompt produced moves onto a rail headed by the
  // same line, which now folds it back. The rail starts where the folded pill
  // sat, so nothing shifts sideways when it opens either.
  if (anyFolded) {
    const produced = nodes.splice(foldAt ?? nodes.length);
    nodes.push(
      <div key="folded" className={RAIL}>
        {foldStrip(true)}
        {produced}
        {footer}
      </div>,
    );
  } else if (footer) {
    // A turn with nothing to fold yet — the prompt is in, the answer is not —
    // still puts the indicator on a rail of its own, so the reply starts where
    // every other reply starts instead of jumping left.
    nodes.push(
      <div key="working" className={RAIL}>
        {footer}
      </div>,
    );
  }

  return (
    <div className="space-y-1.5">
      {!badgePlaced && turnBadge && <div className="flex justify-end">{turnBadge}</div>}
      {discardedNotice}
      {nodes}
    </div>
  );
}
