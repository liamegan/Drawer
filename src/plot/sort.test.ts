import { describe, expect, it } from "vitest";
import { Polyline } from "../geometry/Polyline.js";
import { circle, rect } from "../geometry/shapes.js";
import { Random } from "../random/Random.js";
import { PointGrid } from "./grid.js";
import { inkLength, v } from "./ink.test-util.js";
import { sortPaths, travelLength } from "./sort.js";

/** Each path's segments as sorted coordinate strings, ignoring direction. */
function segmentSet(paths: readonly Polyline[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    const pts = path.points;
    const count = path.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const ends = [pts[i], pts[(i + 1) % pts.length]].map(
        (p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`,
      );
      out.push(ends.sort().join("|"));
    }
  }
  return out.sort();
}

describe("PointGrid", () => {
  it("finds the nearest remaining point, like a brute-force search", () => {
    const random = new Random("grid");
    const n = 500;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = random.range(0, 100);
      ys[i] = random.range(0, 60);
    }
    const grid = new PointGrid(xs, ys);
    const alive = new Set(Array.from({ length: n }, (_, i) => i));
    for (let q = 0; q < 400; q++) {
      const x = random.range(-30, 130);
      const y = random.range(-30, 90);
      let best = -1;
      let bestD = Infinity;
      for (const i of alive) {
        const d = Math.hypot(xs[i] - x, ys[i] - y);
        if (d < bestD) [best, bestD] = [i, d];
      }
      expect(grid.nearest(x, y)).toBe(best);
      expect(grid.nearest(x, y, bestD * 0.99)).toBe(-1);
      grid.remove(best);
      alive.delete(best);
    }
    expect(grid.size).toBe(100);
  });
});

describe("sortPaths", () => {
  const random = new Random("sort");
  // Short strokes scattered over an A4-sized area, in random order.
  const strokes = Array.from({ length: 600 }, () => {
    const a = v(random.range(10, 200), random.range(10, 287));
    const angle = random.range(0, Math.PI * 2);
    return new Polyline([
      a,
      a.addNew(v(Math.cos(angle) * 3, Math.sin(angle) * 3)),
    ]);
  });

  it("cuts pen-up travel without changing the ink", () => {
    const sorted = sortPaths(strokes);
    expect(sorted).toHaveLength(strokes.length);
    expect(segmentSet(sorted)).toEqual(segmentSet(strokes));
    expect(inkLength(sorted)).toBeCloseTo(inkLength(strokes), 9);
    const before = travelLength(strokes);
    const after = travelLength(sorted);
    expect(after).toBeLessThan(before / 8);
  });

  it("draws hatching as a zigzag, reversing every other line", () => {
    const lines = Array.from(
      { length: 20 },
      (_, k) => new Polyline([v(0, k), v(30, k)]),
    );
    const sorted = sortPaths(new Random("shuffle").shuffle(lines));
    // Line by line from the top, alternating direction: travel is the
    // steps between lines plus the walk home.
    expect(sorted.map((l) => l.start!.y)).toEqual(lines.map((_, k) => k));
    sorted.forEach((line, k) =>
      expect(line.start!.x).toBe(k % 2 === 0 ? 0 : 30),
    );
    expect(travelLength(sorted)).toBeCloseTo(19 + Math.hypot(0, 19), 9);
  });

  it("starts rings at their vertex nearest the pen, keeping their shape", () => {
    const rings = [circle(v(50, 50), 10), circle(v(80, 50), 10)];
    const sorted = sortPaths(rings, { start: v(100, 50) });
    expect(sorted[0].start!.distance(v(90, 50))).toBeLessThan(0.5);
    expect(segmentSet(sorted)).toEqual(segmentSet(rings));
    for (const ring of sorted) expect(ring.closed).toBe(true);
    // Without rotation, rings start where they were drawn from.
    const fixed = sortPaths(rings, { start: v(100, 50), rotateClosed: false });
    expect(fixed.map((r) => r.start)).toEqual(
      expect.arrayContaining(rings.map((r) => r.start)),
    );
  });

  it("is deterministic and drops paths with no length", () => {
    const squares = [rect(0, 0, 5, 5), rect(0, 0, 5, 5), rect(10, 0, 5, 5)];
    const a = sortPaths([...squares, new Polyline([v(1, 1)])]);
    const b = sortPaths([...squares, new Polyline([v(1, 1)])]);
    expect(a).toHaveLength(3);
    expect(a.map((p) => p.start)).toEqual(b.map((p) => p.start));
    expect(sortPaths([])).toEqual([]);
  });
});
