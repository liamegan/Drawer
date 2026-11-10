import { describe, expect, it } from "vitest";
import { Polyline } from "../geometry/Polyline.js";
import { circle, rect } from "../geometry/shapes.js";
import { hatch } from "../fill/hatch.js";
import { waveShade } from "../fill/wave.js";
import { dedupePaths } from "./dedupe.js";
import { inkDistance, inkLength, open, v } from "./ink.test-util.js";

describe("dedupePaths", () => {
  it("keeps one copy of a repeated path, in either direction", () => {
    const ring = circle(v(20, 20), 8);
    for (const again of [ring, ring.reversed(), circle(v(20, 20), 8.01)]) {
      const out = dedupePaths([ring, again]);
      expect(out).toEqual([ring]);
    }
    const line = open([0, 0], [5, 2], [12, 2]);
    expect(dedupePaths([line, line.reversed()])).toEqual([line]);
  });

  it("keeps only the new part of a partial overlap", () => {
    const out = dedupePaths([open([0, 0], [10, 0]), open([5, 0], [15, 0])]);
    expect(out).toHaveLength(2);
    expect(out[1].start!.distance(v(10, 0))).toBeLessThan(0.06);
    expect(out[1].end!.distance(v(15, 0))).toBeLessThan(1e-9);
  });

  it("draws an edge shared by touching squares once", () => {
    const out = dedupePaths([rect(0, 0, 10, 10), rect(10, 0, 10, 10)]);
    // The second square loses its left edge, so it's left open.
    expect(inkLength(out)).toBeCloseTo(70, 1);
    expect(
      inkDistance([rect(0, 0, 10, 10), rect(10, 0, 10, 10)], out),
    ).toBeLessThan(0.06);
  });

  it("drops the return of a path that doubles back on itself", () => {
    // Out along a line and straight back, then off somewhere new.
    const hairpin = open([0, 0], [10, 0], [0, 0.01], [0, 5]);
    const out = dedupePaths([hairpin]);
    expect(inkLength(out)).toBeLessThan(10 + 5 + 0.5);
    expect(inkDistance([hairpin], out)).toBeLessThan(0.06);
    // Along a densely sampled path too.
    const dense = new Polyline(
      Array.from({ length: 201 }, (_, i) =>
        i <= 100 ? v(i * 0.1, 0) : v((200 - i) * 0.1, 0.02),
      ),
    );
    expect(inkLength(dedupePaths([dense]))).toBeLessThan(10.5);
  });

  it("never cuts lines that only cross, or parallel lines a pen apart", () => {
    const square = rect(0, 0, 30, 30);
    const cross = [
      ...hatch(square, { spacing: 1, angle: 0 }),
      ...hatch(square, { spacing: 1, angle: Math.PI / 2 }),
      ...hatch(square, { spacing: 1, angle: Math.PI / 4 }),
      ...hatch(square, { spacing: 0.3, angle: 0.1 }),
    ];
    // Two lines crossing at 2° are within tolerance for nearly 3 mm.
    const a = Math.PI / 90;
    cross.push(
      open([0, 40], [40, 40]),
      open([0, 40 - 20 * Math.tan(a)], [40, 40 + 20 * Math.tan(a)]),
    );
    const out = dedupePaths(cross);
    expect(out).toHaveLength(cross.length);
    out.forEach((path, k) => expect(path).toBe(cross[k]));
  });

  it("leaves smooth curves and overlapping wave flanks as drawn", () => {
    // A densely sampled spiral: each point is near its neighbours.
    const spiral = new Polyline(
      Array.from({ length: 4000 }, (_, i) => {
        const a = i * 0.01;
        return v(
          30 + Math.cos(a) * (2 + a * 0.4),
          30 + Math.sin(a) * (2 + a * 0.4),
        );
      }),
    );
    expect(dedupePaths([spiral])).toEqual([spiral]);
    // The darkest waves overlap their own flanks on purpose.
    const waves = waveShade(rect(0, 0, 20, 20), {
      tone: 1,
      pen: 0.3,
      spacing: 1,
    });
    const out = dedupePaths(waves);
    expect(inkLength(out)).toBeGreaterThan(0.99 * inkLength(waves));
  });

  it("removes overlaps only once they're long enough to be worth a pen lift", () => {
    const base = open([0, 0], [20, 0]);
    // Steeply in, along the base for 0.6 mm, steeply out.
    const short = open([2, 3], [5, 0.02], [5.6, 0.02], [8.6, 3]);
    expect(dedupePaths([base, short])).toEqual([base, short]);
    expect(dedupePaths([base, short], { minOverlap: 0.3 })).toHaveLength(3);
  });

  it("rejects a bad tolerance", () => {
    expect(() => dedupePaths([], { tolerance: 0 })).toThrow(RangeError);
  });
});
