import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { shapeContains } from "../geometry/clip.js";
import { Polyline } from "../geometry/Polyline.js";
import type { FillRule } from "../geometry/scanline.js";
import { circle, rect } from "../geometry/shapes.js";
import { Random } from "../random/Random.js";
import { sdf, smoothMin, type SDF } from "./SDF.js";

const v = (x: number, y: number) => new Vec2(x, y);

/** A random, possibly concave polygon around a centre. */
function blob(random: Random, cx: number, cy: number): Polyline {
  const n = random.int(5, 14);
  return new Polyline(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = random.range(4, 20);
      return v(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }),
    true,
  );
}

const pentagram = new Polyline(
  Array.from({ length: 5 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    return v(30 + Math.cos(a) * 20, 30 + Math.sin(a) * 20);
  }),
  true,
);

/** Compares a sampled grid with the exact distance at every node. */
function gridErrors(field: SDF, resolution: number) {
  const grid = field.sample({ resolution, pad: 3 });
  let worst = 0;
  let wrong = 0;
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const exact = field.at(grid.x(i), grid.y(j));
      const err = Math.abs(grid.data[j * grid.cols + i] - exact);
      if (err > 1e-9) wrong++;
      worst = Math.max(worst, err);
    }
  }
  return { worst, wrong, nodes: grid.cols * grid.rows, cell: grid.cell };
}

describe("sdf", () => {
  it("matches exact distances on random concave blobs", () => {
    const random = new Random("sdf-blobs");
    for (let trial = 0; trial < 12; trial++) {
      const field = sdf(blob(random, 30, 30));
      const { worst, wrong, nodes, cell } = gridErrors(field, 4);
      expect(worst).toBeLessThan(0.01 * cell);
      expect(wrong / nodes).toBeLessThan(0.01);
    }
  });

  it("matches exact distances on finely divided circles", () => {
    const field = sdf(circle(v(20, 20), 15));
    const { worst } = gridErrors(field, 5);
    expect(worst).toBeLessThan(1e-3);
  });

  for (const rule of ["nonzero", "evenodd"] as FillRule[]) {
    it(`matches exact distances on a pentagram (${rule})`, () => {
      const { worst, wrong, nodes, cell } = gridErrors(sdf(pentagram, { rule }), 4);
      expect(worst).toBeLessThan(0.01 * cell);
      expect(wrong / nodes).toBeLessThan(0.01);
    });

    it(`is negative exactly inside, by the fill rule (${rule})`, () => {
      const shapes = [pentagram, rect(20, 20, 30, 8)];
      const field = sdf(shapes, { rule });
      const grid = field.sample({ resolution: 3 });
      for (let j = 0; j < grid.rows; j++) {
        for (let i = 0; i < grid.cols; i++) {
          const d = grid.data[j * grid.cols + i];
          if (Math.abs(d) < 1e-6) continue;
          expect(d < 0).toBe(shapeContains(shapes, grid.x(i), grid.y(j), rule));
        }
      }
    });
  }

  it("measures to the pentagram's outer outline under nonzero", () => {
    const filled = sdf(pentagram);
    const holed = sdf(pentagram, { rule: "evenodd" });
    // The centre is inside under nonzero, in the pentagon hole under even-odd.
    expect(filled.at(30, 30)).toBeLessThan(-5);
    expect(holed.at(30, 30)).toBeGreaterThan(5);
  });

  it("ignores edges inside overlapping rings under nonzero", () => {
    const shapes = [rect(0, 0, 10, 10), rect(5, 0, 10, 10)];
    expect(sdf(shapes).at(7.5, 5)).toBeCloseTo(-5, 9);
    expect(sdf(shapes).at(2.5, 5)).toBeCloseTo(-2.5, 9);
    // Under even-odd the overlap is outside, bounded by both inner edges.
    expect(sdf(shapes, { rule: "evenodd" }).at(7.5, 5)).toBeCloseTo(2.5, 9);
    const { worst, cell } = gridErrors(sdf(shapes), 4);
    expect(worst).toBeLessThan(0.01 * cell);
  });

  it("treats a ring inside another, running the same way, by the rule", () => {
    const shapes = [rect(0, 0, 20, 20), rect(5, 5, 10, 10)];
    expect(sdf(shapes).at(10, 10)).toBeCloseTo(-10, 9);
    expect(sdf(shapes, { rule: "evenodd" }).at(10, 10)).toBeCloseTo(5, 9);
  });

  it("measures holes cut by a ring running the other way", () => {
    const hole = rect(5, 5, 10, 10).reversed();
    const field = sdf([rect(0, 0, 20, 20), hole]);
    expect(field.at(10, 10)).toBeCloseTo(5, 9);
    expect(field.at(2.5, 10)).toBeCloseTo(-2.5, 9);
    const { worst, cell } = gridErrors(field, 4);
    expect(worst).toBeLessThan(0.01 * cell);
  });

  it("puts nodes on the page lattice", () => {
    const grid = sdf(rect(0.33, 0.71, 3, 3)).sample({ resolution: 4 });
    for (let i = 0; i < grid.cols; i++) {
      expect(grid.x(i) * 4).toBeCloseTo(Math.round(grid.x(i) * 4), 9);
    }
  });

  it("has no inside without closed paths", () => {
    const field = sdf([new Polyline([v(0, 0), v(5, 5)])]);
    expect(field.bounds).toBeNull();
    expect(field.at(1, 1)).toBe(Infinity);
    expect(() => field.sample()).toThrow(RangeError);
  });
});

