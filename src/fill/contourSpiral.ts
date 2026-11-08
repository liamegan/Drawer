import { Vec2 } from "wtc-math";
import { Polyline } from "../geometry/Polyline.js";
import { DEFAULT_RESOLUTION, type SDFGrid } from "../sdf/grid.js";
import {
  finishPaths,
  traceLevels,
  type PathFinishOptions,
} from "../sdf/isolines.js";
import {
  contourField,
  type ContourFieldOptions,
  type ContourShape,
} from "./contour.js";

export interface ContourSpiralOptions
  extends ContourFieldOptions,
    PathFinishOptions {
  /** Distance between turns, in mm. */
  spacing: number;
  /**
   * Gap between the outline and the first turn, as a fraction of the
   * spacing. Default 0.5.
   */
  offset?: number;
  /**
   * The spiral starts at the point of its outermost turn nearest this.
   * Default: the top-left corner of the shape's bounds.
   */
  start?: Vec2;
}

/**
 * Fills a shape with a spiral that follows its outline: one continuous
 * stroke whose turns stay `spacing` apart, in any shape, concave or not.
 *
 * Each turn starts on one contour (see `contourHatch`) and sinks steadily to
 * the next over one lap, so the stroke stays parallel to the outline. Where
 * the shape narrows and its contours split into separate lobes (a dumbbell,
 * a hand), the stroke carries on into one lobe and each other lobe gets a
 * spiral of its own, so the result is one stroke per lobe. Where a part of
 * the shape is too thin for another turn, the spiral runs up its middle and
 * back.
 *
 * Spacing is even wherever the contours keep their shape from one turn to
 * the next. Where a lobe narrows away between two turns, the turns after it
 * close up a little for one lap.
 *
 * Shapes with holes can't be filled by one inward spiral; they get
 * `contourHatch` rings instead. As with `spiral`, the first turn can't stay
 * parallel to the outline: its gap grows from `offset` to `offset + 1`
 * spacings, then steps back where it began.
 */
export function contourSpiral(
  shapes: ContourShape,
  options: ContourSpiralOptions,
): Polyline[] {
  const { spacing } = options;
  if (!(spacing > 0) || !Number.isFinite(spacing)) {
    throw new RangeError("contourSpiral: spacing must be a positive number");
  }
  const offset = options.offset ?? 0.5;
  const field = contourField(shapes, options);
  const bounds = field.bounds;
  if (!bounds) return [];
  const grid = field.sample({
    resolution: options.resolution ?? DEFAULT_RESOLUTION,
  });

  const deepest = grid.min;
  const levels: number[] = [];
  for (let k = 0; ; k++) {
    const level = -(offset + k) * spacing;
    if (!(level > deepest)) break;
    levels.push(level);
  }
  const rings = traceLevels(grid, levels).map((paths, k) =>
    paths.map((path) => toRing(path, k)),
  );
  if (rings.length === 0) return [];

  // Each ring's parent is the ring on the level before that contains it.
  // Eroding a shape can split it but never make a hole, so without holes
  // the rings form a tree.
  const roots: Ring[] = [];
  const holes: Ring[] = [];
  for (let k = 0; k < rings.length; k++) {
    for (const ring of rings[k]) {
      if (ring.area < 0) {
        holes.push(ring);
        continue;
      }
      const parent =
        k === 0 ? null : findContaining(rings[k - 1], ring.xs[0], ring.ys[0]);
      if (parent) parent.children.push(ring);
      else roots.push(ring);
    }
  }
  const holed = new Set<Ring>();
  const holesOf = new Map<Ring, Ring[]>();
  for (const hole of holes) {
    const root = findContaining(roots, hole.xs[0], hole.ys[0]);
    if (!root) continue;
    holed.add(root);
    holesOf.set(root, [...(holesOf.get(root) ?? []), hole]);
  }

  const startX = options.start?.x ?? bounds.min.x;
  const startY = options.start?.y ?? bounds.min.y;
  const out: Polyline[] = [];
  for (const root of roots) {
    if (holed.has(root)) {
      // Fall back to plain contours, outermost first.
      const members = [...subtree(root), ...(holesOf.get(root) ?? [])];
      members.sort((a, b) => a.k - b.k);
      out.push(...finishPaths(members.map(toPolyline), options));
      continue;
    }
    const strokes = spiralsFrom(root, startX, startY, levels, spacing, grid);
    out.push(...finishPaths(strokes, options));
  }
  return out;
}

/** A contour as coordinate arrays, with its level index and signed area. */
interface Ring {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly k: number;
  /** Twice the signed area: positive for outer rings, negative round holes. */
  readonly area: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly children: Ring[];
}

