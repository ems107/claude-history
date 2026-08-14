import { ROW_H, laneColor, laneX, type GraphRowLayout } from '../../lib/gitGraph.ts';

/**
 * One row's band of the commit graph. Pure drawing — it is handed a resolved
 * layout and knows nothing about commits.
 *
 * There is one of these INSIDE each row rather than a single absolutely
 * positioned drawing over the whole list. The alternative has to keep the
 * virtualiser's window index, the scroll offset and every row height in
 * agreement at all times, and breaks the first time a row is not exactly
 * ROW_H tall. This cannot drift, because there is no arithmetic tying the two
 * together: the picture is part of the row.
 *
 * Curves put their control points ON the verticals, so two consecutive bands
 * of the same lane meet with a continuous tangent and a branch that runs for
 * five hundred rows reads as one unbroken line.
 */
export function GraphSvg({ row, width }: { row: GraphRowLayout; width: number }) {
  const mid = ROW_H / 2;
  const path = (x1: number, y1: number, x2: number, y2: number): string =>
    x1 === x2
      ? `M${x1},${y1} L${x2},${y2}`
      : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;

  return (
    <svg width={width} height={ROW_H} className="shrink-0 overflow-hidden" aria-hidden="true">
      {row.through.map((seg, i) => (
        <path
          key={`t${i}`}
          d={path(laneX(seg.from), 0, laneX(seg.to), ROW_H)}
          fill="none"
          stroke={laneColor(seg.color)}
          strokeWidth="1.5"
        />
      ))}
      {row.incoming.map((seg, i) => (
        <path
          key={`i${i}`}
          d={path(laneX(seg.from), 0, laneX(seg.to), mid)}
          fill="none"
          stroke={laneColor(seg.color)}
          strokeWidth="1.5"
        />
      ))}
      {row.outgoing.map((seg, i) => (
        <path
          key={`o${i}`}
          d={path(laneX(seg.from), mid, laneX(seg.to), ROW_H)}
          fill="none"
          stroke={laneColor(seg.color)}
          strokeWidth="1.5"
        />
      ))}
      {/* A merge is hollow: it is the one row where the dot means "two lines met". */}
      <circle
        cx={laneX(row.lane)}
        cy={mid}
        r={row.merge ? 3 : 3.5}
        fill={row.merge ? 'var(--bg)' : laneColor(row.color)}
        stroke={laneColor(row.color)}
        strokeWidth="1.5"
      />
    </svg>
  );
}
