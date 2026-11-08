import type { Vec2 } from "wtc-math";
import { Polyline } from "../geometry/Polyline.js";
import { PointGrid } from "./grid.js";

export interface MergeOptions {
  /** Ends this close (mm) are joined. Default 0.05. */
  tolerance?: number;
}

/**
 * Joins open paths whose ends meet, within `tolerance`, into longer ones,
 * reversing paths where needed, so the pen lifts less often. A chain that
 * comes back to where it started becomes a closed path. Closed paths are
 * left as they are. Where several ends meet at one point, the nearest is
 * taken.
 */
export function mergePaths(
  paths: readonly Polyline[],
  options: MergeOptions = {},
): Polyline[] {
  const tolerance = options.tolerance ?? 0.05;
  if (!(tolerance >= 0)) {
    throw new RangeError("mergePaths: tolerance must be non-negative");
  }
  const open: Polyline[] = [];
  const out: Polyline[] = [];
  for (const path of paths) {
    if (path.pointCount < 2) continue;
    if (path.closed) out.push(path);
    else open.push(path);
  }

  // Point 2p is the start of open path p, 2p + 1 its end.
  const xs = new Float64Array(open.length * 2);
  const ys = new Float64Array(open.length * 2);
  open.forEach((path, p) => {
    xs[2 * p] = path.start!.x;
    ys[2 * p] = path.start!.y;
    xs[2 * p + 1] = path.end!.x;
    ys[2 * p + 1] = path.end!.y;
  });
  const grid = new PointGrid(xs, ys);
  const take = (p: number) => {
    grid.remove(2 * p);
    grid.remove(2 * p + 1);
  };

  for (let p = 0; p < open.length; p++) {
    if (!grid.has(2 * p)) continue;
    take(p);
    // Grown forwards from the end, then backwards from the start; the
    // backward pieces are kept apart and put in front at the end.
    const chain: Vec2[] = [...open[p].points];
    const before: Vec2[][] = [];
    let pieces = 1;
    for (const forwards of [true, false]) {
      let tip = forwards ? chain[chain.length - 1] : chain[0];
      for (;;) {
        const id = grid.nearest(tip.x, tip.y, tolerance);
        if (id < 0) break;
        const q = id >> 1;
        take(q);
        pieces++;
        // Line the piece up so it runs away from the tip.
        const atStart = (id & 1) === 0;
        let pts = [...open[q].points];
        if (atStart !== forwards) pts.reverse();
        if (same(pts[forwards ? 0 : pts.length - 1], tip)) {
          pts = forwards ? pts.slice(1) : pts.slice(0, -1);
        }
        if (pts.length === 0) continue;
        if (forwards) {
          for (const pt of pts) chain.push(pt);
          tip = pts[pts.length - 1];
        } else {
          before.push(pts);
          tip = pts[0];
        }
      }
    }
    const full = before.length ? [...before.reverse().flat(), ...chain] : chain;
    out.push(closeIfLooped(full, pieces, tolerance, open[p]));
  }
  return out;
}

/** The chain as a path, closed if its ends meet. */
function closeIfLooped(
  chain: Vec2[],
  pieces: number,
  tolerance: number,
  original: Polyline,
): Polyline {
  const a = chain[0];
  const b = chain[chain.length - 1];
  const looped = chain.length >= 4 && a.distance(b) <= tolerance;
  if (!looped) return pieces === 1 ? original : new Polyline(chain);
  // Closing draws the last segment back to the start; drop a repeated point.
  return new Polyline(same(a, b) ? chain.slice(0, -1) : chain, true);
}

function same(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
