import { type ContextPoint, type ContextTurn, formatContextDelta, formatContextTokens } from '../../lib/context.ts';
import { CardFoot, CardHead, CardLine, HoverCard } from './HoverCard.tsx';

const tok = (n: number) => `${n.toLocaleString()} tok`;

type Shrink = NonNullable<ContextPoint['shrink']>;

function shrinkNote(s: Shrink): string {
  if (s.compacted) {
    const how = s.compacted.trigger === 'auto' ? 'autocompaction' : 'compaction';
    return `${how} here — ${formatContextTokens(s.from)} → ${formatContextTokens(s.to)}`;
  }
  // No boundary line: Claude Code also drops stale tool results on its own, and
  // rewinding truncates the conversation. Both are real, neither is recorded.
  return `the conversation shrank here — ${formatContextTokens(s.from)} → ${formatContextTokens(s.to)}, with no compaction boundary recorded`;
}

/**
 * The context window at one request, or across a turn.
 *
 * Everything here is measured, never estimated: the total is the figure
 * `/context` prints, the split is how the API billed the prompt (re-read prefix
 * vs newly written vs uncached), and the growth is the difference between two
 * measured totals. No share of the window is shown anywhere — the window size is
 * not in the transcript, and a percentage of a guessed limit is worse than none.
 */
export function ContextPill({
  point,
  turn,
  variant = 'inline',
}: {
  /** A single request. */
  point?: ContextPoint;
  /** A whole turn: its first and last request. */
  turn?: ContextTurn;
  variant?: 'inline' | 'badge';
}) {
  if (turn) {
    const grew = turn.last.total - turn.first.total;
    return (
      <HoverCard
        variant={variant}
        pill={
          <>
            <span className="mr-1 opacity-70">ctx</span>
            {formatContextTokens(turn.last.total)}
            {grew !== 0 && <span className="ml-1 opacity-70">{formatContextDelta(grew)}</span>}
          </>
        }
      >
        <CardHead left="context across this turn" right={formatContextTokens(turn.last.total)} />
        <CardLine label="at the first request" value={tok(turn.first.total)} />
        <CardLine label="at the last request" value={tok(turn.last.total)} />
        <CardLine label="grew by" value={formatContextDelta(grew)} />
        <CardLine label="requests in the turn" value={String(turn.requests)} />
        {turn.shrinks.map((s) => (
          <span key={s.uuid} className="mt-1 block text-[10px] text-amber-400/90">
            {shrinkNote(s.shrink as Shrink)}
          </span>
        ))}
        <CardFoot>
          Measured: the prompt size the API billed for each request — the same figure /context reports.
        </CardFoot>
      </HoverCard>
    );
  }

  if (!point) return null;
  const note = point.shrink ? shrinkNote(point.shrink) : null;

  return (
    <HoverCard
      variant={variant}
      pill={
        <>
          <span className="mr-1 opacity-70">ctx</span>
          {formatContextTokens(point.total)}
        </>
      }
    >
      <CardHead left="context at this point" right={formatContextTokens(point.total)} />
      <CardLine label="re-read from cache" value={tok(point.read)} />
      <CardLine label="new in this request" value={tok(point.write)} />
      <CardLine label="uncached input" value={tok(point.input)} />
      <span className="mt-1.5 block border-t border-[var(--border)] pt-1">
        <CardLine label="total sent" value={tok(point.total)} />
        <CardLine label="answer" value={tok(point.output)} />
        {point.delta !== null && (
          <CardLine
            label="since the previous request"
            value={formatContextDelta(point.delta)}
            tone={point.delta < 0 ? 'warn' : undefined}
          />
        )}
      </span>
      {point.cacheMiss && point.delta !== null && (
        <span className="mt-1 block text-[10px] text-amber-400/90">
          Nothing was re-read from cache: the whole prompt was written again, at the write rate instead of a tenth of
          it.
        </span>
      )}
      {note && <span className="mt-1 block text-[10px] text-amber-400/90">{note}</span>}
      <CardFoot>
        Measured, not estimated — the same figure /context reports (it rounds to 0.1k). The split by category exists
        only where /context was actually run.
      </CardFoot>
    </HoverCard>
  );
}