describe("combinators", () => {
  const a = sdf(circle(v(10, 10), 8));
  const b = sdf(rect(12, 4, 14, 12));
  const window = a.union(b).sample({ resolution: 3 });
  const fa = a.sampleWindow(window).data;
  const fb = b.sampleWindow(window).data;

  it("combine node by node", () => {
    const union = a.union(b).sampleWindow(window).data;
    const inter = a.intersect(b).sampleWindow(window).data;
    const diff = a.subtract(b).sampleWindow(window).data;
    for (let k = 0; k < union.length; k++) {
      expect(union[k]).toBe(Math.min(fa[k], fb[k]));
      expect(inter[k]).toBe(Math.max(fa[k], fb[k]));
      expect(diff[k]).toBe(Math.max(fa[k], -fb[k]));
    }
  });

  it("agree with their pointwise values", () => {
    const field = a.union(b, 2).subtract(sdf(circle(v(14, 10), 3)), 1).offset(0.5);
    const grid = field.sampleWindow(window);
    for (let j = 0; j < grid.rows; j += 3) {
      for (let i = 0; i < grid.cols; i += 3) {
        expect(grid.data[j * grid.cols + i]).toBeCloseTo(
          field.at(grid.x(i), grid.y(j)),
          6,
        );
      }
    }
  });

  it("blend smoothly only where the fields are close", () => {
    const k = 3;
    const smooth = a.union(b, k).sampleWindow(window).data;
    for (let i = 0; i < smooth.length; i++) {
      const least = Math.min(fa[i], fb[i]);
      expect(smooth[i]).toBeLessThanOrEqual(least);
      expect(smooth[i]).toBeGreaterThanOrEqual(least - k / 4 - 1e-12);
      if (Math.abs(fa[i] - fb[i]) >= k) expect(smooth[i]).toBe(least);
    }
    expect(smoothMin(Infinity, Infinity, 2)).toBe(Infinity);
  });

  it("keep their insides within their bounds", () => {
    const fields = [
      a.union(b, 4),
      a.intersect(b),
      a.subtract(b, 2),
      a.offset(3),
      a.offset(-2),
    ];
    for (const field of fields) {
      const box = field.bounds!;
      const grid = field.sample({ resolution: 3, pad: 6 });
      for (let j = 0; j < grid.rows; j++) {
        for (let i = 0; i < grid.cols; i++) {
          if (grid.data[j * grid.cols + i] < 0) {
            expect(box.contains(v(grid.x(i), grid.y(j)))).toBe(true);
          }
        }
      }
    }
  });

  it("report empty intersections", () => {
    const far = sdf(rect(100, 100, 5, 5));
    expect(a.intersect(far).bounds).toBeNull();
  });

  it("keep shrinking offsets of exact fields exact inside", () => {
    expect(a.offset(-2).exact).toBe(true);
    expect(a.offset(2).exact).toBe(false);
    expect(a.union(b).exact).toBe(false);
    expect(a.offset(2).at(10, 10)).toBeCloseTo(a.at(10, 10) - 2, 12);
  });
});
