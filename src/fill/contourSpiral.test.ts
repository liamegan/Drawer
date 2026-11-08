import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { shapeContains } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import { circle, polygon, rect } from "../geometry/shapes.js";
import { Random } from "../random/Random.js";
import { sdf } from "../sdf/SDF.js";
import { contourSpiral } from "./contourSpiral.js";
import { spiral } from "./spiral.js";

const v = (x: number, y: number) => new Vec2(x, y);

/** A smooth, wobbly outline: a circle with a few random harmonics. */
function organic(random: Random, cx: number, cy: number, r: number): Polyline {
  const waves = Array.from({ length: 4 }, (_, k) => ({
    amount: random.range(0.05, 0.25) / (k + 1),
    phase: random.range(0, Math.PI * 2),
    frequency: k + 2,
  }));
  const n = 300;
  return new Polyline(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      let radius = r;
      for (const w of waves) {
        radius *= 1 + w.amount * Math.sin(w.frequency * a + w.phase);
      }
      return v(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    }),
    true,
  );
}

const uShape = new Polyline(
  [v(5, 5), v(55, 5), v(55, 55), v(41, 55), v(41, 19), v(19, 19), v(19, 55), v(5, 55)],
  true,
);

/** Points every `step` mm along each stroke, with their stroke and distance along it. */
function samples(strokes: readonly Polyline[], step: number) {
  const out: { x: number; y: number; stroke: number; along: number }[] = [];
  strokes.forEach((stroke, s) => {
    const pts = stroke.points;
    let along = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = a.distance(b);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) {
        out.push({
          x: a.x + ((b.x - a.x) * k) / n,
          y: a.y + ((b.y - a.y) * k) / n,
          stroke: s,
          along: along + (len * k) / n,
        });
      }
      along += len;
    }
  });
  return out;
}

/**
 * How far each sample is from the neighbouring turn (in spacings), and how
 * far random points inside are from the nearest stroke (in spacings). Points
 * at the very centre, where the spiral ends, are left out.
 */
function spacingStats(
  shape: Polyline | Polyline[],
  strokes: readonly Polyline[],
  spacing: number,
) {
  const field = sdf(shape);
  const deepest = -field.sample().min;
  const pts = samples(strokes, spacing / 4);
  const cell = spacing;
  const buckets = new Map<string, typeof pts>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const p of pts) {
    const k = key(p.x, p.y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(p);
  }
  const nearby = function* (x: number, y: number) {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) yield* buckets.get(`${cx + dx},${cy + dy}`) ?? [];
    }
  };
  const turns: number[] = [];
  for (const p of pts) {
    if (-field.at(p.x, p.y) > deepest - 1.5 * spacing) continue;
    let best = Infinity;
    for (const q of nearby(p.x, p.y)) {
      if (q.stroke === p.stroke && Math.abs(q.along - p.along) < 3 * spacing) continue;
      best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
    }
    if (best < Infinity) turns.push(best / spacing);
  }
  const random = new Random("gaps");
  const b = field.bounds!;
  const gaps: number[] = [];
  while (gaps.length < 1500) {
    const x = random.range(b.min.x, b.max.x);
    const y = random.range(b.min.y, b.max.y);
    const depth = -field.at(x, y);
    if (depth < spacing || depth > deepest - spacing) continue;
    let best = Infinity;
    for (const q of nearby(x, y)) best = Math.min(best, Math.hypot(q.x - x, q.y - y));
    gaps.push(best / spacing);
  }
  const pct = (xs: number[], q: number) =>
    [...xs].sort((a, c) => a - c)[Math.min(xs.length - 1, Math.floor(q * xs.length))];
  return {
    turnLow: pct(turns, 0.05),
    turnMedian: pct(turns, 0.5),
    turnHigh: pct(turns, 0.95),
    widestGap: Math.max(...gaps),
  };
}

function expectInside(shape: Polyline | Polyline[], strokes: readonly Polyline[]) {
  for (const stroke of strokes) {
    for (const p of stroke.points) expect(shapeContains(shape, p.x, p.y)).toBe(true);
  }
}

