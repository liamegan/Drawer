import { Vec2 } from "wtc-math";
import type { Bounds } from "./Bounds.js";
import { asList, Polyline } from "./Polyline.js";
import type { FillRule } from "./scanline.js";

/** Answers "is the point (x, y), in mm, hidden?" for `clipPolyline`. */
export type HiddenTest = (x: number, y: number) => boolean;

export interface ClipOptions {
  /**
   * Largest distance between samples along each segment, in mm. Hidden or
   * visible stretches shorter than this can be missed. Default 0.05.
   */
  step?: number;
  /**
   * Pieces created by clipping that are shorter than this (mm) are dropped,
   * so the plotter isn't asked to draw dots. Paths that come through
   * untouched are always kept. Default 0.2.
   */
  minLength?: number;
  /**
   * Return only the visible run from the start of the path up to the first
   * hidden point (nothing if the start itself is hidden). For growth and
   * streamlines that should stop when they hit something.
   */
  stopOnCollide?: boolean;
}

export interface ShapeClipOptions {
  /** How the shapes' rings combine. Default "nonzero", as in SVG. */
  rule?: FillRule;
  /** Clipped pieces shorter than this (mm) are dropped. Default 0.2. */
  minLength?: number;
}

/** Cut points are refined until they are this close (mm) along the segment. */
const CUT_TOLERANCE = 1e-5;
const MAX_BISECTIONS = 40;

/**
 * Splits `path` into its visible pieces according to `isHidden`.
 *
 * The path is walked as one continuous stroke, sampling every `step` mm.
 * Wherever visibility flips between two samples, the exact cut point is
 * found by bisection, on the visible side. Vertices inside a visible stretch
 * are kept, so a visible run comes back as one polyline even when it turns
 * corners.
 *
 * A path that is never hidden comes back as itself (closed paths stay
 * closed). For a closed path whose start is visible, the run that wraps
 * around through the start point is returned as a single piece.
 */
export function clipPolyline(
  path: Polyline,
  isHidden: HiddenTest,
  options: ClipOptions = {},
): Polyline[] {
  const step = options.step ?? 0.05;
  if (!(step > 0)) throw new RangeError("clipPolyline: step must be positive");
  const minLength = options.minLength ?? 0.2;
  const stopOnCollide = options.stopOnCollide ?? false;

  const pts = path.points;
  const n = pts.length;
  if (n < 2) return [];
  const segments = path.closed ? n : n - 1;

  const runs = new Runs();
  let hiddenPrev = isHidden(pts[0].x, pts[0].y);
  const startVisible = !hiddenPrev;
  let everHidden = hiddenPrev;
  if (hiddenPrev) {
    if (stopOnCollide) return [];
  } else {
    runs.start(pts[0].x, pts[0].y);
  }

  for (let s = 0; s < segments; s++) {
    const a = pts[s];
    const b = pts[(s + 1) % n];
    const ax = a.x;
    const ay = a.y;
    const dx = b.x - ax;
    const dy = b.y - ay;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;

    const samples = Math.max(1, Math.ceil(len / step));
    let tPrev = 0;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const hidden =
        i === samples
          ? isHidden(b.x, b.y)
          : isHidden(ax + dx * t, ay + dy * t);
      if (hidden !== hiddenPrev) {
        // Bisect for the cut point between the last two samples.
        let lo = tPrev;
        let hi = t;
        for (
          let k = 0;
          k < MAX_BISECTIONS && (hi - lo) * len > CUT_TOLERANCE;
          k++
        ) {
          const mid = (lo + hi) / 2;
          if (isHidden(ax + dx * mid, ay + dy * mid) === hiddenPrev) lo = mid;
          else hi = mid;
        }
        // Cut on the visible side, so a cut point is never itself hidden.
        const tc = hiddenPrev ? hi : lo;
        const cx = ax + dx * tc;
        const cy = ay + dy * tc;
        if (hiddenPrev) {
          runs.start(cx, cy);
        } else {
          runs.add(cx, cy);
          runs.close();
          everHidden = true;
          if (stopOnCollide) return toPolylines(runs.list, minLength);
        }
        hiddenPrev = hidden;
      }
      tPrev = t;
    }
    runs.add(b.x, b.y);
  }

  if (!everHidden) return [path];
  return toPolylines(runs.finish(path.closed, startVisible), minLength);
}

