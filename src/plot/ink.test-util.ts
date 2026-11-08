import { Vec2 } from "wtc-math";
import { Polyline } from "../geometry/Polyline.js";
import { segmentDistance } from "../geometry/simplify.js";

/** Points every `step` mm along each path, closing segments included. */
export function inkSamples(paths: readonly Polyline[], step = 0.1): Vec2[] {
  const out: Vec2[] = [];
  for (const path of paths) {
    const pts = path.points;
    const count = path.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const n = Math.max(1, Math.ceil(a.distance(b) / step));
      for (let k = 0; k <= n; k++) {
        out.push(
          new Vec2(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n),
        );
      }
    }
  }
  return out;
}

/**
 * The furthest any point of `from`'s ink is from `to`'s ink, in mm (a
 * one-sided Hausdorff distance, sampled every `step`).
 */
export function inkDistance(
  from: readonly Polyline[],
  to: readonly Polyline[],
  step = 0.1,
): number {
  const cell = 1;
  const buckets = new Map<string, number[][]>();
  const key = (i: number, j: number) => `${i},${j}`;
  for (const path of to) {
    const pts = path.points;
    const count = path.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const seg = [a.x, a.y, b.x, b.y];
      for (
        let x = Math.floor(Math.min(a.x, b.x) / cell) - 1;
        x <= Math.floor(Math.max(a.x, b.x) / cell) + 1;
        x++
      ) {
        for (
          let y = Math.floor(Math.min(a.y, b.y) / cell) - 1;
          y <= Math.floor(Math.max(a.y, b.y) / cell) + 1;
          y++
        ) {
          const k = key(x, y);
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k)!.push(seg);
        }
      }
    }
  }
  let worst = 0;
  for (const p of inkSamples(from, step)) {
    let best = Infinity;
    for (const [ax, ay, bx, by] of buckets.get(
      key(Math.floor(p.x / cell), Math.floor(p.y / cell)),
    ) ?? []) {
      best = Math.min(best, segmentDistance(p.x, p.y, ax, ay, bx, by));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Total pen-down length. */
export function inkLength(paths: readonly Polyline[]): number {
  return paths.reduce((sum, p) => sum + p.length, 0);
}

export const v = (x: number, y: number) => new Vec2(x, y);

export const open = (...pts: [number, number][]) =>
  new Polyline(pts.map(([x, y]) => new Vec2(x, y)));
