import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { shapeContains } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import { circle, rect } from "../geometry/shapes.js";
import { segmentDistance } from "../geometry/simplify.js";
import { Random } from "../random/Random.js";
import { sdf } from "../sdf/SDF.js";
import { contourHatch, contourHatchWith } from "./contour.js";

const v = (x: number, y: number) => new Vec2(x, y);

function blob(random: Random, cx: number, cy: number): Polyline {
  const n = random.int(6, 14);
  return new Polyline(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = random.range(6, 20);
      return v(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }),
    true,
  );
}

function distanceToPath(path: Polyline, p: Vec2): number {
  const q = path.points;
  let best = Infinity;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    best = Math.min(best, segmentDistance(p.x, p.y, a.x, a.y, b.x, b.y));
  }
  return best;
}

describe("contourHatch", () => {
  it("fills random concave shapes with rings at even depths", () => {
    const random = new Random("contours");
    const spacing = 1.5;
    for (let trial = 0; trial < 6; trial++) {
      const shape = blob(random, 30, 30);
      const field = sdf(shape);
      const rings = contourHatch(shape, { spacing, simplify: 0 });
      expect(rings.length).toBeGreaterThan(2);
      for (const ring of rings) {
        expect(ring.closed).toBe(true);
        // Each ring sits at a depth of (k + ½) spacings.
        const depth = -field.at(ring.points[0].x, ring.points[0].y);
        const k = Math.round(depth / spacing - 0.5);
        for (const p of ring.points) {
          expect(shapeContains(shape, p.x, p.y)).toBe(true);
          // Within half a cell: corners of the field bend the interpolation.
          expect(Math.abs(-field.at(p.x, p.y) - (k + 0.5) * spacing)).toBeLessThan(0.1);
        }
      }
    }
  });

  it("keeps neighbouring rings at least a spacing apart", () => {
    const shape = blob(new Random("apart"), 30, 30);
    const rings = contourHatch(shape, { spacing: 2 });
    const field = sdf(shape);
    const depthOf = (r: Polyline) => -field.at(r.points[0].x, r.points[0].y);
    for (const inner of rings) {
      for (const outer of rings) {
        if (depthOf(outer) >= depthOf(inner) - 1) continue;
        for (const p of inner.points) {
          expect(distanceToPath(outer, p)).toBeGreaterThan(2 - 0.1);
        }
      }
    }
  });

  it("nests squares inside a square", () => {
    const rings = contourHatch(rect(0, 0, 20, 20), { spacing: 2 });
    expect(rings).toHaveLength(5);
    rings.forEach((ring, k) => {
      const inset = (k + 0.5) * 2;
      expect(ring.bounds.min.x).toBeCloseTo(inset, 6);
      expect(ring.bounds.max.y).toBeCloseTo(20 - inset, 6);
      expect(ring.pointCount).toBeLessThanOrEqual(8);
    });
  });

  it("measures combined fields from their outline unless told not to", () => {
    const a = circle(v(15, 20), 10);
    const b = circle(v(29, 20), 10);
    const union = sdf(a).union(sdf(b));
    // The exact field of the union, from overlapping rings under nonzero.
    const truth = sdf([a, b]);
    const worst = (rings: Polyline[]) => {
      let err = 0;
      for (const ring of rings) {
        const level = truth.at(ring.points[0].x, ring.points[0].y);
        const k = Math.round(-level / 1.5 - 0.5);
        for (const p of ring.points) {
          err = Math.max(err, Math.abs(truth.at(p.x, p.y) + (k + 0.5) * 1.5));
        }
      }
      return err;
    };
    expect(worst(contourHatch(union, { spacing: 1.5 }))).toBeLessThan(0.1);
    // Contouring min(a, b) directly leaves creases where the circles meet.
    expect(worst(contourHatch(union, { spacing: 1.5, exact: false }))).toBeGreaterThan(0.5);
  });

  it("re-traces grown fields, whose inside isn't exact", () => {
    // Two discs 2 mm apart, grown by 2 mm: the gap fills in. Growing a disc
    // gives a bigger disc, so the exact field of the result is known.
    const grown = sdf([circle(v(15, 20), 8), circle(v(33, 20), 8)]).offset(2);
    const truth = sdf([circle(v(15, 20), 10), circle(v(33, 20), 10)]);
    expect(grown.exact).toBe(false);
    const worst = (rings: Polyline[]) => {
      let err = 0;
      for (const ring of rings) {
        const level = truth.at(ring.points[0].x, ring.points[0].y);
        const k = Math.round(-level / 1.5 - 0.5);
        for (const p of ring.points) {
          err = Math.max(err, Math.abs(truth.at(p.x, p.y) + (k + 0.5) * 1.5));
        }
      }
      return err;
    };
    expect(worst(contourHatch(grown, { spacing: 1.5 }))).toBeLessThan(0.1);
    expect(
      worst(contourHatch(grown, { spacing: 1.5, exact: false })),
    ).toBeGreaterThan(0.3);
  });

  it("passes each ring through the filter with its index", () => {
    const seen: number[] = [];
    const out = contourHatchWith(rect(0, 0, 10, 10), { spacing: 1 }, (k, ring) => {
      seen.push(k);
      return k % 2 === 0 ? [ring] : [];
    });
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(out).toHaveLength(3);
  });

  it("follows holes", () => {
    const shapes = [rect(0, 0, 30, 30), rect(10, 10, 10, 10).reversed()];
    const rings = contourHatch(shapes, { spacing: 2 });
    for (const ring of rings) {
      for (const p of ring.points) expect(shapeContains(shapes, p.x, p.y)).toBe(true);
    }
    // Rings at depths 1 and 3 round the hole and in from the edge. The band
    // is 5 mm deep along its middle but deeper in its corners, away from the
    // hole's corners, so depth 5 leaves four small rings there.
    expect(rings).toHaveLength(2 + 2 + 4);
  });

  it("rejects bad spacing and returns nothing for empty shapes", () => {
    expect(() => contourHatch(rect(0, 0, 5, 5), { spacing: 0 })).toThrow(RangeError);
    expect(contourHatch([], { spacing: 1 })).toEqual([]);
  });
});
