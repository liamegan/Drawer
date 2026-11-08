import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { Polyline } from "../geometry/Polyline.js";
import { circle, rect } from "../geometry/shapes.js";
import { segmentDistance } from "../geometry/simplify.js";
import { Random } from "../random/Random.js";
import { isolines, traceLevels } from "./isolines.js";
import { sdf } from "./SDF.js";

const v = (x: number, y: number) => new Vec2(x, y);

/** Twice the signed area; positive for rings clockwise on screen. */
function area2(path: Polyline): number {
  const p = path.points;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a;
}

/** Distance from `p` to the nearest segment of any of `paths`. */
function distanceTo(paths: readonly Polyline[], p: Vec2): number {
  let best = Infinity;
  for (const path of paths) {
    const q = path.points;
    const n = path.closed ? q.length : q.length - 1;
    for (let i = 0; i < n; i++) {
      const a = q[i];
      const b = q[(i + 1) % q.length];
      best = Math.min(best, segmentDistance(p.x, p.y, a.x, a.y, b.x, b.y));
    }
  }
  return best;
}

describe("isolines", () => {
  it("traces a circle to within a hundredth of a millimetre", () => {
    const c = v(20, 20);
    const field = sdf(circle(c, 10, { tolerance: 0.001 }));
    for (const level of [-6, -2, 0, 3]) {
      const rings = isolines(field, level, { simplify: 0 });
      expect(rings).toHaveLength(1);
      expect(rings[0].closed).toBe(true);
      for (const p of rings[0].points) {
        expect(Math.abs(p.distance(c) - (10 + level))).toBeLessThan(0.01);
      }
    }
  });

  it("puts every raw vertex on its level", () => {
    const random = new Random("isolines");
    const n = 12;
    const shape = new Polyline(
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        const r = random.range(6, 18);
        return v(25 + Math.cos(a) * r, 25 + Math.sin(a) * r);
      }),
      true,
    );
    const field = sdf(shape);
    const levels = [-3, -1, 0, 1.5];
    const grid = field.sample({ resolution: 5, pad: 3 });
    traceLevels(grid, levels).forEach((paths, l) => {
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.closed).toBe(true);
        // Linear interpolation is exact along straight edges and close
        // elsewhere; corners of the field can pull a crossing a little off.
        for (const p of path.points) {
          expect(Math.abs(field.at(p.x, p.y) - levels[l])).toBeLessThan(0.05);
        }
      }
    });
  });

  it("rounds a square's corners outward and keeps them sharp inward", () => {
    const field = sdf(rect(10, 10, 20, 20));
    const [grown] = isolines(field, 2);
    const [shrunk] = isolines(field, -2);
    // Grown: the corner is an arc of radius 2 around the square's corner.
    const diagonal = v(10 - 2 / Math.SQRT2, 10 - 2 / Math.SQRT2);
    expect(distanceTo([grown], diagonal)).toBeLessThan(0.01);
    expect(distanceTo([grown], v(8, 8))).toBeGreaterThan(0.5);
    // Shrunk: a square 2 mm in, corners clipped by at most half a cell's
    // diagonal (0.14 mm at the default 0.2 mm cells).
    expect(distanceTo([shrunk], v(12, 12))).toBeLessThan(0.1415);
    for (const p of shrunk.points) {
      expect(p.x).toBeGreaterThan(12 - 1e-9);
      expect(p.x).toBeLessThan(28 + 1e-9);
    }
  });

  it("runs outer rings clockwise on screen and holes the other way", () => {
    const shapes = [rect(0, 0, 20, 20), rect(6, 6, 8, 8).reversed()];
    const rings = isolines(sdf(shapes), 0);
    expect(rings).toHaveLength(2);
    const areas = rings.map(area2).sort((a, b) => a - b);
    expect(areas[0]).toBeLessThan(0);
    expect(areas[1]).toBeGreaterThan(0);
    // The same as `rect` itself.
    expect(Math.sign(area2(rect(0, 0, 1, 1)))).toBe(1);
  });

  it("keeps rings apart or joins them cleanly through saddles", () => {
    // Two circles a tenth of a cell apart: the cells between them are saddles.
    const a = sdf(circle(v(10, 10), 5));
    const b = sdf(circle(v(20.02, 10), 5));
    const field = a.union(b);
    const apart = isolines(field, -0.01, { simplify: 0 });
    expect(apart).toHaveLength(2);
    const joined = isolines(field, 0.2, { simplify: 0 });
    expect(joined).toHaveLength(1);
    for (const ring of [...apart, ...joined]) {
      expect(ring.closed).toBe(true);
      expect(area2(ring)).toBeGreaterThan(0);
    }
  });

  it("traces the outline of a boolean combination", () => {
    const disc = sdf(circle(v(15, 15), 10, { tolerance: 0.001 }));
    const bite = sdf(circle(v(25, 15), 6, { tolerance: 0.001 }));
    const [outline] = isolines(disc.subtract(bite), 0, { simplify: 0 });
    for (const p of outline.points) {
      const dDisc = p.distance(v(15, 15)) - 10;
      const dBite = 6 - p.distance(v(25, 15));
      // On the outline of the difference: on one circle, outside the other.
      expect(Math.min(Math.abs(dDisc), Math.abs(dBite))).toBeLessThan(0.1);
      expect(Math.max(dDisc, dBite)).toBeLessThan(0.1);
    }
  });

  it("returns one list of paths per level, in the order given", () => {
    const grid = sdf(rect(0, 0, 10, 10)).sample({ pad: 2 });
    const byLevel = traceLevels(grid, [1, -4, -1]);
    expect(byLevel).toHaveLength(3);
    expect(byLevel[1][0].bounds.width).toBeCloseTo(2, 1);
    expect(byLevel[0][0].bounds.width).toBeGreaterThan(11.5);
  });

  it("returns nothing for fields without an inside, or past their depth", () => {
    expect(isolines(sdf([]), 0)).toEqual([]);
    expect(isolines(sdf(rect(0, 0, 4, 4)), -3)).toEqual([]);
  });
});