describe("contourSpiral", () => {
  it("fills a U, which `spiral` can't, with one stroke", () => {
    expect(() => spiral(uShape, { spacing: 1.5 })).toThrow(RangeError);
    const strokes = contourSpiral(uShape, { spacing: 1.5 });
    expect(strokes).toHaveLength(1);
    expect(strokes[0].closed).toBe(false);
    expectInside(uShape, strokes);
    const stats = spacingStats(uShape, strokes, 1.5);
    expect(stats.turnMedian).toBeCloseTo(1, 1);
    expect(stats.widestGap).toBeLessThan(0.6);
  });

  it("keeps turns a spacing apart in organic blobs", () => {
    const random = new Random("organic");
    for (let trial = 0; trial < 4; trial++) {
      const shape = organic(random, 30, 30, 20);
      const strokes = contourSpiral(shape, { spacing: 1.5 });
      expectInside(shape, strokes);
      const stats = spacingStats(shape, strokes, 1.5);
      expect(stats.turnLow).toBeGreaterThan(0.85);
      expect(stats.turnMedian).toBeCloseTo(1, 1);
      expect(stats.turnHigh).toBeLessThan(1.1);
      expect(stats.widestGap).toBeLessThan(0.65);
    }
  });

  it("matches `spiral` on regular polygons", () => {
    for (const sides of [3, 4, 6]) {
      const shape = polygon(v(30, 30), 22, sides, 0.3);
      for (const strokes of [
        contourSpiral(shape, { spacing: 1.5 }),
        spiral(shape, { spacing: 1.5 }),
      ]) {
        expect(strokes).toHaveLength(1);
        const stats = spacingStats(shape, strokes, 1.5);
        expect(stats.turnLow).toBeGreaterThan(0.93);
        // Near a sharp corner the next turn's corner is further than a
        // spacing away (2 spacings at 60°), for any spiral.
        expect(stats.turnHigh).toBeLessThan(1.08);
      }
    }
  });

  it("starts a new spiral in each lobe the shape splits into", () => {
    const dumbbell = [circle(v(16, 30), 12), circle(v(46, 30), 12), rect(16, 27, 30, 6)];
    const strokes = contourSpiral(dumbbell, { spacing: 1.5 });
    expect(strokes).toHaveLength(2);
    expectInside(dumbbell, strokes);
    // The second lobe's spiral sits in the right-hand circle.
    expect(strokes[1].bounds.min.x).toBeGreaterThan(30);
  });

  it("carries on through lobes that run out, without lifting the pen", () => {
    const hand = [
      circle(v(30, 40), 14),
      rect(14, 6, 6, 30),
      rect(23, 2, 6, 30),
      rect(32, 4, 6, 30),
      rect(41, 10, 6, 28),
    ];
    // Starting at the tip of a finger, which narrows away before the palm.
    const strokes = contourSpiral(hand, { spacing: 1.5, start: v(14, 6) });
    expect(strokes).toHaveLength(1);
    expectInside(hand, strokes);
    expect(strokes[0].start!.distance(v(14.75, 6.75))).toBeLessThan(0.5);
  });

  it("falls back to contour rings round holes", () => {
    const ring = [circle(v(30, 30), 20), circle(v(30, 30), 8).reversed()];
    const out = contourSpiral(ring, { spacing: 1.5 });
    expect(out.length).toBeGreaterThan(4);
    for (const path of out) expect(path.closed).toBe(true);
    expectInside(ring, out);
  });

  it("spirals the outline of a combined field", () => {
    const blobs = sdf(circle(v(20, 30), 12)).union(sdf(circle(v(38, 30), 10)), 6);
    const strokes = contourSpiral(blobs, { spacing: 1.5 });
    // A peanut: its waist is narrower than either end, so it splits in two.
    expect(strokes).toHaveLength(2);
    for (const stroke of strokes) {
      for (const p of stroke.points) expect(blobs.at(p.x, p.y)).toBeLessThan(0);
    }
  });

  it("starts at the outermost turn's point nearest `start`", () => {
    const square = rect(0, 0, 30, 30);
    const [stroke] = contourSpiral(square, { spacing: 2, start: v(30, 15) });
    expect(stroke.start!.distance(v(29, 15))).toBeLessThan(0.05);
  });

  it("rejects bad spacing and returns nothing for empty shapes", () => {
    expect(() => contourSpiral(rect(0, 0, 5, 5), { spacing: -1 })).toThrow(RangeError);
    expect(contourSpiral([], { spacing: 1 })).toEqual([]);
  });
});
