import { Vec2 } from "wtc-math";
import { Polyline } from "../geometry/Polyline.js";

/** Options for {@link spiral}. */
export interface SpiralOptions {
  /**
   * Distance between turns, in mm. Exact on every edge when the outline has
   * an inscribed circle; otherwise the average over the shape.
   */
  spacing: number;
  /**
   * The point the turns shrink towards. Default: the point deepest inside
   * every edge, which is the centre of the inscribed circle when there is one.
   */
  center?: Vec2;
  /** Gap between the outline and the outermost turn, as a fraction of spacing. Default 0.5. */
  offset?: number;
  /** Index of the outline vertex the spiral starts from. Default 0. */
  start?: number;
  /** Draw separate concentric rings instead of one continuous spiral. Default false. */
  rings?: boolean;
  /** Rings, or a whole spiral, shorter than this (mm) are dropped. Default 0.2. */
  minLength?: number;
}

/**
 * Fills a closed shape with a spiral that follows its outline. Each turn is
 * the outline shrunk one more step towards `center`, so turns keep the
 * shape's corners and run parallel to its edges. The result is one
 * continuous stroke that ends at the centre, or with `rings`, one closed ring
 * per turn.
 *
 * Spacing is exact on every edge when the outline has an inscribed circle and
 * `center` is its centre, which the default finds. That covers every regular
 * polygon, triangle, rhombus and kite, and circles (an even, Archimedean
 * spiral). On other shapes each edge's spacing scales with its distance from
 * the centre, averaging `spacing`. Long thin shapes come out tight along
 * their sides and loose at their ends.
 *
 * The outline must be star-shaped: some point inside must see all of it.
 * Throws for shapes like a U, where the shrunk copies would cross its edges.
 *
 * A spiral's first turn can't stay parallel to the outline. Its gap grows
 * from `offset` to `offset + 1` spacings, then steps back where the spiral
 * began, so start at a corner (`start`) to hide the step.
 */
export function spiral(shape: Polyline, options: SpiralOptions): Polyline[] {
  const { spacing } = options;
  if (!(spacing > 0) || !Number.isFinite(spacing)) {
    throw new RangeError("spiral: spacing must be a positive number");
  }
  const offset = options.offset ?? 0.5;
  const minLength = options.minLength ?? 0.2;

  const { xs, ys } = outlineOf(shape, options.start ?? 0);
  const n = xs.length;
  const lines = edgeLines(xs, ys);
  const size = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  const eps = 1e-9 * size;

  let cx: number;
  let cy: number;
  if (options.center) {
    cx = options.center.x;
    cy = options.center.y;
    if (minDepth(lines, cx, cy) <= eps) {
      throw new RangeError(
        "spiral: every edge of the outline must face `center` from inside",
      );
    }
  } else {
    const deepest = deepestPoint(lines, xs, ys);
    if (!deepest) {
      throw new RangeError(
        "spiral: the outline isn't star-shaped (no point inside sees all of it)",
      );
    }
    [cx, cy] = deepest;
  }

  // Shrinking the outline by `delta` moves edge e in by depth_e × delta. Pick
  // delta so the length-weighted average of those steps is `spacing`. That
  // gives the right overall ink coverage, and is exact when every edge sits
  // at the same depth (an inscribed circle).
  let perimeter = 0;
  let weighted = 0;
  const along = new Float64Array(n);
  for (let e = 0; e < n; e++) {
    along[e] = perimeter;
    const len = lines[4 * e + 3];
    perimeter += len;
    weighted += len * depthAt(lines, e, cx, cy);
  }
  const delta = spacing / (weighted / perimeter);
  const t0 = 1 - offset * delta;
  if (!(t0 > 0)) return [];

  const dx = xs.map((x) => x - cx);
  const dy = ys.map((y) => y - cy);
  const at = (t: number, i: number) => new Vec2(cx + t * dx[i], cy + t * dy[i]);

  if (options.rings) {
    const out: Polyline[] = [];
    for (let m = 0; ; m++) {
      const t = t0 - m * delta;
      if (t <= 0 || t * perimeter < minLength) break;
      out.push(new Polyline(xs.map((_, i) => at(t, i)), true));
    }
    return out;
  }

  // Scale falls steadily with distance along the outline, one `delta` per
  // turn. Points at the vertices are enough: between them each turn is a
  // straight chord, and consecutive turns stay `spacing` apart along it.
  const points: Vec2[] = [];
  for (let m = 0; ; m++) {
    let done = false;
    for (let i = 0; i < n; i++) {
      const t = t0 - (m + along[i] / perimeter) * delta;
      if (t <= 0) {
        points.push(new Vec2(cx, cy));
        done = true;
        break;
      }
      points.push(at(t, i));
    }
    if (done) break;
  }
  const path = new Polyline(points);
  return path.length < minLength ? [] : [path];
}

/**
 * The point deepest inside the lines of every edge of a closed outline, and
 * that depth: the centre of the largest circle that fits inside all of them.
 * For a convex outline that is the largest circle in the shape, and for one
 * with an inscribed circle it is that circle. Null when no point is inside
 * every edge's line, meaning the outline isn't star-shaped.
 */
