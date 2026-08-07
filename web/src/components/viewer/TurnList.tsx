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
  }, [scrollToUuid, turns]);

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
