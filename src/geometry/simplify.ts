import { Vec2 } from "wtc-math";
import { Polyline } from "./Polyline.js";

/**
 * Drops points that lie within `tolerance` mm of the simplified path
 * (Ramer–Douglas–Peucker). Every original point stays within `tolerance` of
 * the result, and the result keeps the path's first and last points.
 *
 * Closed paths are split at vertex 0 and the vertex farthest from it, and the
 * two halves are simplified separately. A ring so thin that it would collapse
 * to fewer than three points comes back unchanged.
 */
export function simplify(path: Polyline, tolerance: number): Polyline {
  if (!(tolerance >= 0)) {
    throw new RangeError("simplify: tolerance must not be negative");
  }
  const n = path.pointCount;
  if (n < 3 || tolerance === 0) return path;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  path.points.forEach((p, i) => {
    xs[i] = p.x;
    ys[i] = p.y;
  });

  const keep = new Uint8Array(n);
  if (!path.closed) {
    keep[0] = keep[n - 1] = 1;
    rdp(xs, ys, 0, n - 1, tolerance, keep);
  } else {
    let far = 0;
    let best = -1;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(xs[i] - xs[0], ys[i] - ys[0]);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    keep[0] = keep[far] = 1;
    rdp(xs, ys, 0, far, tolerance, keep);
    // The second half runs from `far` back round to vertex 0, which sits at
    // index n in a copy with the first point appended.
    const wx = new Float64Array(n + 1);
    const wy = new Float64Array(n + 1);
    wx.set(xs);
    wy.set(ys);
    wx[n] = xs[0];
    wy[n] = ys[0];
    const wrapKeep = new Uint8Array(n + 1);
    rdp(wx, wy, far, n, tolerance, wrapKeep);
    for (let i = far + 1; i < n; i++) if (wrapKeep[i]) keep[i] = 1;
  }

  const points: Vec2[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) points.push(path.points[i]);
  if (points.length === n) return path;
  if (path.closed && points.length < 3) return path;
  return new Polyline(points, path.closed);
}

/** Marks in `keep` the points between `a` and `b` that RDP keeps. */
function rdp(
  xs: Float64Array,
  ys: Float64Array,
  a: number,
  b: number,
  tolerance: number,
  keep: Uint8Array,
): void {
  const stack = [a, b];
  while (stack.length > 0) {
    const j = stack.pop()!;
    const i = stack.pop()!;
    if (j - i < 2) continue;
    let far = -1;
    let best = tolerance;
    for (let k = i + 1; k < j; k++) {
      const d = segmentDistance(xs[k], ys[k], xs[i], ys[i], xs[j], ys[j]);
      if (d > best) {
        best = d;
        far = k;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push(i, far, far, j);
  }
}

/** Distance from (px, py) to the segment a → b. */
export function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
}

/**
 * Rounds off corners by Chaikin's corner cutting: each pass replaces every
 * segment with points a quarter and three quarters along it, doubling the
 * point count. The curve shrinks slightly into its corners. Open paths keep
 * their end points.
 */
export function smooth(path: Polyline, iterations = 1): Polyline {
  const passes = Math.max(0, Math.floor(iterations));
  if (passes === 0 || path.pointCount < 3) return path;
  let xs = path.points.map((p) => p.x);
  let ys = path.points.map((p) => p.y);
  for (let pass = 0; pass < passes; pass++) {
    const n = xs.length;
    const nx: number[] = [];
    const ny: number[] = [];
    const segments = path.closed ? n : n - 1;
    if (!path.closed) {
      nx.push(xs[0]);
      ny.push(ys[0]);
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % n;
      const first = !path.closed && i === 0;
      const last = !path.closed && i === segments - 1;
      if (!first) {
        nx.push(0.75 * xs[i] + 0.25 * xs[j]);
        ny.push(0.75 * ys[i] + 0.25 * ys[j]);
      }
      if (!last) {
        nx.push(0.25 * xs[i] + 0.75 * xs[j]);
        ny.push(0.25 * ys[i] + 0.75 * ys[j]);
      }
    }
    if (!path.closed) {
      nx.push(xs[n - 1]);
      ny.push(ys[n - 1]);
    }
    xs = nx;
    ys = ny;
  }
  return new Polyline(
    xs.map((x, i) => new Vec2(x, ys[i])),
    path.closed,
  );
}