export function deepestPoint(
  lines: Float64Array,
  xs: readonly number[],
  ys: readonly number[],
): [number, number] | null {
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const eps = 1e-9 * Math.max(maxX - minX, maxY - minY);
  const pad = maxX - minX + maxY - minY;
  const box = [
    minX - pad,
    minY - pad,
    maxX + pad,
    minY - pad,
    maxX + pad,
    maxY + pad,
    minX - pad,
    maxY + pad,
  ];

  let best = insetRegion(lines, box, eps);
  if (!best) return null;
  // No point is deeper than half the shape's narrower side.
  let lo = eps;
  let hi = 0.5 * Math.min(maxX - minX, maxY - minY) + eps;
  for (let i = 0; i < 100 && hi - lo > eps; i++) {
    const mid = (lo + hi) / 2;
    const region = insetRegion(lines, box, mid);
    if (region) {
      best = region;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // Near the best depth the region shrinks to a point, or to a segment when
  // the circle can slide (as in a rectangle). Its middle is the answer.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < best.length; i += 2) {
    x0 = Math.min(x0, best[i]);
    x1 = Math.max(x1, best[i]);
    y0 = Math.min(y0, best[i + 1]);
    y1 = Math.max(y1, best[i + 1]);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/**
 * The points at least `depth` inside every edge line, as a convex polygon
 * (flat xy), or null if there are none. Clips `box` by each line in turn.
 */
function insetRegion(
  lines: Float64Array,
  box: readonly number[],
  depth: number,
): number[] | null {
  let poly = box.slice();
  for (let e = 0; e < lines.length / 4; e++) {
    const nx = lines[4 * e];
    const ny = lines[4 * e + 1];
    const k = lines[4 * e + 2] + depth;
    const next: number[] = [];
    const count = poly.length / 2;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const px = poly[2 * i];
      const py = poly[2 * i + 1];
      const qx = poly[2 * j];
      const qy = poly[2 * j + 1];
      const dp = nx * px + ny * py - k;
      const dq = nx * qx + ny * qy - k;
      if (dp >= 0) next.push(px, py);
      if (dp >= 0 !== dq >= 0) {
        const s = dp / (dp - dq);
        next.push(px + (qx - px) * s, py + (qy - py) * s);
      }
    }
    if (next.length === 0) return null;
    poly = next;
  }
  return poly;
}

/**
 * The outline's distinct points as coordinate lists, starting at vertex
 * `start`. Repeated points (including a repeated first point) are dropped.
 */
function outlineOf(
  shape: Polyline,
  start: number,
): { xs: number[]; ys: number[] } {
  const pts = shape.points;
  const count = pts.length;
  if (!shape.closed || count < 3) {
    throw new RangeError("spiral: shape must be a closed path");
  }
  const s = ((Math.round(start) % count) + count) % count;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let j = 0; j < count; j++) {
    const p = pts[(s + j) % count];
    const last = xs.length - 1;
    if (last >= 0 && p.x === xs[last] && p.y === ys[last]) continue;
    xs.push(p.x);
    ys.push(p.y);
  }
  while (
    xs.length > 1 &&
    xs[xs.length - 1] === xs[0] &&
    ys[ys.length - 1] === ys[0]
  ) {
    xs.pop();
    ys.pop();
  }
  if (xs.length < 3) {
    throw new RangeError("spiral: shape needs at least 3 distinct points");
  }
  return { xs, ys };
}

/**
 * For each edge (vertex e to e + 1): its unit normal pointing inside,
 * `n · a` for its start point `a`, and its length, as [nx, ny, k, length].
 * The depth of a point p inside the edge's line is `n · p − k`.
 */
export function edgeLines(
  xs: readonly number[],
  ys: readonly number[],
): Float64Array {
  const n = xs.length;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += xs[i] * ys[j] - xs[j] * ys[i];
  }
  if (area2 === 0) throw new RangeError("spiral: shape has no area");
  // With positive shoelace area the inside is to the left of (dx, dy).
  const side = area2 > 0 ? 1 : -1;
  const lines = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = xs[j] - xs[i];
    const ey = ys[j] - ys[i];
    const len = Math.hypot(ex, ey);
    const nx = (-ey / len) * side;
    const ny = (ex / len) * side;
    lines[4 * i] = nx;
    lines[4 * i + 1] = ny;
    lines[4 * i + 2] = nx * xs[i] + ny * ys[i];
    lines[4 * i + 3] = len;
  }
  return lines;
}

function depthAt(lines: Float64Array, e: number, x: number, y: number): number {
  return lines[4 * e] * x + lines[4 * e + 1] * y - lines[4 * e + 2];
}

function minDepth(lines: Float64Array, x: number, y: number): number {
  let least = Infinity;
  for (let e = 0; e < lines.length / 4; e++) {
    least = Math.min(least, depthAt(lines, e, x, y));
  }
  return least;
}
