import type { GitCommit } from '@claude-history/shared';

/**
 * Turning a list of commits into a drawable graph.
 *
 * The server sends `{sha, parents[]}` and nothing about layout, because layout
 * is presentation: it depends on how wide the pane is, and it has to be redone
 * every time another page is appended. Doing it here keeps the payload
 * identical for two tabs — so the query cache can hold it — and keeps this a
 * pure function of an ordered commit list, checkable without a browser.
 */

/** Row height. Dense on purpose; also the exact figure the virtualiser estimates. */
export const ROW_H = 26;
export const LANE_W = 14;
export const LANE_X0 = 10;
/**
 * Past this the lanes are clipped. A repository with thirty live branches must
 * not push the subject off the row — the graph is an aid, not the content.
 */
export const MAX_GRAPH_PX = 220;

export const laneX = (lane: number): number => LANE_X0 + lane * LANE_W;

/** Golden-angle spread, the same recipe the project tags use, frozen into a table. */
const LANE_HUES = [12, 149, 286, 63, 200, 337, 100, 240, 26, 175, 312, 88];

export const laneColor = (index: number): string => `hsl(${LANE_HUES[index % LANE_HUES.length]} 62% 62%)`;

export interface GraphSegment {
  from: number;
  to: number;
  color: number;
}

/**
 * One row's band, resolved so it can be drawn without looking at its
 * neighbours. That independence is the whole point: each row draws its own
 * `<svg>` inside itself, so a virtualised window can never drift out of
 * alignment with a separately-positioned drawing, and a row that grows taller
 * cannot break the picture.
 */
export interface GraphRowLayout {
  lane: number;
  color: number;
  merge: boolean;
  /** Lanes waiting for this commit, arriving from the top edge. */
  incoming: GraphSegment[];
  /** This commit's parents, leaving towards the bottom edge. */
  outgoing: GraphSegment[];
  /** Unrelated lanes crossing the band, possibly shifting sideways. */
  through: GraphSegment[];
  /** Lanes in use around this row, for the row's own width. */
  width: number;
}

export interface GraphLayout {
  rows: GraphRowLayout[];
  maxLane: number;
}

/**
 * The active-lane sweep. Each lane holds the sha it is still waiting to draw;
 * a commit takes the lane that was waiting for it (or a fresh one), then hands
 * that lane to its first parent and finds lanes for the rest.
 */
export function layoutGraph(commits: GitCommit[]): GraphLayout {
  const lanes: (string | null)[] = [];
  const colors: number[] = [];
  let nextColor = 0;
  let maxLane = 0;
  const rows: GraphRowLayout[] = [];

  const freeLane = (): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) return free;
    lanes.push(null);
    colors.push(0);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const before = lanes.slice();
    const beforeColors = colors.slice();

    // Every lane waiting for this commit. More than one means several children
    // converge here, and all but the first are released.
    const waiting: number[] = [];
    for (let j = 0; j < before.length; j++) {
      if (before[j] === commit.sha) waiting.push(j);
    }

    let lane: number;
    let color: number;
    if (waiting.length > 0) {
      lane = waiting[0];
      color = colors[lane];
      for (const other of waiting.slice(1)) lanes[other] = null;
    } else {
      lane = freeLane();
      color = nextColor++;
      colors[lane] = color;
    }

    const outgoing: GraphSegment[] = [];
    if (commit.parents.length === 0) {
      lanes[lane] = null;
    } else {
      lanes[lane] = commit.parents[0];
      colors[lane] = color;
      outgoing.push({ from: lane, to: lane, color });
      for (const parent of commit.parents.slice(1)) {
        // A parent another lane is already waiting for keeps that lane: the
        // merge line then runs into a branch that is already drawn.
        let target = lanes.indexOf(parent);
        if (target < 0) {
          target = freeLane();
          colors[target] = nextColor++;
        }
        lanes[target] = parent;
        outgoing.push({ from: lane, to: target, color: colors[target] });
      }
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colors.pop();
    }

    const after = lanes.slice();
    const through: GraphSegment[] = [];
    for (let j = 0; j < before.length; j++) {
      const sha = before[j];
      if (sha === null || sha === commit.sha) continue;
      const to = after.indexOf(sha);
      if (to < 0) continue; // it ended here (it was a parent taken over above)
      through.push({ from: j, to, color: beforeColors[j] });
    }

    const width = Math.max(before.length, after.length, lane + 1);
    maxLane = Math.max(maxLane, width);
    rows.push({
      lane,
      color,
      merge: commit.parents.length > 1,
      incoming: waiting.map((j) => ({ from: j, to: lane, color: beforeColors[j] })),
      outgoing,
      through,
      width,
    });
  }

  return { rows, maxLane };
}

/** How wide the graph column has to be for a layout, capped. */
export function graphWidth(maxLane: number): number {
  return Math.min(MAX_GRAPH_PX, laneX(Math.max(1, maxLane)) + LANE_W / 2);
}
