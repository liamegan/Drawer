import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { arc, catmullRom, cubic, quadratic } from "./curves.js";
import type { Polyline } from "./Polyline.js";
import { segmentDistance } from "./simplify.js";

const v = (x: number, y: number) => new Vec2(x, y);

/** Largest distance from any of `samples` to the polyline. */
function maxGap(line: Polyline, samples: readonly Vec2[]): number {
  const pts = line.points;
  let worst = 0;
  for (const s of samples) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      best = Math.min(best, segmentDistance(s.x, s.y, a.x, a.y, b.x, b.y));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

function bezier(p: readonly Vec2[], t: number): Vec2 {
  const u = 1 - t;
  const [a, b, c, d] = p;
  const [wa, wb, wc, wd] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return v(
    wa * a.x + wb * b.x + wc * c.x + wd * d.x,
    wa * a.y + wb * b.y + wc * c.y + wd * d.y,
  );
}

/** True if any two non-adjacent segments cross. */
function selfIntersects(line: Polyline): boolean {
  const p = line.points;
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 1; i < p.length; i++) {
    for (let j = i + 2; j < p.length; j++) {
      const [a, b, c, d] = [p[i - 1], p[i], p[j - 1], p[j]];
      const d1 = cross(c, d, a);
      const d2 = cross(c, d, b);
      const d3 = cross(a, b, c);
      const d4 = cross(a, b, d);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  }
  return false;
}

describe("cubic and quadratic", () => {
  const ctrl = [v(0, 0), v(10, 30), v(40, -20), v(50, 10)];

  it("stays within tolerance of the true curve, with exact ends", () => {
    for (const tolerance of [0.1, 0.02, 0.005]) {
      const line = cubic(ctrl[0], ctrl[1], ctrl[2], ctrl[3], { tolerance });
      const samples = Array.from({ length: 2001 }, (_, i) =>
        bezier(ctrl, i / 2000),
      );
      expect(maxGap(line, samples)).toBeLessThanOrEqual(tolerance + 1e-9);
      expect(line.start!.x).toBe(0);
      expect(line.end!.x).toBe(50);
      expect(line.end!.y).toBe(10);
      expect(line.closed).toBe(false);
    }
  });

  it("uses more points for a tighter tolerance, and two for a line", () => {
    const counts = [0.5, 0.05, 0.005].map(
      (tolerance) =>
        cubic(ctrl[0], ctrl[1], ctrl[2], ctrl[3], { tolerance }).pointCount,
    );
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(cubic(v(0, 0), v(1, 0), v(2, 0), v(3, 0)).pointCount).toBe(2);
  });

  it("raises a quadratic to the same curve", () => {
    const [a, b, c] = [v(0, 0), v(20, 40), v(40, 0)];
    const line = quadratic(a, b, c, { tolerance: 0.01 });
    const samples = Array.from({ length: 1001 }, (_, i) => {
      const t = i / 1000;
      const u = 1 - t;
      return v(
        u * u * a.x + 2 * u * t * b.x + t * t * c.x,
        u * u * a.y + 2 * u * t * b.y + t * t * c.y,
      );
    });
    expect(maxGap(line, samples)).toBeLessThanOrEqual(0.01 + 1e-9);
    expect(() => quadratic(a, b, c, { tolerance: 0 })).toThrow(RangeError);
  });
});

describe("catmullRom", () => {
  const pts = [v(0, 0), v(10, 5), v(20, -3), v(30, 8), v(35, 0)];

  it("passes through every point", () => {
    const line = catmullRom(pts);
    for (const p of pts) {
      const hit = line.points.some((q) => q.distance(p) < 1e-9);
      expect(hit).toBe(true);
    }
    expect(line.start!.distance(pts[0])).toBe(0);
    expect(line.end!.distance(pts[4])).toBe(0);
  });

  it("closes into a ring through every point", () => {
    const line = catmullRom(pts, { closed: true });
    expect(line.closed).toBe(true);
    expect(line.start!.distance(pts[0])).toBe(0);
    expect(line.end!.distance(pts[0])).toBeGreaterThan(0.01);
    for (const p of pts) {
      expect(line.points.some((q) => q.distance(p) < 1e-9)).toBe(true);
    }
  });

  it("doesn't loop at a short span between long ones, unlike uniform", () => {
    const tricky = [v(0, -10), v(10, 0), v(10, 1), v(0, 11)];
    expect(selfIntersects(catmullRom(tricky, { alpha: 0 }))).toBe(true);
    expect(selfIntersects(catmullRom(tricky))).toBe(false);
  });

  it("handles repeats and too few points", () => {
    expect(catmullRom([]).pointCount).toBe(0);
    expect(catmullRom([v(1, 1), v(1, 1)]).pointCount).toBe(0);
    const repeated = catmullRom([v(0, 0), v(0, 0), v(10, 0), v(10, 0)]);
    expect(repeated.pointCount).toBe(2);
    expect(() => catmullRom(pts, { alpha: 2 })).toThrow(RangeError);
  });
});

describe("arc", () => {
  it("lies on the circle and runs clockwise for increasing angles", () => {
    const c = v(5, 5);
    const a = arc(c, 10, 0, Math.PI / 2);
    for (const p of a.points) expect(p.distance(c)).toBeCloseTo(10, 9);
    expect(a.start!.x).toBeCloseTo(15);
    expect(a.end!.y).toBeCloseTo(15); // y down: a quarter turn clockwise
    const mid = v(5 + 10 * Math.SQRT1_2, 5 + 10 * Math.SQRT1_2);
    expect(maxGap(a, [mid])).toBeLessThanOrEqual(0.02);
  });

  it("follows the circle's segment count, and runs backwards too", () => {
    const back = arc(v(0, 0), 10, Math.PI, 0);
    expect(back.start!.x).toBeCloseTo(-10);
    expect(back.end!.x).toBeCloseTo(10);
    // Anticlockwise from the left: through the bottom half.
    expect(back.points[1].y).toBeGreaterThan(0);
    expect(arc(v(0, 0), 10, 0, 0).pointCount).toBe(2);
    expect(() => arc(v(0, 0), -1, 0, 1)).toThrow(RangeError);
  });
});
