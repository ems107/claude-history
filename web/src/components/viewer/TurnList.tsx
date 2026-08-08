import type { Turn } from '@claude-history/shared';
import { useEffect } from 'react';
import { TurnView } from './Turn.tsx';

export function TurnList({
  turns,
  showThinking,
  expandTools = false,
  scrollToUuid,
  onOpenAgent,
}: {
  turns: Turn[];
  showThinking: boolean;
  expandTools?: boolean;
  scrollToUuid?: string | null;
  onOpenAgent?: (agentId: string) => void;
}) {
  useEffect(() => {
    if (!scrollToUuid) return;
    // Let the DOM settle before scrolling to the deep-linked message.
    const t = setTimeout(() => {
      const el = document.getElementById(scrollToUuid);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('ring-2', 'ring-[var(--accent)]');
        setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--accent)]'), 2500);
      }
    }, 100);
    return () => clearTimeout(t);
    // Deliberately NOT keyed on `turns`: the deep-linked jump belongs to the
    // link, not to the data. Re-running it on every refetch yanked a live
    // session back to the linked message every few seconds — and it fought the
    // follow-the-end button for control of the scroll. The turns are already
    // rendered when this mounts, so there is nothing to wait for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToUuid]);

  return (
    <div className="space-y-4">
      {turns.map((turn, i) => (
        <TurnView
          key={turn.promptId ?? i}
          turn={turn}
          showThinking={showThinking}
          expandTools={expandTools}
          onOpenAgent={onOpenAgent}
        />
      ))}
    </div>
  );
}
