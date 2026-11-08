import { Vec2 } from "wtc-math";
import { Polyline } from "../geometry/Polyline.js";
import { simplify, smooth } from "../geometry/simplify.js";
import { DEFAULT_RESOLUTION, windowFor, type SDFGrid } from "./grid.js";
import type { SDF } from "./SDF.js";

export interface PathFinishOptions {
  /** Rounds of Chaikin corner cutting applied to each path. Default 0. */
  smooth?: number;
  /**
   * Drops points that sit within this many mm of the path (RDP). 0 keeps
   * every point. Default 0.02, as for `circle`.
   */
  simplify?: number;
  /** Paths shorter than this (mm) are dropped. Default 0.2. */
  minLength?: number;
}

export interface IsolineOptions extends PathFinishOptions {
  /** Grid nodes per mm. Default 5 (0.2 mm cells). */
  resolution?: number;
}

/**
 * The lines where `field` equals each of `levels`, in mm. Level 0 is the
 * shape's outline, a positive level an outline grown by that much, a
 * negative one shrunk. Works on any field, so the outline of a combined field
 * is the outline of the boolean combination.
 *
 * Paths come back closed. Outer rings run clockwise on screen, like `rect`
 * and `polygon`, and the rings around holes run the other way, so the result
 * fills correctly under either fill rule. Lines are traced on a grid
 * (`resolution`) and are accurate to a small fraction of a cell, except
 * that sharp corners (like those of a shrunk polygon) can be cut off by up to
 * half a cell's diagonal: 0.14 mm at the default resolution.
 */
export function isolines(
  field: SDF,
  levels: number | readonly number[],
  options: IsolineOptions = {},
): Polyline[] {
  const list = typeof levels === "number" ? [levels] : levels;
  const bounds = field.bounds;
  if (!bounds || list.length === 0) return [];
  const resolution = options.resolution ?? DEFAULT_RESOLUTION;
  const top = Math.max(0, ...list);
  const grid = field.sampleWindow(
    windowFor(bounds, resolution, top + 2 / resolution),
  );
  return traceLevels(grid, list).flatMap((paths) =>
    finishPaths(paths, options),
  );
}

/** Smooths, simplifies and drops short paths, in that order. */
export function finishPaths(
  paths: readonly Polyline[],
  options: PathFinishOptions = {},
): Polyline[] {
  const rounds = options.smooth ?? 0;
  const tolerance = options.simplify ?? 0.02;
  const minLength = options.minLength ?? 0.2;
  const out: Polyline[] = [];
  for (let path of paths) {
    if (rounds > 0) path = smooth(path, rounds);
    if (tolerance > 0) path = simplify(path, tolerance);
    if (path.pointCount < (path.closed ? 3 : 2)) continue;
    if (path.length < minLength) continue;
    out.push(path);
  }
  return out;
}

/**
 * Marching squares over `grid` for every level at once. Returns the raw
 * paths for each level, in the order `levels` were given.
 *
 * A node counts as inside a level when its value is below it. Crossings are
 * interpolated linearly along cell edges. Segments run with the inside on
 * their right on screen, which makes outer rings clockwise, and where a cell
 * is a saddle the mean of its corners decides whether the inside joins
 * across it. Lines that reach the edge of the grid come back open.
 */
