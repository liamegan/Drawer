import { describe, expect, it } from "vitest";
import { Polyline } from "../geometry/Polyline.js";
import { circle } from "../geometry/shapes.js";
import { Random } from "../random/Random.js";
import { inkDistance, inkLength, open, v } from "./ink.test-util.js";
import { mergePaths } from "./merge.js";

/** Cuts a path into pieces of `size` points, sharing their end points. */
function cut(path: Polyline, size: number): Polyline[] {
  const pts = path.closed ? [...path.points, path.points[0]] : [...path.points];
  const out: Polyline[] = [];
  for (let i = 0; i < pts.length - 1; i += size - 1) {
    out.push(new Polyline(pts.slice(i, i + size)));
  }
  return out;
}

describe("mergePaths", () => {
  it("joins shuffled, partly reversed pieces back into one path", () => {
    const random = new Random("merge");
    const wave = new Polyline(
      Array.from({ length: 200 }, (_, i) =>
        v(i * 0.5, 10 + Math.sin(i / 5) * 4),
      ),
    );
    const pieces = random
      .shuffle(cut(wave, 7))
      .map((p) => (random.bool() ? p.reversed() : p));
    const merged = mergePaths(pieces);
    expect(merged).toHaveLength(1);
    expect(merged[0].pointCount).toBe(wave.pointCount);
    expect(inkLength(merged)).toBeCloseTo(wave.length, 9);
    expect(inkDistance(merged, [wave])).toBeLessThan(1e-9);
  });

  it("closes a ring cut into pieces", () => {
    const ring = circle(v(20, 20), 10);
    const merged = mergePaths(new Random("ring").shuffle(cut(ring, 5)));
    expect(merged).toHaveLength(1);
    expect(merged[0].closed).toBe(true);
    expect(merged[0].length).toBeCloseTo(ring.length, 9);
  });

  it("bridges gaps within tolerance but not beyond", () => {
    const a = open([0, 0], [10, 0]);
    const near = open([10.04, 0], [20, 0]);
    const far = open([10.1, 0], [20, 0]);
    expect(mergePaths([a, near])).toHaveLength(1);
    expect(mergePaths([a, far])).toHaveLength(2);
    expect(mergePaths([a, far], { tolerance: 0.2 })).toHaveLength(1);
  });

  it("leaves closed paths alone and takes the nearest end at junctions", () => {
    const ring = circle(v(50, 50), 5);
    const out = mergePaths([ring, open([0, 0], [10, 0])]);
    expect(out).toContain(ring);
    // Three strokes meet at (10, 0): the first joins the nearer of the two.
    const star = mergePaths([
      open([0, 0], [10, 0]),
      open([10, 0], [10, 10]),
      open([10.01, 0], [20, 0]),
    ]);
    expect(star).toHaveLength(2);
  });
});
