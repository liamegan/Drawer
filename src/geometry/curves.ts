import { Vec2 } from "wtc-math";
import { Polyline } from "./Polyline.js";
import { circleSegments } from "./shapes.js";
import { segmentDistance } from "./simplify.js";

export interface CurveOptions {
  /**
   * Largest allowed gap (mm) between the curve and its straight segments.
   * Default 0.02 mm, as for `circle`.
   */
  tolerance?: number;
}

export interface CatmullRomOptions extends CurveOptions {
  /** Join the last point back to the first. Default false. */
  closed?: boolean;
  /**
   * Knot spacing: 0 is uniform, 0.5 centripetal and 1 chordal. Centripetal,
   * the default, never forms cusps or loops within a segment.
   */
  alpha?: number;
}

const DEFAULT_TOLERANCE = 0.02;
const MAX_DEPTH = 16;

/** A quadratic Bézier from `p0` to `p2`, pulled towards `p1`. */
export function quadratic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  options: CurveOptions = {},
): Polyline {
  // Raised to a cubic exactly: the control points sit 2/3 of the way to p1.
  const c1x = p0.x + (2 / 3) * (p1.x - p0.x);
  const c1y = p0.y + (2 / 3) * (p1.y - p0.y);
  const c2x = p2.x + (2 / 3) * (p1.x - p2.x);
  const c2y = p2.y + (2 / 3) * (p1.y - p2.y);
  const out = [p0.x, p0.y];
  flatten(
    p0.x,
    p0.y,
    c1x,
    c1y,
    c2x,
    c2y,
    p2.x,
    p2.y,
    tolerance(options),
    out,
  );
  return toPolyline(out, false);
}

/** A cubic Bézier from `p0` to `p3`, with control points `p1` and `p2`. */
export function cubic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  options: CurveOptions = {},
): Polyline {
  const out = [p0.x, p0.y];
  flatten(
    p0.x,
    p0.y,
    p1.x,
    p1.y,
    p2.x,
    p2.y,
    p3.x,
    p3.y,
    tolerance(options),
    out,
  );
  return toPolyline(out, false);
}

/**
 * A smooth curve through every point in `points` (a Catmull-Rom spline).
 * Each span becomes a cubic Bézier. An open curve's ends are shaped as if
 * the path carried on straight past them. Repeated points are dropped, and
 * fewer than two distinct points give an empty polyline.
 */
export function catmullRom(
  points: readonly Vec2[],
  options: CatmullRomOptions = {},
): Polyline {
  const closed = options.closed ?? false;
  const alpha = options.alpha ?? 0.5;
  if (!(alpha >= 0 && alpha <= 1)) {
    throw new RangeError("catmullRom: alpha must be between 0 and 1");
  }
  const tol = tolerance(options);

  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    const k = xs.length - 1;
    if (k >= 0 && xs[k] === p.x && ys[k] === p.y) continue;
    xs.push(p.x);
    ys.push(p.y);
  }
  if (closed && xs.length > 1) {
    const k = xs.length - 1;
    if (xs[k] === xs[0] && ys[k] === ys[0]) {
      xs.pop();
      ys.pop();
    }
  }
  const n = xs.length;
  if (n < 2) return new Polyline([], closed);
  if (closed && n < 3) {
    return new Polyline([new Vec2(xs[0], ys[0]), new Vec2(xs[1], ys[1])]);
  }

  // Point i, wrapping when closed and reflected past the ends when open.
  const px = (i: number): number => {
    if (closed) return xs[(i + n) % n];
    if (i < 0) return 2 * xs[0] - xs[1];
    if (i >= n) return 2 * xs[n - 1] - xs[n - 2];
    return xs[i];
  };
  const py = (i: number): number => {
    if (closed) return ys[(i + n) % n];
    if (i < 0) return 2 * ys[0] - ys[1];
    if (i >= n) return 2 * ys[n - 1] - ys[n - 2];
    return ys[i];
  };

  const spans = closed ? n : n - 1;
  const out = [xs[0], ys[0]];
  for (let i = 0; i < spans; i++) {
    const x0 = px(i - 1);
    const y0 = py(i - 1);
    const x1 = px(i);
    const y1 = py(i);
    const x2 = px(i + 1);
    const y2 = py(i + 1);
    const x3 = px(i + 2);
    const y3 = py(i + 2);
    // Knot intervals (Yuksel, Schaefer and Keyser, 2011).
    const d1 = Math.hypot(x1 - x0, y1 - y0) ** alpha;
    const d2 = Math.hypot(x2 - x1, y2 - y1) ** alpha;
    const d3 = Math.hypot(x3 - x2, y3 - y2) ** alpha;

    let b1x = x1;
    let b1y = y1;
    if (d1 > 0) {
      const a = 2 * d1 * d1 + 3 * d1 * d2 + d2 * d2;
      const k = 3 * d1 * (d1 + d2);
      b1x = (d1 * d1 * x2 - d2 * d2 * x0 + a * x1) / k;
      b1y = (d1 * d1 * y2 - d2 * d2 * y0 + a * y1) / k;
    }
    let b2x = x2;
    let b2y = y2;
    if (d3 > 0) {
      const a = 2 * d3 * d3 + 3 * d3 * d2 + d2 * d2;
      const k = 3 * d3 * (d3 + d2);
      b2x = (d3 * d3 * x1 - d2 * d2 * x3 + a * x2) / k;
      b2y = (d3 * d3 * y1 - d2 * d2 * y3 + a * y2) / k;
    }
    flatten(x1, y1, b1x, b1y, b2x, b2y, x2, y2, tol, out);
  }
  if (closed) out.length -= 2; // the last point repeats the first
  return toPolyline(out, closed);
}

