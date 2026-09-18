/**
 * A chip that only exists when it has something to say.
 *
 * Here rather than in the component that first needed it, because three now draw
 * them — the delivery card in the conversation and the two file panels — and a
 * chip that is a different size or a different amber in one of them reads as a
 * different KIND of thing, which is the opposite of what it is for.
 *
 * `warn` is for a fact the reader has to act on (a path nobody could confirm, a
 * delivery that failed, a file that is no longer there). `quiet` is for a fact
 * that merely qualifies the row. Nothing else: two tones is what keeps the amber
 * meaning something.
 */
export function Chip({
  children,
  tone,
  title,
}: {
  children: string;
  tone: 'quiet' | 'warn';
  title: string;
}) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold tracking-wide normal-case ${
        tone === 'warn' ? 'bg-amber-500/15 text-amber-300' : 'bg-[var(--bg)] text-[var(--text-dim)]'
      }`}
    >
      {children}
    </span>
  );
}
