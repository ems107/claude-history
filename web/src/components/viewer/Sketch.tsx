import { useLayoutEffect, useRef, useState } from 'react';
import { type Run, splitCells } from '../../lib/monoCells.ts';

/**
 * The mockup an `AskUserQuestion` option carries, drawn as terminal art.
 *
 * `whitespace-pre` and a scroller of its own: wrapping a drawing destroys it,
 * and the widest line in this corpus is 114 columns, which would otherwise push
 * the page sideways. Never through `Markdown` — two of these drawings contain a
 * fence marker inside the box, and a markdown pass eats them.
 *
 * The runs are what put the characters back on their grid; see `monoCells.ts`.
 * They are computed after layout because the answer depends on the font really
 * in force, and the plain text is what renders until then — and forever, in a
 * server-side render, which is the same drawing minus the straightening.
 */
export function Sketch({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);

  useLayoutEffect(() => {
    setRuns(splitCells(text, ref.current));
  }, [text]);

  return (
    <pre
      ref={ref}
      className={`max-w-full overflow-x-auto rounded border border-[var(--border)] bg-black/30 p-2 font-mono text-[11px] leading-snug whitespace-pre text-[var(--text-dim)] ${className}`}
    >
      {runs
        ? runs.map((run, i) =>
            run.cells === null ? (
              run.text
            ) : (
              <span
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                // Centred and allowed to overflow: a glyph the font draws 1.5
                // cells wide has to sit SOMEWHERE, and half a cell of overlap
                // with the space beside it is invisible next to a whole line
                // sliding out of true.
                style={{ display: 'inline-block', width: `${String(run.cells)}ch`, textAlign: 'center' }}
              >
                {run.text}
              </span>
            ),
          )
        : text}
    </pre>
  );
}
