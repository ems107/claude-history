import { FoldHeader } from './FoldHeader.tsx';
import { useFoldable } from './RevealContext.ts';

export function ThinkingBlock({ text, owner }: { text: string; owner?: string }) {
  // `owner` is the message this block belongs to, which is the only name a jump
  // has for it: thinking carries no id of its own, and the bubble around it is
  // what `?msg=` points at.
  const [open, setOpen] = useFoldable(owner ? `msg:${owner}` : null);
  return (
    <div className="my-1.5 rounded border border-dashed border-[var(--border)]">
      <FoldHeader
        open={open}
        onToggle={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-[var(--text-dim)]/80 italic"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>thinking</span>
        {!open && <span className="truncate not-italic opacity-60">{text.slice(0, 120)}</span>}
      </FoldHeader>
      {open && (
        <div className="border-t border-dashed border-[var(--border)] px-3 py-2 text-xs whitespace-pre-wrap text-[var(--text-dim)]">
          {text}
        </div>
      )}
    </div>
  );
}
