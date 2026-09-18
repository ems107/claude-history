import type { GitRefKind } from '@claude-history/shared';

/**
 * A branch, tag or HEAD label drawn on a commit row.
 *
 * Its own component rather than a reuse of the list's `Badge`, which is not
 * exported and whose sizing belongs to the session rows. `⎇` already means a
 * git branch elsewhere in the app (session rows, the session header), so it
 * carries over; `⑂` is the subagent glyph and is deliberately not reused here.
 */
const TONE: Record<GitRefKind, string> = {
  head: 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]',
  branch: 'border-[var(--accent-dim)] text-[var(--accent)]/90',
  remote: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  tag: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
};

export function RefChip({ kind, name, isHead }: { kind: GitRefKind; name: string; isHead?: boolean }) {
  const label = kind === 'tag' ? `# ${name}` : kind === 'head' ? 'HEAD' : `⎇ ${name}`;
  // `shrink-0` beside `whitespace-nowrap` is what pushes a commit row off a
  // 360px screen: a branch called `edgar/DES-32683-something` is 200px that
  // refuses to give any of it back. Below 48rem it truncates like everything
  // else on that row.
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1 text-[10px] leading-4 whitespace-nowrap ${TONE[kind]} ${
        isHead ? 'font-semibold' : ''
      } max-md:min-w-0 max-md:max-w-24 max-md:shrink max-md:truncate`}
      title={kind === 'remote' ? `Remote branch ${name}` : kind === 'tag' ? `Tag ${name}` : name}
    >
      {label}
    </span>
  );
}