/**
 * An arc of the circle around `center`, from `startAngle` to `endAngle`
 * (radians; 0 points right, and positive turns clockwise on screen, as for
 * `polygon`). It runs clockwise when `endAngle > startAngle`. A full turn or
 * more comes back open, starting and ending at the same point.
 */
export function arc(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
  options: CurveOptions = {},
): Polyline {
  if (!(radius >= 0)) throw new RangeError("arc: radius must not be negative");
  const sweep = endAngle - startAngle;
  const full = circleSegments(radius, tolerance(options));
  const n = Math.max(1, Math.ceil((full * Math.abs(sweep)) / (2 * Math.PI)));
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = startAngle + (sweep * i) / n;
    pts.push(
      new Vec2(
        center.x + Math.cos(a) * radius,
        center.y + Math.sin(a) * radius,
      ),
    );
  }
  return new Polyline(pts);
}

function tolerance(options: CurveOptions): number {
  const t = options.tolerance ?? DEFAULT_TOLERANCE;
  if (!(t > 0)) throw new RangeError("curve tolerance must be positive");
  return t;
}

/**
 * Appends the cubic's points after its start (which the caller has added),
 * halving it until the control points are within `tol` of the chord. The
 * curve lies inside the control points' hull, and distance to the chord is
 * convex, so the whole span is then within `tol` of it.
 */
function flatten(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  tol: number,
  out: number[],
  depth = 0,
): void {
  if (
    depth >= MAX_DEPTH ||
    (segmentDistance(x1, y1, x0, y0, x3, y3) <= tol &&
      segmentDistance(x2, y2, x0, y0, x3, y3) <= tol)
  ) {
    out.push(x3, y3);
    return;
  }
  // de Casteljau at t = 1/2.
  const ax = (x0 + x1) / 2;
  const ay = (y0 + y1) / 2;
  const bx = (x1 + x2) / 2;
  const by = (y1 + y2) / 2;
  const cx = (x2 + x3) / 2;
  const cy = (y2 + y3) / 2;
  const abx = (ax + bx) / 2;
  const aby = (ay + by) / 2;
  const bcx = (bx + cx) / 2;
  const bcy = (by + cy) / 2;
  const mx = (abx + bcx) / 2;
  const my = (aby + bcy) / 2;
  flatten(x0, y0, ax, ay, abx, aby, mx, my, tol, out, depth + 1);
  flatten(mx, my, bcx, bcy, cx, cy, x3, y3, tol, out, depth + 1);
}

function toPolyline(flat: readonly number[], closed: boolean): Polyline {
  const pts: Vec2[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    pts.push(new Vec2(flat[i], flat[i + 1]));
  }
  return new Polyline(pts, closed);
}
