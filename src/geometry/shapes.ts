import { Vec2 } from "wtc-math";
import { Bounds } from "./Bounds.js";
import { Polyline } from "./Polyline.js";

/** An open, two-point Polyline. */
export function line(a: Vec2, b: Vec2): Polyline {
  return new Polyline([a, b]);
}

/** A closed rectangle, clockwise on screen from the top-left corner. */
export function rect(bounds: Bounds): Polyline;
export function rect(x: number, y: number, width: number, height: number): Polyline;
export function rect(a: Bounds | number, y = 0, width = 0, height = 0): Polyline {
  const b = a instanceof Bounds ? a : Bounds.fromRect(a, y, width, height);
  return new Polyline(
    [
      new Vec2(b.min.x, b.min.y),
      new Vec2(b.max.x, b.min.y),
      new Vec2(b.max.x, b.max.y),
      new Vec2(b.min.x, b.max.y),
    ],
    true,
  );
}

/**
 * A closed regular polygon. The first vertex sits at `startAngle` radians
 * (0 = pointing right; positive turns clockwise on screen).
 */
export function polygon(center: Vec2, radius: number, sides: number, startAngle = 0): Polyline {
  if (sides < 3) throw new RangeError("polygon needs at least 3 sides");
  const pts: Vec2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (i / sides) * Math.PI * 2;
    pts.push(new Vec2(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius));
  }
  return new Polyline(pts, true);
}

export interface CircleOptions {
  /**
   * Largest allowed gap (mm) between the true circle and its straight
   * segments. Ignored when `segments` is given. Default 0.02 mm, well under
   * a fine pen's width.
   */
  tolerance?: number;
  /** Exact segment count, overriding `tolerance`. */
  segments?: number;
}

/** Number of segments that keeps a circle of `radius` within `tolerance`. */
export function circleSegments(radius: number, tolerance = 0.02): number {
  const MIN = 8;
  if (radius <= tolerance) return MIN;
  // The sagitta of a chord spanning 2π/n is r(1 − cos(π/n)); solve for n.
  const n = Math.ceil(Math.PI / Math.acos(1 - tolerance / radius));
  return Math.max(MIN, n);
}

/** A closed circle approximated by straight segments. */
export function circle(center: Vec2, radius: number, options: CircleOptions = {}): Polyline {
  const sides = options.segments ?? circleSegments(radius, options.tolerance);
  return polygon(center, radius, sides);
}