/** A HiddenTest that hides everything outside `bounds`. */
export function outsideBounds(bounds: Bounds): HiddenTest {
  const minX = bounds.min.x;
  const minY = bounds.min.y;
  const maxX = bounds.max.x;
  const maxY = bounds.max.y;
  return (x, y) => x < minX || x > maxX || y < minY || y > maxY;
}

/**
 * A fast inside test for the closed paths in `shapes` (open paths are
 * ignored), with the rings combined by `rule`. Points exactly on an edge
 * may go either way.
 */
export function insideTest(
  shapes: Polyline | readonly Polyline[],
  rule: FillRule = "nonzero",
): HiddenTest {
  const edges = shapeEdges(shapes);
  return rule === "evenodd"
    ? (x, y) => windingAt(edges, x, y) % 2 !== 0
    : (x, y) => windingAt(edges, x, y) !== 0;
}

/** True when (x, y) is inside the closed paths in `shapes`. See `insideTest`. */
export function shapeContains(
  shapes: Polyline | readonly Polyline[],
  x: number,
  y: number,
  rule: FillRule = "nonzero",
): boolean {
  return insideTest(shapes, rule)(x, y);
}

/**
 * The parts of `path` that are inside the closed paths in `shapes`, cut
 * exactly where it crosses their edges. Vertices are kept, and for a closed
 * path the run that wraps through its start comes back as one piece. A path
 * entirely inside comes back as itself.
 */
export function clipToShape(
  path: Polyline,
  shapes: Polyline | readonly Polyline[],
  options: ShapeClipOptions = {},
): Polyline[] {
  return clipToEdges(path, shapeEdges(shapes), options);
}

/**
 * `clipToShape` against edges from `shapeEdges`, for clipping many paths
 * against the same shapes without rebuilding the edge list each time.
 */
export function clipToEdges(
  path: Polyline,
  edges: Float64Array,
  options: ShapeClipOptions = {},
): Polyline[] {
  const inside =
    options.rule === "evenodd"
      ? (x: number, y: number) => windingAt(edges, x, y) % 2 !== 0
      : (x: number, y: number) => windingAt(edges, x, y) !== 0;
  return clipWhere(path, edges, inside, options);
}

/**
 * Cuts `path` exactly where it crosses `edges` (from `shapeEdges`) and keeps
 * the pieces whose midpoint passes `keep`. For any test that can only
 * change across those edges, such as being inside them (`clipToEdges`) or
 * being in front of the faces they outline (hidden lines in `renderMesh`).
 *
 * Vertices are kept, cuts between two kept pieces add no points, and for a
 * closed path the run that wraps through its start comes back as one piece.
 * A path that is kept everywhere comes back as itself.
 */
export function clipWhere(
  path: Polyline,
  edges: Float64Array,
  keep: (x: number, y: number) => boolean,
  options: { minLength?: number } = {},
): Polyline[] {
  const minLength = options.minLength ?? 0.2;
  const pts = path.points;
  const n = pts.length;
  if (n < 2) return [];
  const segments = path.closed ? n : n - 1;

  const runs = new Runs();
  let first = true;
  let startVisible = false;
  let everOutside = false;
  const cuts: number[] = [];

  for (let s = 0; s < segments; s++) {
    const a = pts[s];
    const b = pts[(s + 1) % n];
    const ax = a.x;
    const ay = a.y;
    const dx = b.x - ax;
    const dy = b.y - ay;
    if (dx === 0 && dy === 0) continue;

    cuts.length = 0;
    cuts.push(0, 1);
    segmentCrossings(edges, ax, ay, b.x, b.y, cuts);
    cuts.sort((p, q) => p - q);

    // Where the kept stretch in this segment ends, once it does.
    let end = -1;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const t0 = cuts[i];
      const t1 = cuts[i + 1];
      if (t1 - t0 <= 1e-12) continue;
      const tm = (t0 + t1) / 2;
      const isIn = keep(ax + dx * tm, ay + dy * tm);
      if (first) {
        startVisible = isIn;
        first = false;
      }
      if (isIn) {
        if (!runs.current) runs.start(ax + dx * t0, ay + dy * t0);
        end = t1;
      } else {
        if (end >= 0) runs.add(ax + dx * end, ay + dy * end);
        end = -1;
        everOutside = true;
        runs.close();
      }
    }
    if (end >= 0) runs.add(ax + dx * end, ay + dy * end);
  }

  if (first) return [];
  if (!everOutside) return [path];
  return toPolylines(runs.finish(path.closed, startVisible), minLength);
}

