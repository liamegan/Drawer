import { describe, expect, it } from "vitest";
import { Vec2 } from "wtc-math";
import { Bounds } from "../geometry/Bounds.js";
import { Polyline } from "../geometry/Polyline.js";
import { circle, line, rect } from "../geometry/shapes.js";
import { rotation } from "../geometry/transforms.js";
import { Random } from "../random/Random.js";
import { Mask } from "./Mask.js";

const v = (x: number, y: number) => new Vec2(x, y);

/** A five-pointed star drawn in one stroke, so its middle is wound twice. */
const pentagram = (cx: number, cy: number, r: number) =>
  new Polyline(
    Array.from({ length: 5 }, (_, i) => {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      return v(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }),
    true,
  );

/** Shortest distance from `p` to the outline of a closed polyline. */
function distanceToOutline(p: Vec2, shape: Polyline): number {
  const pts = shape.points;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

describe("Mask", () => {
  it("sizes its grid from the resolution", () => {
    const mask = new Mask(10.05, 5, 10);
    expect([mask.cols, mask.rows, mask.data.length]).toEqual([101, 50, 5050]);
    expect(mask.step).toBeCloseTo(0.05);
    expect(() => new Mask(0, 5)).toThrow(RangeError);
    expect(() => new Mask(5, 5, 0)).toThrow(RangeError);
  });

  it("fills a rectangle: covered inside, clear outside, half on the edge", () => {
    const mask = new Mask(10, 10).fill(rect(2, 2, 6, 4));
    expect(mask.coverage(5, 4)).toBe(1);
    expect(mask.coverage(1, 1)).toBe(0);
    expect(mask.coverage(2, 4)).toBeCloseTo(0.5, 2);
    expect(mask.covered(2.1, 4)).toBe(true);
    expect(mask.covered(1.9, 4)).toBe(false);
  });

  it("stores fractional coverage on pixels the edge passes through", () => {
    const mask = new Mask(10, 10).fill(rect(2.03, 2, 6, 4));
    // Pixel 20 spans x = 2.0 to 2.1, so 70% of it is inside.
    expect(Math.abs(mask.data[40 * mask.cols + 20] - 0.7 * 255)).toBeLessThanOrEqual(1);
  });

  it("ignores open paths when filling", () => {
    const mask = new Mask(10, 10).fill(new Polyline(rect(2, 2, 6, 4).points, false));
    expect(mask.data.every((c) => c === 0)).toBe(true);
  });

  it("fills a self-crossing star by nonzero or even-odd", () => {
    const star = pentagram(10, 10, 8);
    expect(new Mask(20, 20).fill(star).covered(10, 10)).toBe(true);
    expect(new Mask(20, 20).fill(star, "evenodd").covered(10, 10)).toBe(false);
    // A point arm stays covered either way.
    expect(new Mask(20, 20).fill(star, "evenodd").covered(10, 4)).toBe(true);
  });

  it("unions rings that run the same way and cuts holes with reversed ones", () => {
    const outer = rect(0, 0, 10, 10);
    const inner = rect(3, 3, 4, 4);
    expect(new Mask(10, 10).fill([outer, inner]).covered(5, 5)).toBe(true);
    expect(new Mask(10, 10).fill([outer, inner.reversed()]).covered(5, 5)).toBe(false);
    expect(new Mask(10, 10).fill([outer, inner], "evenodd").covered(5, 5)).toBe(false);
    expect(new Mask(10, 10).fill([outer, inner.reversed()]).covered(1, 1)).toBe(true);
  });

  it("keeps earlier fills when stamping more (union by max)", () => {
    const mask = new Mask(20, 10).fill(rect(1, 1, 5, 5)).fill(rect(10, 1, 5, 5));
    expect(mask.covered(3, 3)).toBe(true);
    expect(mask.covered(12, 3)).toBe(true);
    expect(mask.covered(8, 3)).toBe(false);
  });

  it("strokes a band of the given width with round caps", () => {
    const mask = new Mask(10, 10).stroke(line(v(2, 5), v(8, 5)), 1);
    expect(mask.covered(5, 5.4)).toBe(true);
    expect(mask.covered(5, 5.6)).toBe(false);
    expect(mask.covered(1.6, 5)).toBe(true);
    expect(mask.covered(1.4, 5)).toBe(false);
    expect(mask.covered(1.7, 4.7)).toBe(true); // inside the cap's curve
    expect(mask.covered(1.6, 4.6)).toBe(false); // outside it, though inside a square cap
  });

  it("clamps shapes that run off the mask", () => {
    const mask = new Mask(10, 10).fill(rect(-5, -5, 10, 10)).stroke(line(v(5, 9.5), v(5, 20)), 2);
    expect(mask.covered(0.05, 0.05)).toBe(true);
    expect(mask.covered(5, 9.95)).toBe(true);
    expect(mask.coverage(-1, -1)).toBe(0);
  });

  it("clear() uncovers everything", () => {
    const mask = new Mask(10, 10).fill(rect(0, 0, 10, 10));
    expect(mask.clear().data.every((c) => c === 0)).toBe(true);
  });

  it("clip() keeps what is outside covered areas and inside the bounds", () => {
    const mask = new Mask(20, 10).fill(rect(5, 0, 5, 10));
    const pieces = mask.clip(line(v(0, 5), v(20, 5)), { bounds: Bounds.fromRect(1, 0, 17, 10) });
    expect(pieces).toHaveLength(2);
    expect(pieces[0].start!.x).toBeCloseTo(1, 4);
    expect(pieces[0].end!.x).toBeCloseTo(5, 2);
    expect(pieces[1].start!.x).toBeCloseTo(10, 2);
    expect(pieces[1].end!.x).toBeCloseTo(18, 4);
  });

  it("puts cut points within 0.05 mm of the true outline at 10 px/mm", () => {
    const disc = circle(v(20, 20), 8, { tolerance: 0.001 });
    const tilted = rect(-7, -7, 14, 14)
      .transform(rotation((17 * Math.PI) / 180))
      .translate(v(48, 20));
    const shapes = [disc, tilted];
    const mask = new Mask(70, 40).fill(shapes);

    const random = new Random("mask-accuracy");
    let worst = 0;
    let cuts = 0;
    for (let i = 0; i < 200; i++) {
      const a = random.pointIn(Bounds.fromRect(0, 0, 70, 40));
      const b = random.pointIn(Bounds.fromRect(0, 0, 70, 40));
      for (const piece of mask.clip(line(a, b), { minLength: 0 })) {
        for (const end of [piece.start!, piece.end!]) {
          if (end.distance(a) < 1e-9 || end.distance(b) < 1e-9) continue;
          worst = Math.max(worst, Math.min(...shapes.map((s) => distanceToOutline(end, s))));
          cuts++;
        }
      }
    }
    expect(cuts).toBeGreaterThan(100);
    expect(worst).toBeLessThan(0.05);
  });
});