function toRing(path: Polyline, k: number): Ring {
  const n = path.pointCount;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  path.points.forEach((p, i) => {
    xs[i] = p.x;
    ys[i] = p.y;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return { xs, ys, k, area, minX, minY, maxX, maxY, children: [] };
}

function toPolyline(ring: Ring): Polyline {
  return new Polyline(
    Array.from(ring.xs, (x, i) => new Vec2(x, ring.ys[i])),
    true,
  );
}

function* subtree(ring: Ring): Generator<Ring> {
  yield ring;
  for (const child of ring.children) yield* subtree(child);
}

/** The first outer ring in `rings` that contains (x, y). */
function findContaining(
  rings: readonly Ring[],
  x: number,
  y: number,
): Ring | null {
  for (const ring of rings) {
    if (ring.area <= 0) continue;
    if (x < ring.minX || x > ring.maxX || y < ring.minY || y > ring.maxY) {
      continue;
    }
    if (ringContains(ring, x, y)) return ring;
  }
  return null;
}

/** Even-odd point-in-polygon test against one ring. */
function ringContains(ring: Ring, x: number, y: number): boolean {
  const { xs, ys } = ring;
  const n = xs.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (
      ys[i] > y !== ys[j] > y &&
      x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** The point on `ring` nearest (x, y): [x, y, segment index, parameter]. */
function closestOnRing(
  ring: Ring,
  x: number,
  y: number,
): [number, number, number, number] {
  const { xs, ys } = ring;
  const n = xs.length;
  let best = Infinity;
  let result: [number, number, number, number] = [xs[0], ys[0], 0, 0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = xs[j] - xs[i];
    const ey = ys[j] - ys[i];
    const len2 = ex * ex + ey * ey;
    let t = len2 > 0 ? ((x - xs[i]) * ex + (y - ys[i]) * ey) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = xs[i] + ex * t;
    const py = ys[i] + ey * t;
    const d = (px - x) * (px - x) + (py - y) * (py - y);
    if (d < best) {
      best = d;
      result = [px, py, i, t];
    }
  }
  return result;
}

/**
 * Spirals into the tree of rings under `root`: one stroke that follows a
 * chain of rings inward, plus one more for every lobe it splits off.
 */
function spiralsFrom(
  root: Ring,
  startX: number,
  startY: number,
  levels: readonly number[],
  spacing: number,
  grid: SDFGrid,
): Polyline[] {
  const [sx, sy] = closestOnRing(root, startX, startY);
  const queue: { ring: Ring; x: number; y: number }[] = [
    { ring: root, x: sx, y: sy },
  ];
  const strokes: Polyline[] = [];
  const land = 2 * grid.cell;
  while (queue.length > 0) {
    let { ring, x, y } = queue.shift()!;
    const points: Vec2[] = [];
    for (;;) {
      [x, y] = walkTurn(ring, x, y, levels[ring.k], spacing, grid, points);
      if (ring.children.length === 0) break;
      // Carry on into the child the turn ended on. Every other child, or
      // all of them if the turn ended in a part that ran out, starts a new
      // spiral from the point nearest where this one is.
      const children = ring.children;
      const seams = children.map((child) => closestOnRing(child, x, y));
      let next = -1;
      let nearest = Infinity;
      for (let c = 0; c < children.length; c++) {
        const d = Math.hypot(seams[c][0] - x, seams[c][1] - y);
        if (d < nearest) {
          nearest = d;
          next = c;
        }
      }
      if (nearest > land) next = -1;
      for (let c = 0; c < children.length; c++) {
        if (c !== next) {
          queue.push({ ring: children[c], x: seams[c][0], y: seams[c][1] });
        }
      }
      if (next < 0) break;
      [x, y] = seams[next];
      ring = children[next];
    }
    if (points.length >= 2) strokes.push(new Polyline(points));
  }
  return strokes;
}

/**
 * One turn of the spiral: walks `ring` (at `level`) once round from the
 * point nearest (x, y), sinking each point towards the next level in
 * proportion to how far round it is. Appends the points to `out` and returns
 * where the turn ends, a spacing deeper than it began.
 */
function walkTurn(
  ring: Ring,
  x: number,
  y: number,
  level: number,
  spacing: number,
  grid: SDFGrid,
  out: Vec2[],
): [number, number] {
  const { xs, ys } = ring;
  const n = xs.length;
  const [qx, qy, seg] = closestOnRing(ring, x, y);

  // The seam, then every vertex once round, then the seam again.
  const lap = new Float64Array(2 * (n + 2));
  lap[0] = qx;
  lap[1] = qy;
  for (let m = 1; m <= n; m++) {
    const i = (seg + m) % n;
    lap[2 * m] = xs[i];
    lap[2 * m + 1] = ys[i];
  }
  lap[2 * (n + 1)] = qx;
  lap[2 * (n + 1) + 1] = qy;

  // The turn must end where the next one can start: a spacing deeper. If
  // the seam sits in a part of the shape that runs out before then (a lobe
  // narrowing away), carry the turn on past the seam to the first point
  // that can go deeper, so the stroke continues instead of stopping.
  let extra = 0;
  if (ring.children.length > 0) {
    const deeper = level - spacing;
    const reach = 1e-3 * grid.cell;
    for (let m = 0; m <= n; m++) {
      const [ex, ey] = descend(grid, lap[2 * m], lap[2 * m + 1], deeper);
      if (grid.sample(ex, ey) <= deeper + reach) {
        extra = m;
        break;
      }
    }
  }

  // Walk the lap plus `extra` points, sinking a spacing over the whole way.
  const count = n + 2 + extra;
  const px = (m: number) => (m < n + 2 ? lap[2 * m] : lap[2 * (m - n - 1)]);
  const py = (m: number) =>
    m < n + 2 ? lap[2 * m + 1] : lap[2 * (m - n - 1) + 1];
  const along = new Float64Array(count);
  for (let m = 1; m < count; m++) {
    along[m] =
      along[m - 1] + Math.hypot(px(m) - px(m - 1), py(m) - py(m - 1));
  }
  const total = along[count - 1];

  let end: [number, number] = [qx, qy];
  for (let m = 0; m < count; m++) {
    const t = total > 0 ? along[m] / total : 1;
    end = descend(grid, px(m), py(m), level - t * spacing);
    const last = out[out.length - 1];
    if (!last || last.x !== end[0] || last.y !== end[1]) {
      out.push(new Vec2(end[0], end[1]));
    }
  }
  return end;
}

/**
 * Moves (x, y) down the field's slope until the field reaches `target`, and
 * returns where it stops.
 *
 * In a true distance field the slope lines are straight, so one straight
 * move usually lands exactly on the target. Where a line meets the ridge
 * down the middle of the shape (at a corner of the contours), it carries on
 * down the ridge in short steps, which keeps corners sharp. Where the ridge
 * runs flat, the shape is too thin to get deeper, and it stops there, so
 * thin leftovers get a line down their middle.
 */
function descend(
  grid: SDFGrid,
  x: number,
  y: number,
  target: number,
): [number, number] {
  let d = grid.sample(x, y);
  if (d <= target) return [x, y];
  const h = grid.cell;
  const g: [number, number] = [0, 0];

  // Straight down: exact wherever the slope line doesn't meet a ridge.
  grid.gradient(x, y, g);
  let len = Math.hypot(g[0], g[1]);
  if (!(len > 1e-9)) return [x, y];
  const jump = d - target;
  if (grid.sample(x - (g[0] / len) * jump, y - (g[1] / len) * jump) <= target) {
    return bisect(grid, x, y, -g[0] / len, -g[1] / len, jump, target);
  }

  // Otherwise step, steering by the local slope. On a ridge the slope
  // estimate straddles it and points off to one side, so when a step makes
  // poor progress, look round the point for the steepest way down instead,
  // which runs along the ridge. Interpolation leaves small terraces along a
  // ridge that runs across the grid, so a failed look is repeated further
  // out before giving up. Stop when no direction goes down by at least a
  // twentieth of the step: the ridge has run flat.
  const limit = 4 * (d - target) + h;
  let travelled = 0;
  stepping: while (travelled < limit) {
    let step = Math.min(h / 2, limit - travelled);
    let ux = 0;
    let uy = 0;
    let nd = Infinity;
    grid.gradient(x, y, g);
    len = Math.hypot(g[0], g[1]);
    if (len > 1e-9) {
      ux = -g[0] / len;
      uy = -g[1] / len;
      nd = grid.sample(x + ux * step, y + uy * step);
    }
    for (let reach = 0; !(nd < d - 0.5 * step); reach++) {
      if (reach > 0) {
        if (reach > 2 || travelled + step * 2 > limit) break;
        step *= 2;
        nd = Infinity;
      }
      for (let a = 0; a < PROBES; a++) {
        const cx = PROBE_COS[a];
        const cy = PROBE_SIN[a];
        const value = grid.sample(x + cx * step, y + cy * step);
        if (value < nd) {
          nd = value;
          ux = cx;
          uy = cy;
        }
      }
      if (nd < d - 0.05 * step) break;
    }
    if (nd <= target) return bisect(grid, x, y, ux, uy, step, target);
    if (!(nd < d - 0.05 * step)) break stepping;
    x += ux * step;
    y += uy * step;
    d = nd;
    travelled += step;
  }
  return [x, y];
}

/** Directions `descend` tries when the slope estimate fails it. */
const PROBES = 32;
const PROBE_COS = Float64Array.from({ length: PROBES }, (_, a) =>
  Math.cos((a / PROBES) * Math.PI * 2),
);
const PROBE_SIN = Float64Array.from({ length: PROBES }, (_, a) =>
  Math.sin((a / PROBES) * Math.PI * 2),
);

/**
 * The point along (x, y) + s·(ux, uy), 0 < s ≤ length, where the field falls
 * to `target`. The field must be above it at s = 0 and not above at `length`.
 */
function bisect(
  grid: SDFGrid,
  x: number,
  y: number,
  ux: number,
  uy: number,
  length: number,
  target: number,
): [number, number] {
  let lo = 0;
  let hi = length;
  for (let i = 0; i < 40 && hi - lo > 1e-6; i++) {
    const mid = (lo + hi) / 2;
    if (grid.sample(x + ux * mid, y + uy * mid) > target) lo = mid;
    else hi = mid;
  }
  return [x + ux * hi, y + uy * hi];
}