export function traceLevels(
  grid: SDFGrid,
  levels: readonly number[],
): Polyline[][] {
  const { cols, rows, data } = grid;
  const order = levels.map((_, i) => i).sort((a, b) => levels[a] - levels[b]);
  const sorted = order.map((i) => levels[i]);
  const count = sorted.length;
  // For each level, the crossing each segment runs to, keyed by the
  // crossing it starts from.
  const links: Map<number, number>[] = sorted.map(() => new Map());
  const H = (cols - 1) * rows; // horizontal edges come first in the ids

  const inside = [false, false, false, false];
  const edgeIds = [0, 0, 0, 0];
  const exits: number[] = [];
  const entries: number[] = [];
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < cols; i++) {
      const k = j * cols + i;
      // Corners clockwise on screen from the top left; edge e joins corner
      // e to corner e + 1.
      const v0 = data[k];
      const v1 = data[k + 1];
      const v2 = data[k + cols + 1];
      const v3 = data[k + cols];
      const lo = Math.min(v0, v1, v2, v3);
      const hi = Math.max(v0, v1, v2, v3);
      // Levels c with lo < c <= hi cross this cell.
      let l = firstAbove(sorted, lo);
      if (l >= count || sorted[l] > hi) continue;
      edgeIds[0] = j * (cols - 1) + i;
      edgeIds[1] = H + j * cols + i + 1;
      edgeIds[2] = (j + 1) * (cols - 1) + i;
      edgeIds[3] = H + j * cols + i;
      for (; l < count && sorted[l] <= hi; l++) {
        const c = sorted[l];
        inside[0] = v0 < c;
        inside[1] = v1 < c;
        inside[2] = v2 < c;
        inside[3] = v3 < c;
        exits.length = 0;
        entries.length = 0;
        for (let e = 0; e < 4; e++) {
          const a = inside[e];
          const b = inside[(e + 1) & 3];
          if (a && !b) exits.push(e);
          else if (!a && b) entries.push(e);
        }
        const link = links[l];
        if (exits.length === 1) {
          link.set(edgeIds[exits[0]], edgeIds[entries[0]]);
        } else {
          // A saddle: two inside corners facing each other.
          const joined = (v0 + v1 + v2 + v3) / 4 < c;
          for (const e of exits) {
            const to = joined ? (e + 1) & 3 : (e + 3) & 3;
            link.set(edgeIds[e], edgeIds[to]);
          }
        }
      }
    }
  }

  const out: Polyline[][] = levels.map(() => []);
  for (let l = 0; l < count; l++) {
    const c = sorted[l];
    const link = links[l];
    const position = (id: number): [number, number] => {
      let ia: number;
      let ja: number;
      let ib: number;
      let jb: number;
      if (id < H) {
        ja = jb = Math.floor(id / (cols - 1));
        ia = id - ja * (cols - 1);
        ib = ia + 1;
      } else {
        const m = id - H;
        ja = Math.floor(m / cols);
        ia = ib = m - ja * cols;
        jb = ja + 1;
      }
      const va = data[ja * cols + ia];
      const vb = data[jb * cols + ib];
      const t = (c - va) / (vb - va);
      const xa = grid.x(ia);
      const ya = grid.y(ja);
      return [xa + (grid.x(ib) - xa) * t, ya + (grid.y(jb) - ya) * t];
    };

    const targets = new Set(link.values());
    const seen = new Set<number>();
    const paths: Polyline[] = [];
    const trace = (start: number) => {
      const points: Vec2[] = [];
      let id: number | undefined = start;
      let closed = false;
      while (id !== undefined) {
        seen.add(id);
        const [x, y] = position(id);
        const last = points[points.length - 1];
        if (!last || last.x !== x || last.y !== y) points.push(new Vec2(x, y));
        id = link.get(id);
        if (id === start) {
          closed = true;
          break;
        }
      }
      if (closed && points.length > 1) {
        const first = points[0];
        const last = points[points.length - 1];
        if (first.x === last.x && first.y === last.y) points.pop();
      }
      if (points.length >= (closed ? 3 : 2)) {
        paths.push(new Polyline(points, closed));
      }
    };
    // Open lines start where nothing runs in; everything left is a loop.
    for (const id of link.keys()) if (!targets.has(id)) trace(id);
    for (const id of link.keys()) if (!seen.has(id)) trace(id);
    out[order[l]] = paths;
  }
  return out;
}

/** Index of the first entry of the ascending list `xs` above `x`. */
function firstAbove(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