/** Edges of the closed rings in `shapes`, as flat [ax, ay, bx, by, ...]. */
export function shapeEdges(
  shapes: Polyline | readonly Polyline[],
): Float64Array {
  const out: number[] = [];
  for (const shape of asList(shapes)) {
    if (!shape.closed || shape.pointCount < 3) continue;
    const pts = shape.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push(a.x, a.y, b.x, b.y);
    }
  }
  return Float64Array.from(out);
}

/** Winding number of the edges around (x, y). */
export function windingAt(edges: Float64Array, x: number, y: number): number {
  let w = 0;
  for (let i = 0; i < edges.length; i += 4) {
    const ax = edges[i];
    const ay = edges[i + 1];
    const bx = edges[i + 2];
    const by = edges[i + 3];
    if (ay <= y) {
      if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
    } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) {
      w--;
    }
  }
  return w;
}

/**
 * Appends to `out` the parameters t in [0, 1] along the segment p→q where it
 * crosses one of the edges. Edges parallel to the segment are skipped.
 */
export function segmentCrossings(
  edges: Float64Array,
  px: number,
  py: number,
  qx: number,
  qy: number,
  out: number[],
): void {
  const rx = qx - px;
  const ry = qy - py;
  for (let i = 0; i < edges.length; i += 4) {
    const ax = edges[i];
    const ay = edges[i + 1];
    const ex = edges[i + 2] - ax;
    const ey = edges[i + 3] - ay;
    const denom = rx * ey - ry * ex;
    if (denom === 0) continue;
    const wx = ax - px;
    const wy = ay - py;
    const t = (wx * ey - wy * ex) / denom;
    const u = (wx * ry - wy * rx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(t);
  }
}

/**
 * Collects visible runs as flat [x0, y0, x1, y1, ...] arrays while a path is
 * walked, skipping repeated points.
 */
class Runs {
  readonly list: number[][] = [];
  current: number[] | null = null;

  start(x: number, y: number): void {
    this.current = [x, y];
  }

  add(x: number, y: number): void {
    const run = this.current;
    if (!run) return;
    if (run[run.length - 2] === x && run[run.length - 1] === y) return;
    run.push(x, y);
  }

  close(): void {
    if (this.current) this.list.push(this.current);
    this.current = null;
  }

  /**
   * Ends the walk. For a closed path visible at its start, the last run
   * carries on into the first, so the two are joined instead of lifting the
   * pen there.
   */
  finish(closed: boolean, startVisible: boolean): number[][] {
    const endVisible = this.current !== null;
    this.close();
    const list = this.list;
    if (closed && startVisible && endVisible && list.length >= 2) {
      const first = list.shift()!;
      const last = list.pop()!;
      list.push(last.concat(first.slice(2)));
    }
    return list;
  }
}

function toPolylines(runs: number[][], minLength: number): Polyline[] {
  const out: Polyline[] = [];
  for (const run of runs) {
    if (run.length < 4 || flatLength(run) < minLength) continue;
    const points: Vec2[] = [];
    for (let i = 0; i < run.length; i += 2) {
      points.push(new Vec2(run[i], run[i + 1]));
    }
    out.push(new Polyline(points));
  }
  return out;
}

function flatLength(run: number[]): number {
  let total = 0;
  for (let i = 2; i < run.length; i += 2) {
    total += Math.hypot(run[i] - run[i - 2], run[i + 1] - run[i - 1]);
  }
  return total;
}
