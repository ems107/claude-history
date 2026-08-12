import type { CompactBoundary, MessageItem, Turn } from '@claude-history/shared';

/** A turn, with the index it has in the session's own `turns` array. */
export interface SegmentTurn {
  turn: Turn;
  /**
   * The ORIGINAL index. The cost and context indexes are built over every turn
   * and read by position (`perTurn[i]`), and they have to stay that way: the
   * session total only reconciles because each assistant message is counted
   * exactly once. Segmenting is presentation, never a filter on the data.
   */
  index: number;
}

/**
 * A stretch of conversation between two compactions — one "context" the model
 * held from beginning to end.
 */
export interface Segment {
  /** Stable: compacting closes the live segment and opens a new one after it. */
  index: number;
  turns: SegmentTurn[];
  /** The compaction that CLOSED this segment; null on the live one. */
  boundary: CompactBoundary | null;
  isLive: boolean;
}

function boundaryOf(turn: Turn): CompactBoundary | null {
  for (const item of turn.items) {
    for (const block of item.blocks) {
      if (block.kind === 'compact') return block.boundary;
    }
  }
  return null;
}

/**
 * Split the conversation at its compaction boundaries. A session with none
 * yields exactly one live segment, and the viewer then looks as it always did.
 *
 * The cut is at TURN granularity: the turn holding the boundary closes the
 * segment. The parser hangs the boundary off whatever turn was open
 * (`ensureTurn`) and the line right after it — the summary, a `user` line with
 * string content — always opens a new one, so in practice the boundary is the
 * last item of its turn. Were something ever to follow it inside the same turn,
 * it would stay in the segment being closed; that is the price of not splitting
 * a `Turn`, which would hand two halves the same per-turn cost badge.
 */
export function buildSegments(turns: Turn[]): Segment[] {
  const segments: Segment[] = [];
  let current: SegmentTurn[] = [];

  for (const [index, turn] of turns.entries()) {
    current.push({ turn, index });
    const boundary = boundaryOf(turn);
    if (boundary) {
      segments.push({ index: segments.length, turns: current, boundary, isLive: false });
      current = [];
    }
  }
  // Always present, even empty: a compaction that just happened has no turn
  // after it yet, and the live segment is still where the next one will land.
  segments.push({ index: segments.length, turns: current, boundary: null, isLive: true });
  return segments;
}

/** A stretch of a segment: either live conversation or what one rewind cut away. */
export type TurnGroup =
  | { kind: 'live'; turns: SegmentTurn[] }
  | { kind: 'discarded'; turns: SegmentTurn[]; key: string; branch: string };

/** The branch a whole turn was cut away with, or null if any of it still stands. */
function discardedBranchOf(st: SegmentTurn): string | null {
  const items = st.turn.items;
  if (items.length === 0) return null;
  const branch = items[0].discardedBranch;
  return branch !== null && items.every((i) => i.discardedBranch === branch) ? branch : null;
}

/**
 * Split a segment's turns into runs of live turns and runs of rewound-away ones,
 * so each abandoned branch folds into its own header instead of reading like
 * conversation that still stands.
 *
 * Turns are grouped only while they belong to the SAME branch: two rewinds to the
 * same message leave two branches, consecutive in the file and adjacent here, and
 * merging them would date one stretch from the first message of one to the last
 * of the other — a span nothing ever occupied.
 *
 * A rewind branches at a prompt, and a prompt opens a turn, so in practice a turn
 * is entirely on one side; a turn that somehow mixed both counts as live, because
 * hiding a live message is the worse mistake (`Turn.tsx` labels it instead).
 */
export function groupTurns(turns: SegmentTurn[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const st of turns) {
    const branch = discardedBranchOf(st);
    const last = groups[groups.length - 1];
    if (last && (branch === null ? last.kind === 'live' : last.kind === 'discarded' && last.branch === branch)) {
      last.turns.push(st);
    } else if (branch !== null) {
      // Keyed on the turn's own first uuid rather than on the branch: stable
      // across the refetches of a live session, and unique even if a branch ever
      // came back to the file in two pieces.
      groups.push({ kind: 'discarded', turns: [st], key: `discarded-${st.turn.items[0]?.uuid ?? st.index}`, branch });
    } else {
      groups.push({ kind: 'live', turns: [st] });
    }
  }
  return groups;
}

/**
 * A message the user actually typed. `role === 'user'` is not enough: the
 * summary a compaction writes wears the same role, and so do the lines that
 * only carry tool results back.
 */
export function isPromptItem(item: MessageItem): boolean {
  return (
    item.role === 'user' &&
    !item.isCompactSummary &&
    item.blocks.some((b) => b.kind === 'text' || b.kind === 'command')
  );
}

export interface SegmentSummary {
  items: MessageItem[];
  prompts: number;
  firstAt: string | null;
  lastAt: string | null;
}

/** What a collapsed segment header shows. All of it derivable in the client. */
export function summarizeSegment(segment: Segment): SegmentSummary {
  return summarizeTurns(segment.turns);
}

/** The same, for any run of turns — a discarded branch has its own header. */
export function summarizeTurns(turns: SegmentTurn[]): SegmentSummary {
  const items = turns.flatMap((t) => t.turn.items);
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  for (const item of items) {
    if (!item.timestamp) continue;
    firstAt ??= item.timestamp;
    lastAt = item.endTimestamp ?? item.timestamp;
  }
  return { items, prompts: items.filter(isPromptItem).length, firstAt, lastAt };
}
