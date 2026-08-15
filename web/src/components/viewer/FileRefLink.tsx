import type { ReactNode } from 'react';
import { type FileRef, parseFileRef } from '../../lib/fileRefs.ts';
import { hasSelection } from '../../lib/selection.ts';
import { type FileRefContextValue, useFileRefs } from './FileRefContext.ts';

/**
 * The click that opens the file panel instead of navigating.
 *
 * It stays an `<a>` with a real href — copy-link, middle click and ctrl+click
 * all have to keep working, and a `<button>` would make the text unselectable,
 * which is the rule the fold headers are built on.
 */
export function FileLink({
  ctx,
  fileRef,
  className,
  title,
  children,
}: {
  ctx: FileRefContextValue;
  fileRef: FileRef;
  className: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <a
      href={ctx.hrefFor(fileRef)}
      data-file-ref={fileRef.path}
      title={title}
      // Underline and colour only: a `filter` anywhere above a message would
      // make the bubble the containing block for the fixed cost and context
      // popovers inside it.
      className={className}
      onClick={(e) => {
        // A modified click belongs to the browser: new tab, new window, save.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // A drag that ended on the link was a copy, not a click — and prose is
        // where people drag most.
        if (hasSelection()) return;
        e.preventDefault();
        ctx.openFile(fileRef);
      }}
    >
      {children}
    </a>
  );
}

/**
 * The opener for a path that is already on screen as text but cannot become a
 * link: the file path in a tool header and in the "files touched" panel both
 * live inside a `FoldHeader`, and nothing interactive may be nested in one.
 * So the path stays inert and this sits BESIDE the header, the way the cost
 * pill and the subagent link already do — the whole header goes on folding.
 */
export function FileRefChip({ path, title }: { path: string; title?: string }) {
  const ctx = useFileRefs();
  const fileRef = ctx ? parseFileRef(path) : null;
  if (!ctx || !fileRef) return null;
  return (
    <FileLink
      ctx={ctx}
      fileRef={fileRef}
      className="shrink-0 cursor-pointer rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-300 hover:bg-amber-500/25"
      title={title ?? `Open ${fileRef.path}`}
    >
      📄
    </FileLink>
  );
}
