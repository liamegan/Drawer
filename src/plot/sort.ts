import { Vec2 } from "wtc-math";
import { Polyline } from "../geometry/Polyline.js";
import { PointGrid } from "./grid.js";

export interface SortOptions {
  /** Where the pen starts, in mm. Default (0, 0), the top-left corner. */
  start?: Vec2;
  /**
   * Start each closed path at its vertex nearest the pen, rather than where
   * it was drawn from. Default true.
   */
  rotateClosed?: boolean;
}

/**
 * Orders paths to cut pen-up travel: from `start`, always draws the nearest
 * path next, from whichever end is nearer (reversing it if needed) or, for a
 * closed path, from its nearest vertex. Greedy nearest neighbour, so not
 * optimal, but it usually removes most of the travel. Paths with fewer than
 * two points are dropped; nothing else is changed.
 */
export function sortPaths(
  paths: readonly Polyline[],
  options: SortOptions = {},
): Polyline[] {
  const rotate = options.rotateClosed ?? true;
  const list = paths.filter((p) => p.pointCount >= 2);

  // Entry points: both ends of open paths; every vertex of closed ones, or
  // just the first when they aren't rotated.
  const first = new Int32Array(list.length + 1);
  let count = 0;
  list.forEach((path, p) => {
    first[p] = count;
    count += path.closed ? (rotate ? path.pointCount : 1) : 2;
  });
  first[list.length] = count;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const owner = new Int32Array(count);
  list.forEach((path, p) => {
    const pts = path.points;
    const ids = path.closed
      ? rotate
        ? pts.map((_, i) => i)
        : [0]
      : [0, pts.length - 1];
    ids.forEach((vertex, k) => {
      const id = first[p] + k;
      xs[id] = pts[vertex].x;
      ys[id] = pts[vertex].y;
      owner[id] = p;
    });
  });

  const grid = new PointGrid(xs, ys);
  const out: Polyline[] = [];
  let x = options.start?.x ?? 0;
  let y = options.start?.y ?? 0;
  while (grid.size > 0) {
    const id = grid.nearest(x, y);
    const p = owner[id];
    const path = list[p];
    const k = id - first[p];
    for (let i = first[p]; i < first[p + 1]; i++) grid.remove(i);

    let next: Polyline;
    if (path.closed) {
      next = k === 0 ? path : rotated(path, k);
    } else {
      next = k === 0 ? path : path.reversed();
    }
    out.push(next);
    // A closed path ends where it started.
    const exit = next.closed ? next.start! : next.end!;
    x = exit.x;
    y = exit.y;
  }
  return out;
}

/** A closed path started at vertex `k`. */
function rotated(path: Polyline, k: number): Polyline {
  const pts = path.points;
  return new Polyline([...pts.slice(k), ...pts.slice(0, k)], true);
}

/** Pen-up distance to draw `paths` in order from `start`, back to `start`. */
export function travelLength(
  paths: readonly Polyline[],
  start: Vec2 = new Vec2(0, 0),
): number {
  let x = start.x;
  let y = start.y;
  let total = 0;
  for (const path of paths) {
    if (path.pointCount < 2) continue;
    const entry = path.start!;
    total += Math.hypot(entry.x - x, entry.y - y);
    const exit = path.closed ? entry : path.end!;
    x = exit.x;
    y = exit.y;
  }
  return total + Math.hypot(start.x - x, start.y - y);
}
